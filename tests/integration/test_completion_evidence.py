import uuid
from fastapi.testclient import TestClient
from backend.app.main import app


def test_completion_inbox_is_owner_scoped_and_requires_actual_details():
    def account():
        client=TestClient(app)
        assert client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123','name':'测试'}).status_code==200
        return client
    a,b=account(),account()
    task={'id':41,'title':'卷A精听','q':1,'done':True,'description':'对照原文复听','ability':-1,'agent_run_id':'plan'}
    response=a.put('/api/state',json={'tasks':[task],'evidence':[]})
    assert response.status_code==200
    state=a.get('/api/state').json()
    assert len(state['evidence'])==1
    assert a.get('/api/state').json()==state
    assert b.get('/api/state').json()['evidence']==[]
    assert all(not d['evidence'] for d in a.get('/api/report').json()['dimensions'])
    state['evidence'][0].update(status='已接受',dim=1)
    assert a.put('/api/state',json=state).status_code==422
    state['evidence'][0].update(body='复听两段，整理了五处连读并录音对比。',completion_details_confirmed=True)
    assert a.put('/api/state',json=state).status_code==200
    assert len(a.get('/api/report').json()['dimensions'][1]['evidence'])==1
