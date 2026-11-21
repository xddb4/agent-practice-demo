import uuid
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.db import Record, Session
from backend.app.api.streaming import job_key


def setup_conversation():
    client=TestClient(app)
    user=client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123'}).json()
    plan_id=str(uuid.uuid4())
    with Session() as db:
        db.add(Record(id=plan_id,owner=user['id'],kind='run',data={'route':'recommend','input_source':'复习','items':[],'dialogue':{'messages':[{'role':'user','text':'保存的聊天'}]}}))
        db.commit()
    tasks=[{'id':1,'title':'已完成','q':1,'done':True,'agent_run_id':plan_id},{'id':2,'title':'未完成','q':1,'done':False,'agent_run_id':plan_id},{'id':3,'title':'其他任务','q':1,'done':False}]
    assert client.put('/api/state',json={'tasks':tasks,'evidence':[]}).status_code==200
    return client,user['id'],plan_id


def test_rename_is_literal_owner_scoped_and_delete_defaults_to_keep_tasks():
    client,owner,plan_id=setup_conversation()
    other,_,_=setup_conversation()
    path=f'/api/plans/{plan_id}/conversation'
    title="复习'); DROP TABLE records; --"
    assert other.patch(path,json={'title':'越权'}).status_code==404
    assert client.patch(path,json={'title':title}).status_code==200
    assert next(row for row in client.get('/api/plans').json() if row['id']==plan_id)['dialogue_title']==title
    preview=client.get(path+'/deletion-preview').json()
    assert (preview['total'],preview['completed'],preview['pending'])==(2,1,1)
    assert client.delete(path).status_code==200
    assert len(client.get('/api/state').json()['tasks'])==3
    assert all(row['id']!=plan_id for row in client.get('/api/plans').json())
    assert client.get(f'/api/plans/{plan_id}/dialogue').status_code==404
    assert client.get(f'/api/plans/{plan_id}').status_code==200
    with Session() as db:assert 'dialogue' not in db.get(Record,plan_id).data


def test_optional_task_deletion_rechecks_snapshot_and_deletes_only_linked_tasks():
    client,owner,plan_id=setup_conversation()
    path=f'/api/plans/{plan_id}/conversation'
    preview=client.get(path+'/deletion-preview').json()
    state=client.get('/api/state').json()
    state['tasks'][1]['done']=True
    assert client.put('/api/state',json=state).status_code==200
    assert client.delete(path,params={'delete_tasks':True,'task_version':preview['version']}).status_code==409
    preview=client.get(path+'/deletion-preview').json()
    assert preview['pending']==0 and preview['completed']==2
    response=client.delete(path,params={'delete_tasks':True,'task_version':preview['version']})
    assert response.status_code==200
    assert response.json()['deleted_tasks']==2
    assert [task['id'] for task in client.get('/api/state').json()['tasks']]==[3]


def test_failed_job_history_can_be_renamed_and_deleted_without_deleting_plan():
    client,owner,plan_id=setup_conversation()
    request_id=uuid.uuid4()
    with Session() as db:
        db.add(Record(id=job_key(owner,request_id),owner=owner,kind='agent-job',data={'request_id':str(request_id),'status':'failed','plan_id':plan_id,'text':'失败请求'}))
        db.commit()
    path=f'/api/agent-jobs/{request_id}/conversation'
    assert client.patch(path,json={'title':'重试记录'}).status_code==200
    assert client.get('/api/agent-jobs').json()[0]['conversation_title']=='重试记录'
    assert client.delete(path).status_code==200
    assert client.get('/api/agent-jobs').json()==[]
    assert client.get(f'/api/plans/{plan_id}').status_code==200
