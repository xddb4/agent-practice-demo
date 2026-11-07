import os, uuid, secrets, hashlib, hmac, logging, base64, binascii
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends, Request, Response, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from .core.db import Session, Record
from .ai.workflows.pilot import workflow, DIMENSIONS
from .ai.skills import SkillProfile
from .ai.skills import SKILL_LABELS, skills_for_request
from .ai.workflows.plan_dialogue import workflow as dialogue_workflow
from .integrations.model import ModelCapabilityError
from .services.agent_errors import diagnose
from .services.plans import plan_title,plan_payload
from .services.plan_dialogue import dialogue_context, prepare_changes, apply_changes
from .services.context import bounded_context
from .services.memory import unpack,pack,record_bytes,cleanup_candidates
from .services.completion_stats import merge_completion_ids
from .services.model_settings import ModelSettings, read_settings, public_settings, save_settings, runtime_settings, use_settings
from .schemas.agent import output_contract
from pydantic import ValidationError
import json

app=FastAPI(title='StudyPilot',version='0.1.0')
@app.exception_handler(RequestValidationError)
async def validation_error(request:Request,error):
    if request.url.path.startswith('/api/model-settings'):
        return JSONResponse(status_code=422,content={'detail':{'message':'模型配置字段无效，请核对 HTTPS 地址、模型名称和密钥长度','errors':[{'field':'.'.join(map(str,x['loc'])),'type':x['type']} for x in error.errors()]}})
    return await request_validation_exception_handler(request,error)
@app.middleware('http')
async def refresh_local_assets(request:Request,call_next):
    response=await call_next(request)
    if request.url.path.startswith('/api/') or request.url.path == '/' or request.url.path.endswith(('.html', '.css', '.js')):
        response.headers['Cache-Control']='no-store'
    return response
log=logging.getLogger('studypilot')
def uid(request: Request):
    token=request.cookies.get('session','')
    with Session() as db:
        row=db.get(Record,'session:'+hashlib.sha256(token.encode()).hexdigest())
        if not row or row.data['expires']<datetime.now(timezone.utc).isoformat(): raise HTTPException(401,'请先登录')
        return row.owner
def rows(db, owner, kind):
    return db.scalars(select(Record).where(Record.owner==owner,Record.kind==kind)).all()
class Credentials(BaseModel):
    email: str=Field(min_length=3,max_length=254)
    password: str=Field(min_length=8,max_length=128)
    name: str=Field(default='同学',max_length=24)
def digest(password,salt): return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),210000).hex()
@app.post('/api/auth/{action}')
def auth(action:str, body:Credentials,response:Response):
    email=body.email.strip().lower()
    if '@' not in email or action not in ['login','register']: raise HTTPException(422,'邮箱或操作无效')
    with Session() as db:
        key='user:'+email; user=db.get(Record,key)
        if action=='register':
            if user: raise HTTPException(409,'邮箱已注册')
            salt=secrets.token_hex(16)
            user=Record(id=key,owner=str(uuid.uuid4()),kind='user',data={'email':email,'name':body.name,'salt':salt,'hash':digest(body.password,salt),'motto':''})
            db.add(user)
        elif not user or not hmac.compare_digest(digest(body.password,user.data['salt']),user.data['hash']): raise HTTPException(401,'邮箱或密码错误')
        token=secrets.token_urlsafe(32)
        db.add(Record(id='session:'+hashlib.sha256(token.encode()).hexdigest(),owner=user.owner,kind='session',data={'expires':(datetime.now(timezone.utc)+timedelta(days=7)).isoformat()}))
        try: db.commit()
        except IntegrityError: raise HTTPException(409,'邮箱已注册')
        response.set_cookie('session',token,httponly=True,samesite='strict',max_age=604800)
        return {'id':user.owner,**{k:user.data[k] for k in ['email','name','motto']}}
@app.post('/api/logout')
def logout(request:Request,response:Response,owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'session:'+hashlib.sha256(request.cookies['session'].encode()).hexdigest()); db.delete(row); db.commit()
    response.delete_cookie('session'); return {'ok':True}
@app.get('/api/me')
def me(owner=Depends(uid)):
    with Session() as db:
        user=rows(db,owner,'user')[0]
        return {'id':owner,**{k:user.data[k] for k in ['email','name','motto']}}
@app.get('/api/state')
def get_state(owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'state:'+owner)
        return row.data if row else {'tasks':[],'evidence':[]}
class Snapshot(BaseModel):
    tasks:list[dict]=Field(max_length=5000)
    evidence:list[dict]=Field(max_length=5000)
def validate_tasks(tasks):
    ids=set()
    proposals=set()
    for task in tasks:
        if not str(task.get('title','')).strip(): raise HTTPException(422,'任务名称不能为空')
        if task.get('id') in ids: raise HTTPException(422,'任务编号重复')
        ids.add(task.get('id'))
        if task.get('agent_run_id') and isinstance(task.get('proposal_index'),int):
            identity=(task['agent_run_id'],task['proposal_index'])
            if identity in proposals:raise HTTPException(409,'该方案条目已加入计划，请勿重复采纳')
            proposals.add(identity)
        if task.get('start') and (not task.get('end') or task['start']>=task['end']): raise HTTPException(422,'结束时间必须晚于开始时间')
        if task.get('q',0) not in range(4): raise HTTPException(422,'象限无效')
@app.put('/api/state')
def put_state(body:Snapshot,owner=Depends(uid)):
    validate_tasks(body.tasks)
    for e in body.evidence:
        if e.get('dim') not in range(6) or e.get('status') not in ['待确认','已接受','已拒绝','待观察']: raise HTTPException(422,'证据维度或状态无效')
    with Session() as db:
        previous=db.get(Record,'state:'+owner)
        stats=db.get(Record,'completion-stats:'+owner)
        completed=merge_completion_ids(stats.data.get('task_ids',[]) if stats else [],previous.data.get('tasks',[]) if previous else [],body.tasks)
        db.merge(Record(id='completion-stats:'+owner,owner=owner,kind='completion-stats',data={'task_ids':completed}))
        db.merge(Record(id='state:'+owner,owner=owner,kind='state',data=body.model_dump())); db.commit()
    return {'ok':True}
@app.get('/api/completion-stats')
def completion_stats(owner=Depends(uid)):
    with Session() as db:
        stats=db.get(Record,'completion-stats:'+owner)
        state=db.get(Record,'state:'+owner)
        completed=merge_completion_ids(stats.data.get('task_ids',[]) if stats else [],state.data.get('tasks',[]) if state else [],[])
        return {'completed_tasks':len(completed)}
@app.patch('/api/profile')
def profile(body:dict,owner=Depends(uid)):
    with Session() as db:
        user=rows(db,owner,'user')[0]; user.data={**user.data, 'name':str(body.get('name','同学'))[:24],'motto':str(body.get('motto',''))[:100]};db.commit()
    return {'ok':True}
class AgentInput(BaseModel):
    text:str=Field(min_length=1,max_length=30000)
    route:str='auto'
    image:str=''
    base_plan_id:str|None=None
    material_ids:list[uuid.UUID]=Field(default_factory=list,max_length=3)
    skill_profile:SkillProfile='auto'
    dialogue_message:str|None=Field(default=None,min_length=1,max_length=3000)
    attachment_images:list[str]=Field(default_factory=list,max_length=3)
    request_id:uuid.UUID|None=None


def lock_dialogue_request(db, owner, request_id):
    if request_id is None:
        return None
    key=f'dialogue-request:{owner}:{request_id}'
    row=db.get(Record,key,with_for_update=True)
    if not row:
        row=Record(id=key,owner=owner,kind='dialogue-request',data={'status':'running'})
        db.add(row)
    return row


def begin_dialogue_request(owner, request_id):
    if request_id is None:
        return
    with Session() as db:
        if db.bind.dialect.name=='sqlite': db.execute(text('BEGIN IMMEDIATE'))
        row=lock_dialogue_request(db,owner,request_id)
        if row not in db.new: raise HTTPException(409,'这次请求已经撤回或提交')
        try: db.commit()
        except IntegrityError: raise HTTPException(409,'这次请求已经撤回或提交') from None


@app.post('/api/dialogue-requests/{request_id}/cancel')
def cancel_dialogue_request(request_id:uuid.UUID,owner=Depends(uid)):
    with Session() as db:
        if db.bind.dialect.name=='sqlite': db.execute(text('BEGIN IMMEDIATE'))
        row=lock_dialogue_request(db,owner,request_id)
        if row.data['status']=='completed': raise HTTPException(409,'回复已完成，可以撤回已完成的消息')
        row.data={'status':'cancelled'}
        try: db.commit()
        except IntegrityError: raise HTTPException(409,'请求状态已变化，请重试撤回') from None
    return {'ok':True}


def finish_dialogue_request(db, owner, request_id):
    row=lock_dialogue_request(db,owner,request_id)
    if row:
        if row.data['status']!='running': raise HTTPException(409,'消息已撤回')
        row.data={'status':'completed'}

@app.get('/api/model-settings')
def get_model_settings(owner=Depends(uid)):
    return public_settings(read_settings(owner))

@app.put('/api/model-settings')
def put_model_settings(body:ModelSettings,owner=Depends(uid)):
    return save_settings(owner,body)

@app.delete('/api/model-settings')
def delete_model_settings(owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'model-settings:'+owner)
        if row:db.delete(row);db.commit()
    return {'configured':False}

@app.post('/api/model-settings/test')
def test_model_settings(owner=Depends(uid)):
    settings=runtime_settings(owner)
    try:
        from .integrations.model import create_model
        with use_settings(settings):
            create_model().invoke('Reply only OK. This is a connection test.')
    except Exception as error:
        raise HTTPException(502,diagnose(error,uuid.uuid4().hex[:12]))
    return {'ok':True,'message':'文本模型连接成功；图片能力需用实际图片单独验证。'}

def read_plan_attachments(owner, material_ids, images):
    if len(material_ids)+len(images)>3:
        raise HTTPException(422,'每条消息最多添加 3 个附件')
    for image in images:
        header, _, encoded = image.partition(',')
        if header not in ('data:image/png;base64','data:image/jpeg;base64','data:image/webp;base64') or not encoded or len(encoded)>13_981_016:
            raise HTTPException(422,'图片必须为不超过 10 MB 的 PNG、JPEG 或 WebP')
        try:
            if len(base64.b64decode(encoded, validate=True))>10*1024*1024:
                raise ValueError('image too large')
        except (ValueError, binascii.Error):
            raise HTTPException(422,'图片数据无效或超过 10 MB') from None
    materials=[]
    if material_ids:
        with Session() as db:
            for file_id in dict.fromkeys(material_ids):
                attachment=db.get(Record,'file:'+str(file_id))
                if not attachment or attachment.owner!=owner or attachment.kind!='file':
                    raise HTTPException(404,'辅助资料不存在')
                material_text=attachment.data.get('text','').strip()
                if not material_text:raise HTTPException(422,'辅助资料没有可读取的正文，请粘贴关键信息到情况备注')
                materials.append({'name':attachment.data['name'][:180],'text':material_text[:3500]})
    return materials


@app.post('/api/agent')
def agent(body:AgentInput,owner=Depends(uid)):
    if body.route not in ['auto','schedule','evidence','recommend']: raise HTTPException(422,'任务类型无效')
    if body.image and (not body.image.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')) or len(body.image)>14_000_000): raise HTTPException(422,'仅支持不超过10MB的PNG/JPEG/WebP图片')
    if (body.material_ids or body.attachment_images) and body.route!='recommend':
        raise HTTPException(422,'辅助资料仅用于生成推荐方案')
    settings=runtime_settings(owner)
    context=get_state(owner); context['evidence']=[x for x in context['evidence'] if x.get('status')=='已接受']
    materials=read_plan_attachments(owner,body.material_ids,body.attachment_images)
    if body.base_plan_id:
        with Session() as db:
            base=db.get(Record,body.base_plan_id)
            if not base or base.owner!=owner or base.kind!='run' or base.data.get('route')!='recommend':raise HTTPException(404,'参考方案不存在')
            context['reference_plan']={'title':plan_title(base.data),'items':plan_payload(base,[])['items'],'rule':'仅作为用户明确选择的参考方案；本次约束优先，历史方案不代表已确认能力。'}
    schedule_tasks=context.get('tasks',[])
    context=bounded_context(context)
    begin_dialogue_request(owner,body.request_id)
    try:
        with use_settings(settings):
            result=workflow.invoke({**body.model_dump(exclude={'material_ids','request_id'}),'context':context,'schedule_tasks':schedule_tasks,'materials':materials})
    except Exception as error:
        error_id=uuid.uuid4().hex[:12]
        detail=diagnose(error,error_id)
        log.warning('agent_failed request_id=%s route=%s code=%s error_type=%s upstream_status=%s',error_id,body.route,detail['code'],type(error).__name__,getattr(error,'status_code',None))
        raise HTTPException(422 if isinstance(error,ModelCapabilityError) else 502,detail)
    run_id=str(uuid.uuid4())
    dialogue={}
    if result['route']=='recommend' and body.dialogue_message:
        count=len(result['result']['items'])
        dialogue={'dialogue':{'messages':[
            {'role':'user','text':body.dialogue_message},
            {'role':'assistant','text':result['result'].get('dialogue_reply') or f'我整理了 {count} 项准备任务。你可以打开右侧的「选择任务／执行安排」查看各项建议，也可以告诉我哪些任务想调整。',
             'skills':[skill['label'] for skill in result['result'].get('skills',[]) if 'label' in skill]},
            {'role':'system','text':'准备方案已保存，可以继续对话。'}],
            'skill_profile':body.skill_profile,'pending':None}}
    with Session() as db:
        if body.request_id and db.bind.dialect.name=='sqlite': db.execute(text('BEGIN IMMEDIATE'))
        finish_dialogue_request(db,owner,body.request_id)
        db.add(Record(id=run_id,owner=owner,kind='run',data={'route':result['route'],'image':bool(body.image),'input_source':body.text,'created_at':datetime.now(timezone.utc).isoformat(),'parent_plan_id':body.base_plan_id,'material_names':[item['name'] for item in materials],**result['result'],**dialogue,'status':'pending'}));db.commit()
    metrics=result['result'].get('metrics',{})
    log.info('agent_completed run=%s route=%s seconds=%s model_calls=%s context_characters=%s',run_id,result['route'],metrics.get('total_seconds'),metrics.get('model_calls'),metrics.get('context_characters'))
    return {'id':run_id,'route':result['route'],**result['result']}
class CandidateReview(BaseModel):
    items:list[dict]=Field(min_length=1,max_length=100)
    indices:list[int]|None=None
@app.post('/api/agent/{run_id}/review')
def review(run_id:str,body:CandidateReview,owner=Depends(uid)):
    with Session() as db:
        run=db.get(Record,run_id)
        if not run or run.kind!='run' or run.owner!=owner:raise HTTPException(404,'候选记录不存在')
        run.data=unpack(run.data)
        indices=body.indices if body.indices is not None else list(range(len(body.items)))
        if len(indices)!=len(body.items) or len(set(indices))!=len(indices) or any(index<0 or index>=len(run.data['items']) or index in run.data.get('cancelled_indices',[]) for index in indices):raise HTTPException(422,'候选索引无效')
        schema=output_contract(run.data['route'],run.data.get('image',False))
        try:
            checked=schema.model_validate_json(json.dumps({'items':body.items,'notice':run.data.get('notice','')},ensure_ascii=False)).model_dump(mode='json')
        except ValidationError as error:
            errors=[{'field':'.'.join(map(str,x['loc'])),'type':x['type']} for x in error.errors()]
            raise HTTPException(422,{'message':'候选字段无效，请补充或修改','errors':errors})
        revisions={**run.data.get('item_revisions',{}),**{str(index):item for index,item in zip(indices,checked['items'])}}
        run.data={**run.data,'reviewed_items':checked['items'],'reviewed_indices':indices,'item_revisions':revisions,'status':'reviewed','reviewed_at':datetime.now(timezone.utc).isoformat()};db.commit()
        return {'id':run_id,'route':run.data['route'],**checked,'sources':run.data.get('sources',[]),'trace':run.data.get('trace',[])}
@app.get('/api/plans')
def list_plans(include_archived:bool=False,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        plans=[record for record in rows(db,owner,'run') if record.data.get('route')=='recommend' and (include_archived or not record.data.get('archived'))]
        plans.sort(key=lambda record:record.data.get('created_at') or record.data.get('reviewed_at') or '',reverse=True)
        results=[]
        for record in plans[:50]:
            plan=plan_payload(record,state['tasks'])
            results.append({'id':record.id,'title':plan['title'],'created_at':plan['created_at'],'count':len(plan['items']),'archived':record.data.get('archived',False),'adopted_count':len(plan['adopted_indices'])})
        return results
@app.get('/api/plans/{plan_id}')
def get_plan(plan_id:str,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'准备方案不存在')
        return plan_payload(record,state['tasks'])


class DialogueMessage(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    skill_profile: SkillProfile = 'auto'
    material_ids:list[uuid.UUID]=Field(default_factory=list,max_length=3)
    attachment_images:list[str]=Field(default_factory=list,max_length=3)
    request_id:uuid.UUID|None=None


class DialogueDecision(BaseModel):
    proposal_id: str
    apply: bool


def dialogue_plan(db, owner, plan_id, *, write=False):
    if write and db.bind.dialect.name == 'sqlite':
        db.execute(text('BEGIN IMMEDIATE'))
    record = db.get(Record, plan_id, with_for_update=write)
    if not record or record.owner != owner or record.kind != 'run' or record.data.get('route') != 'recommend':
        raise HTTPException(404, '准备方案不存在')
    return record, unpack(record.data)


def dialogue_payload(record, data):
    chat = data.get('dialogue', {})
    pending = chat.get('pending')
    messages = chat.get('messages', [])
    can_withdraw = len(messages) >= 2 and [turn['role'] for turn in messages[-2:]] == ['user', 'assistant']
    token = hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest() if can_withdraw else None
    public_messages = [{key: value for key, value in turn.items() if key in ('role', 'text', 'skills')} for turn in messages]
    return {'id': record.id, 'title': plan_title(data), 'messages': public_messages, 'withdraw_token': token,
            'skill_profile': chat.get('skill_profile', 'auto'),
            'pending': {'id': pending['id'], 'preview': pending['preview']} if pending else None}


@app.get('/api/plans/{plan_id}/dialogue')
def get_dialogue(plan_id: str, owner=Depends(uid)):
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id)
        return dialogue_payload(record, data)


class DialogueWithdrawal(BaseModel):
    token: str = Field(min_length=64, max_length=64)


@app.post('/api/plans/{plan_id}/dialogue/withdraw')
def withdraw_dialogue(plan_id: str, body: DialogueWithdrawal, owner=Depends(uid)):
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id, write=True)
        if dialogue_payload(record, data)['withdraw_token'] != body.token:
            raise HTTPException(409, '对话已更新，或这轮调整已经处理')
        chat = data['dialogue']
        messages = chat['messages']
        restored = messages[-2]['text']
        data = {**data, 'dialogue': {**chat, 'messages': messages[:-2], 'pending': None,
                'memory': messages[-1].get('previous_memory', '')}}
        record.data = data
        payload = dialogue_payload(record, data)
        db.commit()
        return {**payload, 'restored': restored}


@app.post('/api/plans/{plan_id}/dialogue')
def send_dialogue(plan_id: str, body: DialogueMessage, owner=Depends(uid)):
    message = body.text.strip()
    if not message:
        raise HTTPException(422, '请输入对话内容')
    with Session() as db:
        _, baseline = dialogue_plan(db, owner, plan_id)
    chat = baseline.get('dialogue', {})
    if chat.get('pending'):
        raise HTTPException(409, '请先确认或放弃上一轮调整建议')
    messages = chat.get('messages', [])
    tasks = get_state(owner)['tasks']
    context = dialogue_context(baseline, tasks, plan_id, messages, message)
    skills = skills_for_request('recommend', body.skill_profile, plan_title(baseline))
    settings = runtime_settings(owner)
    materials = read_plan_attachments(owner, body.material_ids, body.attachment_images)
    begin_dialogue_request(owner,body.request_id)
    try:
        with use_settings(settings):
            state = {'context': context, 'skills': skills}
            if materials or body.attachment_images:
                state.update(materials=materials, attachment_images=body.attachment_images)
            result = dialogue_workflow.invoke(state)['result']
    except Exception as error:
        error_id = uuid.uuid4().hex[:12]
        detail = diagnose(error, error_id)
        log.warning('dialogue_failed request_id=%s code=%s error_type=%s upstream_status=%s', error_id, detail['code'], type(error).__name__, getattr(error,'status_code',None))
        raise HTTPException(502, detail)
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id, write=True)
        finish_dialogue_request(db,owner,body.request_id)
        if data != baseline:
            raise HTTPException(409, '方案或对话已有更新，请重新打开后再发送')
        snapshot = db.get(Record, 'state:' + owner, with_for_update=True)
        current_tasks = snapshot.data['tasks'] if snapshot else []
        if dialogue_context(data, current_tasks, plan_id, messages, message) != context:
            raise HTTPException(409, '相关日程已有更新，请重新发送')
        preview = prepare_changes(data, current_tasks, plan_id, result['changes'])
        pending = {'id': str(uuid.uuid4()), 'changes': result['changes'], 'preview': preview} if preview else None
        memory = result.get('memory') if result.get('memory') is not None else chat.get('memory', '')
        data = {**data, 'dialogue': {'messages': [*messages, {'role': 'user', 'text': message},
                {'role': 'assistant', 'text': result['reply'], 'skills': [SKILL_LABELS[key] for key in skills],
                 'turn_id': uuid.uuid4().hex, 'previous_memory': chat.get('memory', '')}],
                'skill_profile': body.skill_profile, 'pending': pending,
                'memory': memory}}
        record.data = data
        payload = dialogue_payload(record, data)
        db.commit()
        return payload


@app.post('/api/plans/{plan_id}/dialogue/decision')
def decide_dialogue(plan_id: str, body: DialogueDecision, owner=Depends(uid)):
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id, write=True)
        chat = data.get('dialogue', {})
        pending = chat.get('pending')
        if not pending or pending['id'] != body.proposal_id:
            raise HTTPException(409, '这份调整建议已处理，请重新打开对话')
        updated_tasks = None
        if body.apply:
            snapshot = db.get(Record, 'state:' + owner, with_for_update=True)
            current_tasks = snapshot.data['tasks'] if snapshot else []
            preview = prepare_changes(data, current_tasks, plan_id, pending['changes'])
            if preview != pending['preview']:
                raise HTTPException(409, '涉及的任务已更新，请放弃旧建议并重新生成')
            data, updated_tasks = apply_changes(data, current_tasks, plan_id, preview)
            if snapshot and updated_tasks != current_tasks:
                validate_tasks(updated_tasks)
                snapshot.data = {**snapshot.data, 'tasks': updated_tasks}
        note = '已应用本轮调整。' if body.apply else '已放弃本轮调整。'
        data = {**data, 'dialogue': {**chat, 'pending': None, 'messages': [
            *chat['messages'], {'role': 'system', 'text': note}]}}
        record.data = data
        payload = dialogue_payload(record, data)
        db.commit()
        return {**payload, 'tasks': updated_tasks}


@app.post('/api/plans/{plan_id}/copy')
def copy_plan(plan_id:str,owner=Depends(uid)):
    with Session() as db:
        source=db.get(Record,plan_id)
        if not source or source.owner!=owner or source.kind!='run' or source.data.get('route')!='recommend':raise HTTPException(404,'准备方案不存在')
        data=unpack(source.data)
        items=plan_payload(source,[])['items']
        for item in items:
            for field in ('date','start','end','deadline','suggested_finish'):
                if field in item:item[field]=None
            if 'suggested_sessions' in item:item['suggested_sessions']=[]
        record=Record(id=str(uuid.uuid4()),owner=owner,kind='run',data={'route':'recommend','items':items,'input_source':data.get('input_source',''),'display_title':plan_title(data)+'（副本）','created_at':datetime.now(timezone.utc).isoformat(),'parent_plan_id':plan_id,'status':'pending','sources':data.get('sources',[]),'search_status':data.get('search_status',{}),'notice':''})
        db.add(record);db.commit()
        return plan_payload(record,[])
class ArchiveInput(BaseModel):
    archived:bool=True
@app.post('/api/plans/{plan_id}/archive')
def archive_plan(plan_id:str,body:ArchiveInput,owner=Depends(uid)):
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'准备方案不存在')
        record.data={**record.data,'archived':body.archived};db.commit()
    return {'ok':True}
@app.delete('/api/plans/{plan_id}')
def delete_plan(plan_id:str,owner=Depends(uid)):
    state=get_state(owner)
    if any(task.get('agent_run_id')==plan_id for task in state['tasks']):raise HTTPException(409,'该方案仍被正式任务引用，请使用归档保留来源')
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'准备方案不存在')
        db.delete(record);db.commit()
    return {'ok':True}
class MemoryAction(BaseModel):
    older_than_days:int=Field(default=30,ge=0,le=3650)
    keep_recent:int=Field(default=5,ge=0,le=1000)
@app.get('/api/memory')
def memory_stats(owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        records=rows(db,owner,'run');eligible=cleanup_candidates(records,state['tasks'])
        return {'records':len(records),'bytes':sum(record_bytes(record) for record in records),'compressed':sum('_compressed_v1' in record.data for record in records),'archived':sum(bool(record.data.get('archived')) for record in records),'cleanup_count':len(eligible),'context_limit_characters':12000}
@app.post('/api/memory/compact')
def compact_memory(owner=Depends(uid)):
    with Session() as db:
        records=rows(db,owner,'run');before=sum(record_bytes(record) for record in records);changed=0
        for record in records:
            if '_compressed_v1' in record.data:continue
            compacted=pack(record.data)
            if '_compressed_v1' in compacted:record.data=compacted;changed+=1
        db.commit();after=sum(record_bytes(record) for record in records)
        return {'compressed':changed,'bytes_saved':max(0,before-after)}
@app.post('/api/memory/cleanup-preview')
def preview_cleanup(body:MemoryAction,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        records=cleanup_candidates(rows(db,owner,'run'),state['tasks'],body.older_than_days,body.keep_recent)
        return {'count':len(records),'bytes':sum(record_bytes(record) for record in records)}
@app.post('/api/memory/cleanup')
def cleanup_memory(body:MemoryAction,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        records=cleanup_candidates(rows(db,owner,'run'),state['tasks'],body.older_than_days,body.keep_recent)
        for record in records:db.delete(record)
        db.commit();return {'deleted':len(records)}
@app.get('/api/report')
def report(owner=Depends(uid)):
    state=get_state(owner); evidence=[e for e in state['evidence'] if e.get('status')=='已接受']
    return {'generated_at':datetime.now(timezone.utc).isoformat(),'dimensions':[{'name':d,'evidence':[e for e in evidence if e.get('dim')==i],'level':'已有过程证据，水平待评估' if any(e.get('dim')==i for e in evidence) else '证据不足','trend':'暂无可比历史','confidence':'有限','next':'补充含问题、方法、对照数据和反思的作品'} for i,d in enumerate(DIMENSIONS)]}
@app.get('/api/health')
def health():
    with Session() as db: db.execute(select(Record.id).limit(1))
    return {'status':'ok','agent':os.getenv('MODEL_PROVIDER','qwen') if os.getenv('MODEL_API_KEY') else 'offline','model':os.getenv('MODEL_NAME') if os.getenv('MODEL_API_KEY') else None,'database': 'postgresql' if os.getenv('DATABASE_URL','').startswith('postgresql') else 'sqlite-local'}

root=Path(__file__).resolve().parents[2]
@app.post('/api/files')
async def upload(file:UploadFile=File(...),owner=Depends(uid)):
    ext=Path(file.filename or '').suffix.lower()
    if ext not in ['.pdf','.txt','.md','.png','.jpg','.jpeg','.webp']: raise HTTPException(422,'支持PDF、文本与图片附件')
    data=await file.read(10*1024*1024+1)
    if len(data)>10*1024*1024: raise HTTPException(413,'附件不得超过10MB')
    key=str(uuid.uuid4()); folder=root/'uploads';folder.mkdir(exist_ok=True)
    (folder/key).write_bytes(data)
    text=''
    if ext in ['.txt','.md']:
        try:text=data.decode('utf-8')
        except UnicodeDecodeError:raise HTTPException(422,'文本附件需采用UTF-8编码')
    elif ext=='.pdf':
        try:
            import pymupdf
            with pymupdf.open(stream=data,filetype='pdf') as doc:text='\n'.join(page.get_text() for page in doc)
        except Exception:raise HTTPException(422,'PDF无法解析，请粘贴正文或上传有效PDF')
    with Session() as db:
        db.add(Record(id='file:'+key,owner=owner,kind='file',data={'name':file.filename,'text':text[:30000]}));db.commit()
    return {'id':key,'name':file.filename,'text':text[:30000],'url':'/api/files/'+key}
@app.get('/api/files/{key}')
def download(key:str,owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'file:'+key)
        if not row or row.owner!=owner: raise HTTPException(404,'附件不存在')
        return FileResponse(root/'uploads'/key,filename=row.data['name'],media_type='application/octet-stream')

if (root/'frontend/dist').exists(): app.mount('/',StaticFiles(directory=root/'frontend/dist',html=True),name='web')
