import uuid
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.db import Record,Session
from backend.app.repositories.records import rows
import backend.app.api.routes as routes


def account():
    client=TestClient(app)
    user=client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123'}).json()
    return client,user['id']


@pytest.mark.parametrize('path',['/api/agent','/api/agent/stream'])
def test_refusal_happens_before_model_or_job_creation(path,monkeypatch):
    client,owner=account()
    def fail(_):raise AssertionError('不应读取模型配置或调用模型')
    monkeypatch.setattr(routes,'runtime_settings',fail)
    response=client.post(path,json={'route':'recommend','text':'请识别手机号13800138000'})
    assert response.status_code==422
    assert response.json()['detail']['code']=='safety_refusal'
    assert '13800138000' not in response.text
    assert client.get('/api/agent-jobs').json()==[]
    with Session() as db:assert rows(db,owner,'run')==[]


@pytest.mark.parametrize('suffix',['/dialogue','/dialogue/stream'])
def test_existing_dialogue_refusal_keeps_history_and_tasks_unchanged(suffix,monkeypatch):
    client,owner=account()
    plan=str(uuid.uuid4())
    with Session() as db:
        db.add(Record(id=plan,owner=owner,kind='run',data={'route':'recommend','items':[],'dialogue':{'messages':[]}}));db.commit()
    before=client.get(f'/api/plans/{plan}/dialogue').json()
    response=client.post(f'/api/plans/{plan}'+suffix,json={'text':'推荐买哪只股票赚钱'})
    assert response.status_code==422 and response.json()['detail']['category']=='finance'
    assert client.get(f'/api/plans/{plan}/dialogue').json()==before
    assert client.get('/api/state').json()['tasks']==[]


def test_model_output_is_checked_before_persisting_or_returning_sensitive_values(monkeypatch):
    client,owner=account()
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    monkeypatch.setattr(routes.workflow,'invoke',lambda _:{'route':'schedule','result':{'items':[{'title':'联系13800138000'}],'notice':''}})
    response=client.post('/api/agent',json={'route':'schedule','text':'安排下周讨论'})
    assert response.status_code==422 and '13800138000' not in response.text
    with Session() as db:assert rows(db,owner,'run')==[]


def test_plaintext_upload_is_rejected_before_file_record_is_saved():
    client,owner=account()
    response=client.post('/api/files',files={'file':('notes.txt','身份证号110101199001011234'.encode(),'text/plain')})
    assert response.status_code==422 and response.json()['detail']['category']=='privacy'
    with Session() as db:assert rows(db,owner,'file')==[]
