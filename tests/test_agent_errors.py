import uuid
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app,workflow
from backend.app.services.agent_errors import diagnose,AgentOutputError

class UpstreamError(Exception):
    def __init__(self,status):self.status_code=status

@pytest.mark.parametrize('status,code',[(401,'authentication'),(402,'balance'),(403,'permission'),(404,'model_not_found'),(429,'rate_limit'),(503,'upstream'),(400,'model_request')])
def test_upstream_diagnosis(status,code):
    detail=diagnose(UpstreamError(status),'test-id')
    assert detail['code']==code
    assert detail['reason'] and detail['action'] and detail['request_id']=='test-id'

def test_output_issues_omit_input():
    detail=diagnose(AgentOutputError([{'loc':['items',0,'end'],'type':'datetime_parsing','input':'private source'}]),'test-id')
    assert detail['code']=='invalid_output'
    assert detail['problems']==['第1条的结束时间格式或取值不符合要求']
    assert 'private source' not in str(detail)

def test_api_diagnostics_do_not_leak_exception(monkeypatch,caplog):
    monkeypatch.setattr('backend.app.main.runtime_settings',lambda owner:{})
    c=TestClient(app)
    c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-only-password'})
    def fail(_):raise ValueError('sensitive-test-marker')
    monkeypatch.setattr(workflow,'invoke',fail)
    response=c.post('/api/agent',json={'text':'private notification','route':'schedule'})
    assert response.status_code==502
    detail=response.json()['detail']
    assert detail['code']=='internal' and detail['request_id']
    assert 'sensitive-test-marker' not in response.text+caplog.text
    assert 'private notification' not in caplog.text
    assert c.get('/api/state').json()['tasks']==[]
