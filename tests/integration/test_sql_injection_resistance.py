import uuid
from fastapi.testclient import TestClient
from backend.app.main import app


def test_login_injection_does_not_bypass_password_or_create_session():
    email=uuid.uuid4().hex+'@example.com'
    client=TestClient(app)
    assert client.post('/api/auth/register',json={'email':email,'password':'test-password-123'}).status_code==200
    attacker=TestClient(app)
    for injected_email,password in [("' OR 1=1 --@example.com",'any-password-123'),(email,"' OR 1=1; --")]:
        assert attacker.post('/api/auth/login',json={'email':injected_email,'password':password}).status_code==401
        assert attacker.get('/api/state').status_code==401
    attacker.cookies.set('session',"' OR 1=1; --")
    assert attacker.get('/api/state').status_code==401


def test_sql_looking_task_text_is_stored_literally_and_owner_isolation_holds():
    def account():
        client=TestClient(app)
        assert client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123'}).status_code==200
        return client
    owner,other=account(),account()
    payload="Robert'); DROP TABLE records; --"
    task={'id':777,'title':payload,'description':"' UNION SELECT * FROM records --",'q':1,'done':False}
    assert owner.put('/api/state',json={'tasks':[task],'evidence':[]}).status_code==200
    stored=owner.get('/api/state').json()['tasks'][0]
    assert {key:stored[key] for key in task}==task
    assert stored['created_at'] is not None
    assert other.get('/api/state').json()['tasks']==[]
    assert owner.get('/api/plans/%27%20OR%201%3D1%20--').status_code==404
    assert owner.get('/api/health').status_code==200
