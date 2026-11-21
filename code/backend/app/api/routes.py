import os, uuid, secrets, hashlib, hmac, logging, base64, binascii
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Request, Response, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from ..core.db import Session, Record
from core_engine.ai.workflows.pilot import workflow, DIMENSIONS
from core_engine.ai.skills import SKILL_LABELS, skills_for_request
from core_engine.ai.workflows.plan_dialogue import workflow as dialogue_workflow
from ..integrations.model import ModelCapabilityError
from ..services.agent_errors import diagnose
from ..services.plans import plan_title,plan_payload,dialogue_title,linked_tasks,plan_items
from ..services.plan_dialogue import dialogue_context, prepare_changes, apply_changes
from ..services.tasks import validate_tasks
from ..services.context import bounded_context
from ..schemas.requests import DialogueEvidenceReview
from ..services.stream_events import ensure_stream_active
from .streaming import stream_response, cancel_stream, job_key, public_job
from ..services.memory import unpack,pack,record_bytes,cleanup_candidates
from ..services.completion_stats import merge_completion_ids
from ..services.completion_evidence import completion_snapshot
from ..services.task_lifecycle import stamp_tasks, execution_context
from ..services.ai_safety import SafetyRefusal, guard_text, guard_model_output, redact_context
from ..services.task_expiry import sweep_expired, expired, expiry_reference, LOCAL as EXPIRY_LOCAL
from ..schemas.requests import RestoreExpiredTask
from ..services.model_settings import ModelSettings, read_settings, public_settings, save_settings, runtime_settings, use_settings
from ..schemas.agent import output_contract
from pydantic import ValidationError
import json

from ..core.application import app
from ..core.auth import uid, digest
from ..core.config import PROJECT_ROOT
from ..repositories.records import rows
from ..schemas.requests import Credentials, Snapshot, AgentInput, CandidateReview, DialogueMessage, DialogueDecision, DialogueWithdrawal, ArchiveInput, MemoryAction, ConversationTitle
router = APIRouter()

@app.exception_handler(RequestValidationError)
async def validation_error(request:Request,error):
    if request.url.path.startswith('/api/model-settings'):
        return JSONResponse(status_code=422,content={'detail':{'message':'模型配置字段无效，请核对 HTTPS 地址、模型名称和密钥长度','errors':[{'field':'.'.join(map(str,x['loc'])),'type':x['type']} for x in error.errors()]}})
    if request.url.path in ('/api/agent','/api/agent/stream') or '/dialogue' in request.url.path:
        return JSONResponse(status_code=422,content={'detail':{'code':'invalid_ai_input','title':'输入格式需要调整','reason':'请检查文字长度、附件数量及字段格式。','action':'请先移除个人敏感信息，再缩短内容重试。','retryable':False}})
    return await request_validation_exception_handler(request,error)
@app.middleware('http')
async def refresh_local_assets(request:Request,call_next):
    response=await call_next(request)
    if request.url.path.startswith('/api/') or request.url.path == '/' or request.url.path.endswith(('.html', '.css', '.js')):
        response.headers['Cache-Control']='no-store'
    return response
log=logging.getLogger('studypilot')
@router.post('/api/auth/{action}')
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
@router.post('/api/logout')
def logout(request:Request,response:Response,owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'session:'+hashlib.sha256(request.cookies['session'].encode()).hexdigest()); db.delete(row); db.commit()
    response.delete_cookie('session'); return {'ok':True}
@router.get('/api/me')
def me(owner=Depends(uid)):
    with Session() as db:
        user=rows(db,owner,'user')[0]
        return {'id':owner,**{k:user.data[k] for k in ['email','name','motto']}}
@router.get('/api/state')
def get_state(owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'state:'+owner)
        if not row:return {'tasks':[],'evidence':[]}
        trash=row.data.get('task_trash',[])
        stamped=stamp_tasks(row.data.get('tasks',[]),row.data.get('tasks',[]))
        data=sweep_expired({**completion_snapshot(stamped,row.data.get('evidence',[])), 'task_trash':trash,'expired_tasks':row.data.get('expired_tasks',[])})
        if data != row.data:
            row.data=data
            db.commit()
        return data
@router.put('/api/state')
def put_state(body:Snapshot,owner=Depends(uid)):
    validate_tasks(body.tasks)
    for e in body.evidence:
        unknown_completion = e.get('source_type')=='task_completion' and e.get('dim')==-1 and e.get('status')!='已接受'
        if (e.get('dim') not in range(6) and not unknown_completion) or e.get('status') not in ['待确认','已接受','已拒绝','待观察']: raise HTTPException(422,'证据维度或状态无效')
        if e.get('source_type')=='task_completion' and e.get('status')=='已接受' and not e.get('completion_details_confirmed'):raise HTTPException(422,'请先补充任务实际成果或过程，再接受为成长证据')
    with Session() as db:
        previous=db.get(Record,'state:'+owner)
        if previous:previous.data=sweep_expired(previous.data)
        expired_ids={str(item['task'].get('id')) for item in previous.data.get('expired_tasks',[])} if previous else set()
        incoming=[task for task in body.tasks if str(task.get('id')) not in expired_ids]
        if previous:validate_tasks([*incoming,*[item['task'] for item in previous.data.get('expired_tasks',[])]])
        trash=body.task_trash if 'task_trash' in body.model_fields_set else previous.data.get('task_trash',[]) if previous else []
        trash=[item for item in trash if str(item.get('task',{}).get('id')) not in expired_ids]
        for item in trash:
            if not isinstance(item.get('task'),dict) or not item.get('trashId'):raise HTTPException(422,'回收站记录无效')
            validate_tasks([item['task']])
        if {str(task.get('id')) for task in body.tasks} & {str(item['task'].get('id')) for item in trash}:raise HTTPException(409,'任务不能同时存在于日程和回收站中')
        if len({item['trashId'] for item in trash})!=len(trash):raise HTTPException(422,'回收站记录编号重复')
        tombstone=db.get(Record,'permanent-task-deletions:'+owner)
        destroyed=set(tombstone.data.get('ids',[])) if tombstone else set()
        if any(str(task.get('id')) in destroyed for task in [*body.tasks,*[item['task'] for item in trash]]):raise HTTPException(409,'已永久删除的任务不能恢复，请刷新页面后重试')
        if any(str(item.get('task_id')) in destroyed for item in body.evidence):raise HTTPException(409,'已永久删除的任务证据不能恢复，请刷新页面后重试')
        stats=db.get(Record,'completion-stats:'+owner)
        completed=merge_completion_ids(stats.data.get('task_ids',[]) if stats else [],previous.data.get('tasks',[]) if previous else [],incoming)
        db.merge(Record(id='completion-stats:'+owner,owner=owner,kind='completion-stats',data={'task_ids':completed}))
        previous_tasks=[item['task'] for item in previous.data.get('task_trash',[])]+previous.data.get('tasks',[]) if previous else []
        stamped=stamp_tasks(incoming,previous_tasks)
        trash=[{**item,'task':stamp_tasks([item['task']],previous_tasks)[0]} for item in trash]
        snapshot=sweep_expired({**completion_snapshot(stamped, body.evidence, previous.data if previous else {}),'task_trash':trash,'expired_tasks':previous.data.get('expired_tasks',[]) if previous else []})
        db.merge(Record(id='state:'+owner,owner=owner,kind='state',data=snapshot)); db.commit()
    return {'ok':True,**snapshot}

@router.post('/api/tasks/{task_id}/reopen')
def reopen_completed_task(task_id:str,owner=Depends(uid)):
    with Session() as db:
        if db.bind.dialect.name=='sqlite':db.execute(text('BEGIN IMMEDIATE'))
        row=db.get(Record,'state:'+owner,with_for_update=True)
        state=row.data if row else {'tasks':[],'evidence':[]}
        task=next((task for task in state['tasks'] if str(task.get('id'))==task_id),None)
        if not task:raise HTTPException(404,'任务不存在')
        if not task.get('done') or task.get('start'):raise HTTPException(409,'此任务不在已完成灵活任务列表中')
        updated=[{**item,'done':False} if str(item.get('id'))==task_id else item for item in state['tasks']]
        snapshot=sweep_expired({**completion_snapshot(stamp_tasks(updated,state['tasks']),state['evidence'],state),'task_trash':state.get('task_trash',[]),'expired_tasks':state.get('expired_tasks',[])})
        row.data=snapshot
        db.commit()
    return snapshot

@router.delete('/api/tasks/{task_id}/completed')
def destroy_completed_task(task_id:str,owner=Depends(uid)):
    with Session() as db:
        if db.bind.dialect.name=='sqlite':db.execute(text('BEGIN IMMEDIATE'))
        row=db.get(Record,'state:'+owner,with_for_update=True)
        state=row.data if row else {'tasks':[],'evidence':[]}
        task=next((task for task in state['tasks'] if str(task.get('id'))==task_id),None)
        if not task:raise HTTPException(404,'任务不存在')
        if not task.get('done') or task.get('start'):raise HTTPException(409,'只能从此处永久删除已完成的灵活任务')
        snapshot={'tasks':[item for item in state['tasks'] if str(item.get('id'))!=task_id],
                  'evidence':[item for item in state['evidence'] if str(item.get('task_id'))!=task_id],
                  'task_trash':[item for item in state.get('task_trash',[]) if str(item.get('task',{}).get('id'))!=task_id]}
        snapshot['expired_tasks']=[item for item in state.get('expired_tasks',[]) if str(item['task'].get('id'))!=task_id]
        row.data=snapshot
        stats=db.get(Record,'completion-stats:'+owner)
        if stats:stats.data={'task_ids':[key for key in stats.data.get('task_ids',[]) if str(key)!=task_id]}
        key='permanent-task-deletions:'+owner
        tombstone=db.get(Record,key)
        ids=set(tombstone.data.get('ids',[])) if tombstone else set()
        ids.add(task_id)
        db.merge(Record(id=key,owner=owner,kind='task-deletions',data={'ids':sorted(ids)}))
        db.commit()
    return snapshot

@router.post('/api/tasks/{task_id}/restore-expired')
def restore_expired_task(task_id:str,body:RestoreExpiredTask,owner=Depends(uid)):
    today=datetime.now(EXPIRY_LOCAL).date()
    if body.date<today or body.deadline<body.date:raise HTTPException(422,'请重新设置今天或之后的计划日期，截止日期不能早于计划日期')
    with Session() as db:
        if db.bind.dialect.name=='sqlite':db.execute(text('BEGIN IMMEDIATE'))
        row=db.get(Record,'state:'+owner,with_for_update=True)
        if not row:raise HTTPException(404,'过期任务不存在')
        state=sweep_expired(row.data)
        field='task_trash' if body.trash_id else 'expired_tasks'
        source=next((item for item in state.get(field,[]) if str(item['task'].get('id'))==task_id and (not body.trash_id or item['trashId']==body.trash_id)),None)
        if not source:raise HTTPException(404,'过期任务不存在或已恢复')
        if any(str(task.get('id'))==task_id for task in state['tasks']):raise HTTPException(409,'此任务已经存在于日程中')
        task={**source['task'],'date':body.date.isoformat(),'ddl':body.deadline.isoformat(),'duration':body.duration,
              'suggest':'未设置','suggested_sessions':[],'restored_at':datetime.now(timezone.utc).isoformat(),'done':False,'completed_at':None,'elapsed_minutes':None}
        validate_tasks([*state['tasks'],task])
        state={**state,'tasks':[*state['tasks'],task],field:[item for item in state.get(field,[]) if item is not source]}
        row.data=state
        db.commit()
    return state
@router.get('/api/completion-stats')
def completion_stats(owner=Depends(uid)):
    with Session() as db:
        stats=db.get(Record,'completion-stats:'+owner)
        state=db.get(Record,'state:'+owner)
        completed=merge_completion_ids(stats.data.get('task_ids',[]) if stats else [],state.data.get('tasks',[]) if state else [],[])
        return {'completed_tasks':len(completed)}
@router.patch('/api/profile')
def profile(body:dict,owner=Depends(uid)):
    with Session() as db:
        user=rows(db,owner,'user')[0]; user.data={**user.data, 'name':str(body.get('name','同学'))[:24],'motto':str(body.get('motto',''))[:100]};db.commit()
    return {'ok':True}


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
    ensure_stream_active()
    if request_id is None:
        return
    with Session() as db:
        if db.bind.dialect.name=='sqlite': db.execute(text('BEGIN IMMEDIATE'))
        row=lock_dialogue_request(db,owner,request_id)
        if row not in db.new: raise HTTPException(409,'这次请求已经撤回或提交')
        try: db.commit()
        except IntegrityError: raise HTTPException(409,'这次请求已经撤回或提交') from None


@router.post('/api/dialogue-requests/{request_id}/cancel')
def cancel_dialogue_request(request_id:uuid.UUID,owner=Depends(uid)):
    with Session() as db:
        if db.bind.dialect.name=='sqlite': db.execute(text('BEGIN IMMEDIATE'))
        row=lock_dialogue_request(db,owner,request_id)
        if row.data['status']=='completed': raise HTTPException(409,'回复已完成，可以撤回已完成的消息')
        row.data={'status':'cancelled'}
        try: db.commit()
        except IntegrityError: raise HTTPException(409,'请求状态已变化，请重试撤回') from None
    cancel_stream(owner,request_id)
    return {'ok':True}


def finish_dialogue_request(db, owner, request_id):
    ensure_stream_active()
    row=lock_dialogue_request(db,owner,request_id)
    if row:
        if row.data['status']!='running': raise HTTPException(409,'消息已撤回')
        row.data={'status':'completed'}

@router.get('/api/model-settings')
def get_model_settings(owner=Depends(uid)):
    return public_settings(read_settings(owner))

@router.put('/api/model-settings')
def put_model_settings(body:ModelSettings,owner=Depends(uid)):
    return save_settings(owner,body)

@router.delete('/api/model-settings')
def delete_model_settings(owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'model-settings:'+owner)
        if row:db.delete(row);db.commit()
    return {'configured':False}

@router.post('/api/model-settings/test')
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
                guard_text(material_text,strict=False)
                materials.append({'name':attachment.data['name'][:180],'text':material_text[:3500]})
    return materials


@router.post('/api/agent')
def agent(body:AgentInput,owner=Depends(uid)):
    guard_text(body.text)
    if body.dialogue_message:guard_text(body.dialogue_message)
    if body.route not in ['auto','schedule','evidence','recommend']: raise HTTPException(422,'任务类型无效')
    if body.image and (not body.image.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')) or len(body.image)>14_000_000): raise HTTPException(422,'仅支持不超过10MB的PNG/JPEG/WebP图片')
    if (body.material_ids or body.attachment_images) and body.route!='recommend':
        raise HTTPException(422,'辅助资料仅用于生成推荐方案')
    materials=read_plan_attachments(owner,body.material_ids,body.attachment_images)
    settings=runtime_settings(owner)
    context=get_state(owner); context['evidence']=[x for x in context['evidence'] if x.get('status')=='已接受']
    if body.route in ('auto','recommend'):context['expired_tasks']=[]
    if body.base_plan_id:
        with Session() as db:
            base=db.get(Record,body.base_plan_id)
            if not base or base.owner!=owner or base.kind!='run' or base.data.get('route')!='recommend':raise HTTPException(404,'参考方案不存在')
            context['reference_plan']={'title':plan_title(base.data),'items':plan_payload(base,[])['items'],'rule':'仅作为用户明确选择的参考方案；本次约束优先，历史方案不代表已确认能力。'}
    schedule_tasks=redact_context(context.get('tasks',[]))
    context=redact_context(bounded_context(context))
    begin_dialogue_request(owner,body.request_id)
    try:
        with use_settings(settings):
            result=workflow.invoke({**body.model_dump(exclude={'material_ids','request_id'}),'context':context,'schedule_tasks':schedule_tasks,'materials':materials})
    except SafetyRefusal:raise
    except Exception as error:
        error_id=uuid.uuid4().hex[:12]
        detail=diagnose(error,error_id)
        log.warning('agent_failed request_id=%s route=%s code=%s error_type=%s upstream_status=%s',error_id,body.route,detail['code'],type(error).__name__,getattr(error,'status_code',None))
        raise HTTPException(422 if isinstance(error,ModelCapabilityError) else 502,detail)
    guard_model_output(result['result'])
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
        db.add(Record(id=run_id,owner=owner,kind='run',data={'route':result['route'],'image':bool(body.image),'input_source':body.text,'created_at':datetime.now(timezone.utc).isoformat(),'parent_plan_id':body.base_plan_id,'material_names':[item['name'] for item in materials],**result['result'],**dialogue,'status':'pending'}))
        ensure_stream_active()
        db.commit()
    metrics=result['result'].get('metrics',{})
    log.info('agent_completed run=%s route=%s seconds=%s model_calls=%s context_characters=%s',run_id,result['route'],metrics.get('total_seconds'),metrics.get('model_calls'),metrics.get('context_characters'))
    return {'id':run_id,'route':result['route'],**result['result']}
@router.post('/api/agent/{run_id}/review')
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
@router.get('/api/plans')
def list_plans(include_archived:bool=False,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        plans=[record for record in rows(db,owner,'run') if record.data.get('route')=='recommend' and not unpack(record.data).get('conversation_deleted') and (include_archived or not record.data.get('archived'))]
        plans.sort(key=lambda record:record.data.get('created_at') or record.data.get('reviewed_at') or '',reverse=True)
        results=[]
        for record in plans[:50]:
            plan=plan_payload(record,state['tasks'],state.get('expired_tasks',[]))
            results.append({'id':record.id,'title':plan['title'],'dialogue_title':plan['dialogue_title'],'created_at':plan['created_at'],'count':len(plan['items']),'archived':record.data.get('archived',False),'adopted_count':len(plan['adopted_indices'])})
        return results
@router.get('/api/plans/{plan_id}')
def get_plan(plan_id:str,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'准备方案不存在')
        return plan_payload(record,state['tasks'],state.get('expired_tasks',[]))

@router.patch('/api/plans/{plan_id}/conversation')
def rename_conversation(plan_id:str, body:ConversationTitle, owner=Depends(uid)):
    title=body.title.strip()
    if not title:raise HTTPException(422,'对话名称不能为空')
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend' or unpack(record.data).get('conversation_deleted'):raise HTTPException(404,'对话不存在')
        record.data={**unpack(record.data),'conversation_title':title}
        db.commit()
    return {'title':title}

def conversation_task_summary(tasks,plan_id):
    linked=[task for task in tasks if task.get('agent_run_id')==plan_id]
    completed=sum(bool(task.get('done')) for task in linked)
    version=hashlib.sha256(json.dumps(linked,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return {'total':len(linked),'completed':completed,'pending':len(linked)-completed,'version':version}

def conversation_all_tasks(state):
    return [*state.get('tasks',[]),*[item['task'] for item in state.get('expired_tasks',[])],*[item['task'] for item in state.get('task_trash',[])]]

@router.get('/api/plans/{plan_id}/conversation/deletion-preview')
def conversation_deletion_preview(plan_id:str, owner=Depends(uid)):
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'对话不存在')
    return conversation_task_summary(conversation_all_tasks(get_state(owner)),plan_id)

@router.delete('/api/plans/{plan_id}/conversation')
def delete_conversation(plan_id:str, delete_tasks:bool=False, task_version:str='', owner=Depends(uid)):
    with Session() as db:
        if db.bind.dialect.name=='sqlite':db.execute(text('BEGIN IMMEDIATE'))
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'对话不存在')
        jobs=rows(db,owner,'agent-job')
        if any(job.data.get('plan_id')==plan_id and public_job(job.data).get('status')=='running' for job in jobs):raise HTTPException(409,'对话仍在生成，请先停止生成后再删除')
        snapshot=db.get(Record,'state:'+owner,with_for_update=True)
        state=snapshot.data if snapshot else {'tasks':[],'evidence':[]}
        summary=conversation_task_summary(conversation_all_tasks(state),plan_id)
        if delete_tasks:
            if not task_version or task_version!=summary['version']:raise HTTPException(409,'关联任务已变化，请重新查看完成情况并确认删除')
            state={**state,'tasks':[task for task in state.get('tasks',[]) if task.get('agent_run_id')!=plan_id]}
            for field in ('expired_tasks','task_trash'):
                state[field]=[item for item in state.get(field,[]) if item['task'].get('agent_run_id')!=plan_id]
            if snapshot:snapshot.data=state
        data={**unpack(record.data)}
        data.pop('dialogue',None)
        data.update(conversation_deleted=True)
        record.data=data
        for job in jobs:
            if job.data.get('plan_id')==plan_id:db.delete(job)
        db.commit()
    return {'ok':True,'deleted_tasks':summary['total'] if delete_tasks else 0,**state}






def dialogue_plan(db, owner, plan_id, *, write=False):
    if write and db.bind.dialect.name == 'sqlite':
        db.execute(text('BEGIN IMMEDIATE'))
    record = db.get(Record, plan_id, with_for_update=write)
    if not record or record.owner != owner or record.kind != 'run' or record.data.get('route') != 'recommend':
        raise HTTPException(404, '准备方案不存在')
    if unpack(record.data).get('conversation_deleted'):raise HTTPException(404,'对话记录已删除')
    return record, unpack(record.data)


def dialogue_payload(record, data):
    chat = data.get('dialogue', {})
    pending = chat.get('pending')
    messages = chat.get('messages', [])
    can_withdraw = len(messages) >= 2 and [turn['role'] for turn in messages[-2:]] == ['user', 'assistant'] and not any(item.get('status')=='submitted' for item in messages[-1].get('evidence_candidates', []))
    token = hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest() if can_withdraw else None
    public_messages = [{key: value for key, value in turn.items() if key in ('role', 'text', 'skills', 'turn_id', 'evidence_candidates', 'sources', 'search_status')} for turn in messages]
    return {'id': record.id, 'title': plan_title(data), 'dialogue_title': dialogue_title(data), 'messages': public_messages, 'withdraw_token': token,
            'skill_profile': chat.get('skill_profile', 'auto'),
            'pending': {'id': pending['id'], 'preview': pending['preview']} if pending else None}


@router.get('/api/plans/{plan_id}/dialogue')
def get_dialogue(plan_id: str, owner=Depends(uid)):
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id)
        return dialogue_payload(record, data)


@router.post('/api/plans/{plan_id}/dialogue/evidence/{candidate_id}')
def submit_dialogue_evidence(plan_id: str, candidate_id: str, body: DialogueEvidenceReview, owner=Depends(uid)):
    if not body.title.strip() or not body.body.strip():
        raise HTTPException(422, '请填写证据标题和内容')
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id, write=True)
        data=json.loads(json.dumps(data))
        chat=data.get('dialogue', {})
        target=next(((turn,item) for turn in chat.get('messages', []) for item in turn.get('evidence_candidates', []) if item['id']==candidate_id),None)
        if not target:raise HTTPException(404, '候选证据不存在，请重新打开对话')
        turn, candidate=target
        snapshot=db.get(Record, 'state:'+owner, with_for_update=True)
        state=snapshot.data if snapshot else {'tasks':[], 'evidence':[]}
        if candidate.get('status')!='submitted':
            if len(state.get('evidence', []))>=5000:raise HTTPException(422, '证据数量已达上限，请先整理证据')
            evidence_id=max(int(datetime.now(timezone.utc).timestamp()*1000),max((e['id'] for e in state.get('evidence',[]) if type(e.get('id')) is int),default=0)+1)
            evidence={**body.model_dump(), 'title':body.title.strip(), 'body':body.body.strip(),
                      'id':evidence_id, 'status':'待确认', 'source_type':'dialogue', 'kind':candidate['kind'],
                      'source_plan_id':plan_id, 'source_turn_id':turn['turn_id'], 'source_quote':candidate['quote'],
                      'created_at':datetime.now(timezone.utc).isoformat()}
            state={**state, 'evidence':[evidence,*state.get('evidence', [])]}
            candidate.update(status='submitted', evidence_id=evidence_id)
            db.merge(Record(id='state:'+owner,owner=owner,kind='state',data=state))
            record.data={**data,'dialogue':chat}
        payload=dialogue_payload(record, data)
        db.commit()
        return {**payload,'evidence':state.get('evidence', [])}




@router.post('/api/plans/{plan_id}/dialogue/withdraw')
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


@router.post('/api/plans/{plan_id}/dialogue')
def send_dialogue(plan_id: str, body: DialogueMessage, owner=Depends(uid)):
    message = body.text.strip()
    guard_text(message)
    if not message:
        raise HTTPException(422, '请输入对话内容')
    with Session() as db:
        _, baseline = dialogue_plan(db, owner, plan_id)
    chat = baseline.get('dialogue', {})
    if chat.get('pending'):
        raise HTTPException(409, '请先确认或放弃上一轮调整建议')
    messages = chat.get('messages', [])
    latest_state = get_state(owner)
    tasks = latest_state['tasks']
    context = dialogue_context(baseline, tasks, plan_id, messages, message, latest_state.get('evidence', []),latest_state.get('expired_tasks',[]))
    skills = skills_for_request('recommend', body.skill_profile, plan_title(baseline))
    materials = read_plan_attachments(owner, body.material_ids, body.attachment_images)
    settings = runtime_settings(owner)
    begin_dialogue_request(owner,body.request_id)
    try:
        with use_settings(settings):
            state = {'context': redact_context(context), 'skills': skills}
            if materials or body.attachment_images:
                state.update(materials=materials, attachment_images=body.attachment_images)
            result = dialogue_workflow.invoke(state)['result']
    except SafetyRefusal:raise
    except Exception as error:
        error_id = uuid.uuid4().hex[:12]
        detail = diagnose(error, error_id, operation='dialogue')
        log.warning('dialogue_failed request_id=%s code=%s error_type=%s upstream_status=%s validation=%s', error_id, detail['code'], type(error).__name__, getattr(error,'status_code',None), detail.get('validation', []))
        raise HTTPException(502, detail)
    guard_model_output(result)
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id, write=True)
        finish_dialogue_request(db,owner,body.request_id)
        if data != baseline:
            raise HTTPException(409, '方案或对话已有更新，请重新打开后再发送')
        snapshot = db.get(Record, 'state:' + owner, with_for_update=True)
        if snapshot:snapshot.data=sweep_expired(snapshot.data)
        current_tasks = snapshot.data['tasks'] if snapshot else []
        archived=snapshot.data.get('expired_tasks',[]) if snapshot else []
        if dialogue_context(data, current_tasks, plan_id, messages, message, snapshot.data.get('evidence', []) if snapshot else [],archived) != context:
            raise HTTPException(409, '相关日程或能力证据已有更新，请重新发送')
        linked_expired=[item['task'] for item in archived if item['task'].get('agent_run_id')==plan_id]
        preview = prepare_changes(data, [*current_tasks,*linked_expired], plan_id, result['changes'])
        pending = {'id': str(uuid.uuid4()), 'changes': result['changes'], 'preview': preview} if preview else None
        memory = result.get('memory') if result.get('memory') is not None else chat.get('memory', '')
        candidates=[{**item,'id':uuid.uuid4().hex,'status':'pending'} for item in result.get('evidence_candidates', [])
                    if item.get('quote') and item['quote'] in message]
        data = {**data, 'dialogue': {'messages': [*messages, {'role': 'user', 'text': message},
                {'role': 'assistant', 'text': result['reply'], 'skills': [SKILL_LABELS[key] for key in skills],
                 'turn_id': uuid.uuid4().hex, 'evidence_candidates':candidates, 'previous_memory': chat.get('memory', ''),
                 'sources':result.get('sources', []), 'search_status':result.get('search_status', {})}],
                'skill_profile': body.skill_profile, 'pending': pending,
                'memory': memory}}
        record.data = data
        payload = dialogue_payload(record, data)
        ensure_stream_active()
        db.commit()
        return payload


@router.post('/api/plans/{plan_id}/dialogue/decision')
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
            if snapshot:snapshot.data=sweep_expired(snapshot.data)
            current_tasks = snapshot.data['tasks'] if snapshot else []
            archived=snapshot.data.get('expired_tasks',[]) if snapshot else []
            linked_expired=[item['task'] for item in archived if item['task'].get('agent_run_id')==plan_id]
            combined=[*current_tasks,*linked_expired]
            preview = prepare_changes(data, combined, plan_id, pending['changes'])
            if preview != pending['preview']:
                raise HTTPException(409, '涉及的任务已更新，请放弃旧建议并重新生成')
            linked=linked_tasks(combined,plan_id,plan_items(data))
            touched={linked[change['index']]['id'] for change in preview if change.get('expired') and change['index'] in linked}
            data, combined_updated = apply_changes(data, combined, plan_id, preview)
            hidden={task['id'] for task in linked_expired}-touched
            updated_tasks=stamp_tasks([{**task,'restored_at':datetime.now(timezone.utc).isoformat()} if task['id'] in touched else task for task in combined_updated if task['id'] not in hidden],combined)
            if snapshot:
                validate_tasks(updated_tasks)
                snapshot.data = sweep_expired({**snapshot.data, 'tasks': updated_tasks,'expired_tasks':[item for item in archived if item['task']['id'] not in touched]})
                updated_tasks=snapshot.data['tasks']
        note = '已应用本轮调整。' if body.apply else '已放弃本轮调整。'
        data = {**data, 'dialogue': {**chat, 'pending': None, 'messages': [
            *chat['messages'], {'role': 'system', 'text': note}]}}
        record.data = data
        payload = dialogue_payload(record, data)
        db.commit()
        return {**payload, 'tasks': updated_tasks, 'expired_tasks':snapshot.data.get('expired_tasks',[]) if body.apply and snapshot else None}


@router.post('/api/plans/{plan_id}/copy')
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
@router.post('/api/plans/{plan_id}/archive')
def archive_plan(plan_id:str,body:ArchiveInput,owner=Depends(uid)):
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'准备方案不存在')
        record.data={**record.data,'archived':body.archived};db.commit()
    return {'ok':True}
@router.delete('/api/plans/{plan_id}')
def delete_plan(plan_id:str,owner=Depends(uid)):
    state=get_state(owner)
    if any(task.get('agent_run_id')==plan_id for task in state['tasks']):raise HTTPException(409,'该方案仍被正式任务引用，请使用归档保留来源')
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,'准备方案不存在')
        db.delete(record);db.commit()
    return {'ok':True}
@router.get('/api/memory')
def memory_stats(owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        records=rows(db,owner,'run');eligible=cleanup_candidates(records,state['tasks'])
        return {'records':len(records),'bytes':sum(record_bytes(record) for record in records),'compressed':sum('_compressed_v1' in record.data for record in records),'archived':sum(bool(record.data.get('archived')) for record in records),'cleanup_count':len(eligible),'context_limit_characters':12000}
@router.post('/api/memory/compact')
def compact_memory(owner=Depends(uid)):
    with Session() as db:
        records=rows(db,owner,'run');before=sum(record_bytes(record) for record in records);changed=0
        for record in records:
            if '_compressed_v1' in record.data:continue
            compacted=pack(record.data)
            if '_compressed_v1' in compacted:record.data=compacted;changed+=1
        db.commit();after=sum(record_bytes(record) for record in records)
        return {'compressed':changed,'bytes_saved':max(0,before-after)}
@router.post('/api/memory/cleanup-preview')
def preview_cleanup(body:MemoryAction,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        records=cleanup_candidates(rows(db,owner,'run'),conversation_all_tasks(state),body.older_than_days,body.keep_recent)
        return {'count':len(records),'bytes':sum(record_bytes(record) for record in records)}
@router.post('/api/memory/cleanup')
def cleanup_memory(body:MemoryAction,owner=Depends(uid)):
    state=get_state(owner)
    with Session() as db:
        records=cleanup_candidates(rows(db,owner,'run'),conversation_all_tasks(state),body.older_than_days,body.keep_recent)
        for record in records:db.delete(record)
        db.commit();return {'deleted':len(records)}
@router.get('/api/report')
def report(owner=Depends(uid)):
    state=get_state(owner); evidence=[e for e in state['evidence'] if e.get('status')=='已接受']
    return {'generated_at':datetime.now(timezone.utc).isoformat(),'execution_reference':execution_context(state['tasks'],expired_tasks=state.get('expired_tasks',[])),'dimensions':[{'name':d,'evidence':[e for e in evidence if e.get('dim')==i],'level':'已有过程证据，水平待评估' if any(e.get('dim')==i for e in evidence) else '证据不足','trend':'暂无可比历史','confidence':'有限','next':'补充含问题、方法、对照数据和反思的作品'} for i,d in enumerate(DIMENSIONS)]}
@router.get('/api/health')
def health():
    with Session() as db: db.execute(select(Record.id).limit(1))
    return {'status':'ok','agent':os.getenv('MODEL_PROVIDER','qwen') if os.getenv('MODEL_API_KEY') else 'offline','model':os.getenv('MODEL_NAME') if os.getenv('MODEL_API_KEY') else None,'database': 'postgresql' if os.getenv('DATABASE_URL','').startswith('postgresql') else 'sqlite-local'}

root=PROJECT_ROOT
@router.post('/api/files')
async def upload(file:UploadFile=File(...),owner=Depends(uid)):
    ext=Path(file.filename or '').suffix.lower()
    if ext not in ['.pdf','.txt','.md','.png','.jpg','.jpeg','.webp']: raise HTTPException(422,'支持PDF、文本与图片附件')
    data=await file.read(10*1024*1024+1)
    if len(data)>10*1024*1024: raise HTTPException(413,'附件不得超过10MB')
    key=str(uuid.uuid4()); folder=root/'uploads';folder.mkdir(exist_ok=True)
    text=''
    if ext in ['.txt','.md']:
        try:text=data.decode('utf-8')
        except UnicodeDecodeError:raise HTTPException(422,'文本附件需采用UTF-8编码')
    elif ext=='.pdf':
        try:
            import pymupdf
            with pymupdf.open(stream=data,filetype='pdf') as doc:text='\n'.join(page.get_text() for page in doc)
        except Exception:raise HTTPException(422,'PDF无法解析，请粘贴正文或上传有效PDF')
    guard_text(file.filename or '',strict=False)
    guard_text(text,strict=False)
    (folder/key).write_bytes(data)
    with Session() as db:
        db.add(Record(id='file:'+key,owner=owner,kind='file',data={'name':file.filename,'text':text[:30000]}));db.commit()
    return {'id':key,'name':file.filename,'text':text[:30000],'url':'/api/files/'+key}
@router.get('/api/files/{key}')
def download(key:str,owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,'file:'+key)
        if not row or row.owner!=owner: raise HTTPException(404,'附件不存在')
        return FileResponse(root/'uploads'/key,filename=row.data['name'],media_type='application/octet-stream')


@router.post('/api/agent/stream')
def agent_stream(body:AgentInput, request:Request, owner=Depends(uid)):
    guard_text(body.text)
    if body.dialogue_message:guard_text(body.dialogue_message)
    read_plan_attachments(owner,body.material_ids,body.attachment_images)
    body=body.model_copy(update={'request_id':body.request_id or uuid.uuid4()})
    return stream_response(request,owner,body.request_id,lambda:agent(body,owner),{'initial':True,'text':body.dialogue_message or body.text,'constraints':body.text})


@router.post('/api/plans/{plan_id}/dialogue/stream')
def dialogue_stream(plan_id:str, body:DialogueMessage, request:Request, owner=Depends(uid)):
    guard_text(body.text)
    read_plan_attachments(owner,body.material_ids,body.attachment_images)
    body=body.model_copy(update={'request_id':body.request_id or uuid.uuid4()})
    return stream_response(request,owner,body.request_id,lambda:send_dialogue(plan_id,body,owner),{'initial':False,'plan_id':plan_id,'text':body.text})


@router.get('/api/agent-jobs')
def get_agent_jobs(owner=Depends(uid)):
    with Session() as db:
        jobs=db.scalars(select(Record).where(Record.owner==owner,Record.kind=='agent-job').order_by(Record.data['created_at'].as_string().desc()).limit(20))
        return [{key:data.get(key) for key in ('request_id','status','plan_id','initial','text','created_at','conversation_title')} for data in (public_job(row.data) for row in jobs)]

@router.patch('/api/agent-jobs/{request_id}/conversation')
def rename_job_conversation(request_id:uuid.UUID, body:ConversationTitle, owner=Depends(uid)):
    title=body.title.strip()
    if not title:raise HTTPException(422,'对话名称不能为空')
    with Session() as db:
        row=db.get(Record,job_key(owner,request_id))
        if not row or row.owner!=owner:raise HTTPException(404,'对话记录不存在')
        if public_job(row.data).get('status')=='running':raise HTTPException(409,'请等待生成结束后再重命名')
        row.data={**row.data,'conversation_title':title}
        db.commit()
    return {'title':title}

@router.delete('/api/agent-jobs/{request_id}/conversation')
def delete_job_conversation(request_id:uuid.UUID, owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,job_key(owner,request_id))
        if not row or row.owner!=owner:raise HTTPException(404,'对话记录不存在')
        if public_job(row.data).get('status')=='running':raise HTTPException(409,'请先停止生成后再删除')
        db.delete(row)
        db.commit()
    return {'ok':True}


@router.get('/api/agent-jobs/{request_id}')
def get_agent_job(request_id:uuid.UUID, owner=Depends(uid)):
    with Session() as db:
        row=db.get(Record,job_key(owner,request_id))
        if not row or row.owner!=owner:raise HTTPException(404,'生成任务不存在')
        job=public_job(row.data)
        if job.get('status')=='completed':
            record=db.get(Record,job.get('plan_id'))
            if not record or record.owner!=owner:raise HTTPException(404,'对应方案已删除')
            job['result']={'id':record.id,'route':'recommend'} if job.get('initial') else dialogue_payload(record,unpack(record.data))
        return job
