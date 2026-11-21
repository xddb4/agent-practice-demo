import uuid
from datetime import datetime,timezone,timedelta
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.db import Record,Session
import backend.app.services.task_lifecycle as lifecycle


def account():
    client=TestClient(app)
    user=client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123'}).json()
    return client,user['id']


def test_timestamps_restore_and_execution_context_without_inventing_ability(monkeypatch):
    class Clock(datetime):
        value=datetime(2026,11,21,2,0,tzinfo=timezone.utc)
        @classmethod
        def now(cls,tz=None):return cls.value
    monkeypatch.setattr(lifecycle,'datetime',Clock)
    client,owner=account()
    state=client.put('/api/state',json={'tasks':[{'id':1,'title':'精听','q':1,'done':False}],'evidence':[]}).json()
    task=state['tasks'][0]
    assert task['created_at']=='2026-11-21T02:00:00+00:00'
    Clock.value+=timedelta(minutes=45)
    trash={'trashId':'one','task':task,'index':0,'deletedAt':Clock.value.isoformat()}
    assert client.put('/api/state',json={'tasks':[],'evidence':[],'task_trash':[trash]}).status_code==200
    stored=client.get('/api/state').json()
    assert stored['task_trash'][0]['task']['created_at']==task['created_at']
    other,_=account()
    assert other.get('/api/state').json().get('task_trash',[])==[]
    restored=client.put('/api/state',json={'tasks':[stored['task_trash'][0]['task']],'evidence':[],'task_trash':[]}).json()
    assert restored['tasks'][0]['created_at']==task['created_at']
    restored['tasks'][0]['done']=True
    done=client.put('/api/state',json={'tasks':restored['tasks'],'evidence':[],'task_trash':[]}).json()
    assert done['tasks'][0]['elapsed_minutes']==45
    assert done['evidence'][0]['elapsed_minutes']==45
    report=client.get('/api/report').json()
    assert report['execution_reference']['known_elapsed_tasks']==1
    assert all(d['level']=='证据不足' for d in report['dimensions'])
    reopened=client.post('/api/tasks/1/reopen',json={}).json()
    assert reopened['tasks'][0]['completed_at'] is None and not reopened['tasks'][0]['done']
    assert reopened['tasks'][0]['created_at']==task['created_at']


def test_permanent_delete_removes_task_evidence_trash_statistics_and_rejects_stale_save():
    client,owner=account()
    state=client.put('/api/state',json={'tasks':[{'id':31,'title':'已完成','q':1,'done':True}],'evidence':[]}).json()
    old={'tasks':state['tasks'],'evidence':state['evidence'],'task_trash':[]}
    other,_=account()
    assert other.delete('/api/tasks/31/completed').status_code==404
    assert client.delete('/api/tasks/31/completed').status_code==200
    after=client.get('/api/state').json()
    assert after=={'tasks':[],'evidence':[],'task_trash':[],'expired_tasks':[]}
    assert client.get('/api/completion-stats').json()['completed_tasks']==0
    assert client.put('/api/state',json=old).status_code==409
    assert client.put('/api/state',json={'tasks':[],'evidence':old['evidence'],'task_trash':[]}).status_code==409


def test_backfill_keeps_legacy_task_times_unknown_and_trash_private():
    client,owner=account()
    with Session() as db:
        db.merge(Record(id='state:'+owner,owner=owner,kind='state',data={'tasks':[{'id':5,'title':'旧完成任务','q':1,'done':True,'date':'2026-11-01'}],'evidence':[]}))
        db.commit()
    task=client.get('/api/state').json()['tasks'][0]
    assert task['created_at'] is None and task['completed_at'] is None
    other,_=account()
    assert other.get('/api/state').json().get('task_trash',[])==[]
