import uuid
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.db import Record, Session
import backend.app.api.routes as routes


def account():
    client=TestClient(app)
    user=client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123'}).json()
    return client,user['id']


def test_expiry_restore_is_authoritative_private_and_preserves_creation():
    client,owner=account()
    task={'id':1,'title':'精听','q':1,'ddl':'2000-01-01','agent_run_id':'mine','proposal_index':0}
    initial=client.put('/api/state',json={'tasks':[task],'evidence':[]}).json()
    assert initial['tasks']==[] and len(initial['expired_tasks'])==1
    original=initial['expired_tasks'][0]['task']
    assert original['created_at']
    stale=client.put('/api/state',json={'tasks':[{**task,'ddl':'2090-01-01','done':True}],'evidence':[]}).json()
    assert stale['tasks']==[] and len(stale['expired_tasks'])==1
    duplicate=client.put('/api/state',json={'tasks':[{**task,'id':2,'ddl':'2090-01-01'}],'evidence':[]})
    assert duplicate.status_code==409
    other,_=account()
    body={'date':'2090-01-01','deadline':'2090-01-02','duration':20}
    assert other.post('/api/tasks/1/restore-expired',json=body).status_code==404
    assert client.post('/api/tasks/1/restore-expired',json={'date':'2090-01-01','deadline':'2090-01-02'}).status_code==422
    assert client.post('/api/tasks/1/restore-expired',json={**body,'date':'2000-01-01'}).status_code==422
    restored=client.post('/api/tasks/1/restore-expired',json=body).json()
    assert restored['expired_tasks']==[] and restored['tasks'][0]['duration']==20
    assert restored['tasks'][0]['created_at']==original['created_at']
    assert client.post('/api/tasks/1/restore-expired',json=body).status_code==404


def test_report_samples_expired_without_changing_ability_and_new_chat_ignores_them(monkeypatch):
    client,owner=account()
    client.put('/api/state',json={'tasks':[{'id':i,'title':'练习','q':1,'ddl':'2000-01-01','agent_run_id':'other'} for i in range(10)],'evidence':[]})
    report=client.get('/api/report').json()
    reference=report['execution_reference']['expired_reference']
    assert reference['total']==10 and reference['included']==8
    assert all(item['level']=='证据不足' for item in report['dimensions'])
    def invoke(state):
        assert state['context']['execution_reference']['expired_reference']['total']==0
        return {'route':'recommend','result':{'items':[],'dialogue_reply':'先核对可投入时间。'}}
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    monkeypatch.setattr(routes.workflow,'invoke',invoke)
    assert client.post('/api/agent',json={'route':'recommend','text':'准备考试'}).status_code==200


def test_chat_proposal_requires_confirmation_and_only_restores_its_own_expiry(monkeypatch):
    client,owner=account()
    plan=str(uuid.uuid4())
    with Session() as db:
        db.add(Record(id=plan,owner=owner,kind='run',data={'route':'recommend','items':[{'title':'精听','date':'2000-01-01','estimated_minutes':30}]}))
        db.commit()
    original=[{'id':1,'title':'精听','q':1,'ddl':'2000-01-01','agent_run_id':plan,'proposal_index':0},
              {'id':2,'title':'其他对话练习','q':1,'ddl':'2000-01-01','agent_run_id':'other','proposal_index':0}]
    client.put('/api/state',json={'tasks':original,'evidence':[]})
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    def invoke(state):
        context=state['context']
        assert context['本对话过期任务参考']['total']==1
        assert '其他对话练习' not in str(context)
        return {'result':{'reply':'建议重新安排，请确认。','changes':[{'action':'modify','index':0,'fields':{'date':'2090-01-01','deadline':'2090-01-02','estimated_minutes':20}}]}}
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    path=f'/api/plans/{plan}'
    assert client.get(path).json()['expired_indices']==[0]
    response=client.post(path+'/dialogue',json={'text':'这些任务不合适，请调整'})
    assert response.status_code==200,response.text
    assert client.get('/api/state').json()['tasks']==[]
    pending=response.json()['pending']
    applied=client.post(path+'/dialogue/decision',json={'proposal_id':pending['id'],'apply':True})
    assert applied.status_code==200,applied.text
    state=client.get('/api/state').json()
    assert [task['id'] for task in state['tasks']]==[1]
    assert [item['task']['id'] for item in state['expired_tasks']]==[2]
    assert client.get(path).json()['expired_indices']==[]


def test_confirmed_cancellation_removes_only_own_expired_task(monkeypatch):
    client,owner=account()
    plan=str(uuid.uuid4())
    with Session() as db:
        db.add(Record(id=plan,owner=owner,kind='run',data={'route':'recommend','items':[{'title':'可取消任务'}]}))
        db.commit()
    client.put('/api/state',json={'tasks':[{'id':1,'title':'可取消任务','q':1,'ddl':'2000-01-01','agent_run_id':plan,'proposal_index':0},{'id':2,'title':'其他任务','q':1,'ddl':'2000-01-01','agent_run_id':'other'}],'evidence':[]})
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',lambda _:{'result':{'reply':'建议取消这项任务，请确认。','changes':[{'action':'cancel','index':0}]}})
    path=f'/api/plans/{plan}/dialogue'
    response=client.post(path,json={'text':'这个任务不适合，请取消'})
    assert response.status_code==200,response.text
    assert len(client.get('/api/state').json()['expired_tasks'])==2
    assert client.post(path+'/decision',json={'proposal_id':response.json()['pending']['id'],'apply':True}).status_code==200
    assert [item['task']['id'] for item in client.get('/api/state').json()['expired_tasks']]==[2]


def test_conversation_optional_task_deletion_includes_expired_entries():
    client,owner=account()
    plan=str(uuid.uuid4())
    with Session() as db:
        db.add(Record(id=plan,owner=owner,kind='run',data={'route':'recommend','items':[]}))
        db.commit()
    client.put('/api/state',json={'tasks':[{'id':1,'title':'过期练习','q':1,'ddl':'2000-01-01','agent_run_id':plan},{'id':2,'title':'其他任务','q':1,'ddl':'2000-01-01','agent_run_id':'other'}],'evidence':[]})
    path=f'/api/plans/{plan}/conversation'
    preview=client.get(path+'/deletion-preview').json()
    assert preview['total']==1 and preview['pending']==1
    response=client.delete(path+'?delete_tasks=true&task_version='+preview['version'])
    assert response.status_code==200,response.text
    assert [item['task']['id'] for item in response.json()['expired_tasks']]==[2]
