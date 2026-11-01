import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.core.db import Session,Record
from backend.app.services.model_settings import use_settings,model_env

def client():
    c=TestClient(app)
    result=c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'settings-test-password'})
    c.owner=result.json()['id']
    return c

def config(**changes):
    return {'provider':'deepseek','model':'deepseek-chat','base_url':'https://api.deepseek.com','api_key':'dummy-private-key',**changes}

@pytest.fixture(autouse=True)
def encryption_key(tmp_path,monkeypatch):
    monkeypatch.setenv('MODEL_ENCRYPTION_KEY_FILE',str(tmp_path/'key'))

def test_config_private_encrypted_and_isolated():
    a,b=client(),client()
    assert TestClient(app).get('/api/model-settings').status_code==401
    assert not a.get('/api/model-settings').json()['configured']
    saved=a.put('/api/model-settings',json=config())
    assert saved.status_code==200 and saved.json()['configured']
    assert 'dummy-private-key' not in saved.text and 'encrypted_key' not in saved.text
    assert 'api_key' not in a.get('/api/model-settings').text
    assert not b.get('/api/model-settings').json()['configured']
    with Session() as db:
        row=db.get(Record,'model-settings:'+a.owner)
        assert row.data['encrypted_key']!='dummy-private-key' and 'api_key' not in row.data
    assert a.put('/api/model-settings',json=config(api_key='',model='deepseek-reasoner')).status_code==200
    assert a.put('/api/model-settings',json=config(api_key='',base_url='https://another.example/v1')).status_code==422
    assert b.delete('/api/model-settings').status_code==200
    assert a.get('/api/model-settings').json()['configured']
    assert a.delete('/api/model-settings').status_code==200
    assert not a.get('/api/model-settings').json()['configured']

def test_missing_config_never_falls_back_to_server_key(monkeypatch):
    monkeypatch.setenv('MODEL_API_KEY','server-secret-never-used')
    c=client()
    for path in ['/api/agent','/api/model-settings/test']:
        r=c.post(path,json={'text':'test'} if path.endswith('agent') else {})
        assert r.status_code==409 and r.json()['detail']['code']=='model_not_configured'
        assert 'server-secret' not in r.text

def test_config_validation_never_echoes_keys():
    c=client()
    for body in [config(base_url='http://example.com'),config(api_key='secret\nline'),config(api_key='x'*4100),config(provider='bad')]:
        result=c.put('/api/model-settings',json=body)
        assert result.status_code==422
        assert 'secret' not in result.text and 'xxxx' not in result.text and 'api_key' not in result.json()['detail'].get('message','')

def test_run_uses_own_configuration_and_resets_context(monkeypatch):
    import backend.app.main as main
    a,b=client(),client()
    a.put('/api/model-settings',json=config())
    b.put('/api/model-settings',json=config(api_key='second-private-key'))
    def invoke(state):
        key=model_env('MODEL_API_KEY')
        assert key in ['dummy-private-key','second-private-key']
        return {'route':'schedule','result':{'items':[],'notice':key[:5]}}
    monkeypatch.setattr(main.workflow,'invoke',invoke)
    with ThreadPoolExecutor(2) as pool:
        replies=list(pool.map(lambda c:c.post('/api/agent',json={'text':'test','route':'schedule'}),[a,b]))
    assert [r.json()['notice'] for r in replies]==['dummy','secon']
    assert model_env('MODEL_API_KEY') is None
    with use_settings({'MODEL_API_KEY':'scoped'}):assert model_env('MODEL_API_KEY')=='scoped'
    assert model_env('MODEL_API_KEY') is None

def test_connection_test_sanitizes_provider_errors(monkeypatch):
    import backend.app.integrations.model as model
    c=client();c.put('/api/model-settings',json=config())
    class Fake:
        def invoke(self,_):
            assert model_env('MODEL_API_KEY')=='dummy-private-key'
            raise RuntimeError('dummy-private-key must never be returned')
    monkeypatch.setattr(model,'create_model',lambda:Fake())
    result=c.post('/api/model-settings/test',json={})
    assert result.status_code==502 and 'dummy-private-key' not in result.text

def test_configuration_reaches_langgraph_nodes(monkeypatch):
    import backend.app.ai.workflows.pilot as pilot
    from langchain_core.messages import AIMessage
    c=client();c.put('/api/model-settings',json=config())
    class Fake:
        def invoke(self,_):
            assert model_env('MODEL_API_KEY')=='dummy-private-key'
            return AIMessage(content='{"items":[{"title":"测试安排","important":false,"urgent":false}],"notice":""}')
    monkeypatch.setattr(pilot,'structured_model',lambda *args:Fake())
    result=c.post('/api/agent',json={'route':'schedule','text':'测试安排'})
    assert result.status_code==200 and result.json()['items'][0]['title']=='测试安排'
