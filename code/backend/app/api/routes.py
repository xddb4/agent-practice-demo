import os, uuid, secrets, hashlib, hmac, logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends, Request, Response, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from ..core.db import Session, Record
from core_engine.ai.workflows.pilot import workflow, DIMENSIONS
from core_engine.ai.skills import SKILL_LABELS, skills_for_request
from core_engine.ai.workflows.plan_dialogue import workflow as dialogue_workflow
from ..services.agent_errors import diagnose
from ..services.request_errors import invalid_agent_input
from ..services.plans import plan_title,plan_payload,dialogue_title
from ..services.plan_dialogue import dialogue_context, prepare_changes
from ..services.tasks import validate_tasks
from ..schemas.requests import DialogueEvidenceReview
from ..services.stream_events import ensure_stream_active
from .streaming import stream_response, cancel_stream, job_key, public_job
from .model_settings import router as model_settings_router
from ..services.memory import unpack,pack,record_bytes,cleanup_candidates
from ..services.completion_stats import merge_completion_ids
from ..services.completion_evidence import completion_snapshot
from ..services.task_lifecycle import stamp_tasks, execution_context
from ..services.ai_safety import SafetyRefusal, guard_text, guard_model_output, redact_context
from ..services.task_expiry import sweep_expired, expired, expiry_reference, LOCAL as EXPIRY_LOCAL
from ..schemas.requests import RestoreExpiredTask
from ..services.model_settings import runtime_settings, use_settings
from ..schemas.agent import output_contract
from pydantic import ValidationError
import json

from ..core.application import app
from ..core.auth import uid, digest
from ..core.config import PROJECT_ROOT
from ..repositories.records import rows
from ..repositories.state import StateRepository
from ..repositories.plans import PlanRepository, PLAN_NOT_FOUND, CONVERSATION_NOT_FOUND
from ..repositories.transactions import begin_write
from ..services.attachments import AttachmentService
from ..services.agent_generation import AgentGenerationService
from ..services.conversations import ConversationService, conversation_all_tasks, conversation_task_summary
from ..services.dialogue_decisions import DialogueDecisionService
from ..services.state_snapshot import StateSnapshotService
from ..schemas.requests import Credentials, Snapshot, AgentInput, CandidateReview, DialogueMessage, DialogueDecision, DialogueWithdrawal, ArchiveInput, MemoryAction, ConversationTitle
router = APIRouter()
router.include_router(model_settings_router)

@app.exception_handler(RequestValidationError)
async def validation_error(request:Request,error):
    if request.url.path.startswith('/api/model-settings'):
        return JSONResponse(status_code=422,content={'detail':{'message':'模型配置字段无效，请核对 HTTPS 地址、模型名称和密钥长度','errors':[{'field':'.'.join(map(str,x['loc'])),'type':x['type']} for x in error.errors()]}})
    if request.url.path in ('/api/agent','/api/agent/stream') or '/dialogue' in request.url.path:
        return JSONResponse(status_code=422,content={'detail':invalid_agent_input(error.errors())})
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
        row=StateRepository(db, owner).get()
        if not row:return {'tasks':[],'evidence':[]}
        trash=row.data.get('task_trash',[])
        stamped=stamp_tasks(row.data.get('tasks',[]),row.data.get('tasks',[]))
        data=sweep_expired({**completion_snapshot(stamped,row.data.get('evidence',[])), 'task_trash':trash,'expired_tasks':row.data.get('expired_tasks',[])})
        if data != row.data:
            row.data=data
            db.commit()
        return data
@router.put('/api/state', responses={
    422: {'description': '任务、证据或回收站字段无效'},
    409: {'description': '任务重复、状态冲突或尝试恢复永久删除的记录'},
})
def put_state(body: Snapshot, owner=Depends(uid)):
    with Session() as db:
        snapshot = StateSnapshotService(StateRepository(db, owner)).save(body)
        db.commit()
    return {'ok': True, **snapshot}


@router.post('/api/tasks/{task_id}/reopen')
def reopen_completed_task(task_id:str,owner=Depends(uid)):
    with Session() as db:
        begin_write(db)
        row=StateRepository(db, owner).get(for_update=True)
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
        begin_write(db)
        row=StateRepository(db, owner).get(for_update=True)
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
        begin_write(db)
        row=StateRepository(db, owner).get(for_update=True)
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
        state=StateRepository(db, owner).get()
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
        begin_write(db)
        row=lock_dialogue_request(db,owner,request_id)
        if row not in db.new: raise HTTPException(409,'这次请求已经撤回或提交')
        try: db.commit()
        except IntegrityError: raise HTTPException(409,'这次请求已经撤回或提交') from None


@router.post('/api/dialogue-requests/{request_id}/cancel')
def cancel_dialogue_request(request_id:uuid.UUID,owner=Depends(uid)):
    with Session() as db:
        begin_write(db)
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


def read_plan_attachments(owner, material_ids, images, *, text_limit=3500):
    return AttachmentService(root).read_plan_materials(owner, material_ids, images, text_limit=text_limit)



@router.post('/api/agent', responses={
    404: {'description': '参考方案或辅助资料不存在'},
    409: {'description': '模型未配置或请求状态冲突'},
    422: {'description': '输入、图片格式或安全边界校验失败'},
    502: {'description': '模型生成失败'},
})
def agent(body: AgentInput, owner=Depends(uid)):
    service = AgentGenerationService(
        workflow=workflow, load_state=get_state, load_settings=runtime_settings,
        read_attachments=read_plan_attachments, begin_request=begin_dialogue_request,
        finish_request=finish_dialogue_request,
    )
    return service.generate(body, owner)


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
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,PLAN_NOT_FOUND)
        return plan_payload(record,state['tasks'],state.get('expired_tasks',[]))

@router.patch('/api/plans/{plan_id}/conversation')
def rename_conversation(plan_id:str, body:ConversationTitle, owner=Depends(uid)):
    title=body.title.strip()
    if not title:raise HTTPException(422,'对话名称不能为空')
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend' or unpack(record.data).get('conversation_deleted'):raise HTTPException(404,CONVERSATION_NOT_FOUND)
        record.data={**unpack(record.data),'conversation_title':title}
        db.commit()
    return {'title':title}




@router.get('/api/plans/{plan_id}/conversation/deletion-preview')
def conversation_deletion_preview(plan_id:str, owner=Depends(uid)):
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,CONVERSATION_NOT_FOUND)
    return conversation_task_summary(conversation_all_tasks(get_state(owner)),plan_id)


@router.delete('/api/plans/{plan_id}/conversation', responses={
    404: {'description': CONVERSATION_NOT_FOUND},
    409: {'description': '对话正在生成或关联任务已变化'},
})
def delete_conversation(plan_id: str, delete_tasks: bool = False, task_version: str = '', owner=Depends(uid)):
    with Session() as db:
        result = ConversationService(db, owner, public_job).delete(
            plan_id, delete_tasks=delete_tasks, task_version=task_version,
        )
        db.commit()
    return result



def dialogue_plan(db, owner, plan_id, *, write=False):
    begin_write(db, enabled=write)
    return PlanRepository(db, owner).conversation(plan_id, for_update=write)


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
        snapshot=StateRepository(db, owner).get(for_update=True)
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
            StateRepository(db, owner).save(state)
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
        snapshot = StateRepository(db, owner).get(for_update=True)
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



@router.post('/api/plans/{plan_id}/dialogue/decision', responses={
    404: {'description': '方案或对话不存在'},
    409: {'description': '建议已处理或相关任务发生变化'},
    422: {'description': '调整内容不符合任务约束'},
})
def decide_dialogue(plan_id: str, body: DialogueDecision, owner=Depends(uid)):
    with Session() as db:
        record, data = dialogue_plan(db, owner, plan_id, write=True)
        service = DialogueDecisionService(StateRepository(db, owner))
        data, updated_tasks, archived = service.decide(data, plan_id, body)
        record.data = data
        payload = dialogue_payload(record, data)
        db.commit()
    return {**payload, 'tasks': updated_tasks, 'expired_tasks': archived}


@router.post('/api/plans/{plan_id}/copy')
def copy_plan(plan_id:str,owner=Depends(uid)):
    with Session() as db:
        source=db.get(Record,plan_id)
        if not source or source.owner!=owner or source.kind!='run' or source.data.get('route')!='recommend':raise HTTPException(404,PLAN_NOT_FOUND)
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
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,PLAN_NOT_FOUND)
        record.data={**record.data,'archived':body.archived};db.commit()
    return {'ok':True}
@router.delete('/api/plans/{plan_id}')
def delete_plan(plan_id:str,owner=Depends(uid)):
    state=get_state(owner)
    if any(task.get('agent_run_id')==plan_id for task in state['tasks']):raise HTTPException(409,'该方案仍被正式任务引用，请使用归档保留来源')
    with Session() as db:
        record=db.get(Record,plan_id)
        if not record or record.owner!=owner or record.kind!='run' or record.data.get('route')!='recommend':raise HTTPException(404,PLAN_NOT_FOUND)
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

@router.post('/api/files', responses={
    413: {'description': '附件超过大小限制'},
    422: {'description': '附件类型、正文或敏感信息校验失败'},
})
async def upload(file: UploadFile = File(...), owner=Depends(uid)):
    return await AttachmentService(root).upload(file, owner)


@router.get('/api/files/{key}', responses={404: {'description': '附件不存在或不可访问'}})
def download(key: str, owner=Depends(uid)):
    path, name = AttachmentService(root).download(key, owner)
    return FileResponse(path, filename=name, media_type='application/octet-stream')


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
