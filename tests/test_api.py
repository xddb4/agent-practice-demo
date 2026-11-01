import uuid
from fastapi.testclient import TestClient
from backend.app.main import app

def client():
    c=TestClient(app)
    assert c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123','name':'测试'}).status_code==200
    return c

def test_auth_isolation_and_logout():
    a,b=client(),client()
    task={'id':1,'title':'实验','date':'2026-10-29','q':0}
    assert a.put('/api/state',json={'tasks':[task],'evidence':[]}).status_code==200
    assert b.get('/api/state').json()['tasks']==[]
    assert a.post('/api/logout').status_code==200
    assert a.get('/api/state').status_code==401

def test_candidate_and_evidence():
    c=client()
    for route in ['schedule','evidence','recommend']:
        assert c.post('/api/agent',json={'text':'测试材料','route':route}).status_code==200
    assert c.get('/api/state').json()=={'tasks':[],'evidence':[]}
    e={'id':1,'title':'实验报告','body':'对照数据','dim':2,'status':'待确认'}
    for status,count in [('待确认',0),('已接受',1),('待观察',0)]:
        e['status']=status
        c.put('/api/state',json={'tasks':[],'evidence':[e]})
        assert len(c.get('/api/report').json()['dimensions'][2]['evidence'])==count

def test_invalid_and_idempotent_snapshot():
    c=client();t={'id':1,'title':'课程','q':1,'start':'10:00','end':'09:00'}
    assert c.put('/api/state',json={'tasks':[t],'evidence':[]}).status_code==422
    t['end']='11:00'
    for _ in range(2): assert c.put('/api/state',json={'tasks':[t],'evidence':[]}).status_code==200
    assert len(c.get('/api/state').json()['tasks'])==1

def test_review_revalidates_and_checks_owner():
    a,b=client(),client()
    run=a.post('/api/agent',json={'text':'实验讨论','route':'schedule'}).json()
    url='/api/agent/'+run['id']+'/review'
    assert b.post(url,json={'items':[{'title':'实验'}]}).status_code==404
    assert a.post(url,json={'items':[{'title':'实验','important':'true'}]}).status_code==422
    assert a.post(url,json={'items':[{'title':'实验','important':True}]}).status_code==200
    assert a.get('/api/state').json()['tasks']==[]

def test_recommendation_review_accepts_selected_form_values():
    c=client()
    run=c.post('/api/agent',json={'text':'准备实验','route':'recommend'}).json()
    item=run['items'][0]
    item.update(date='2026-11-03',start=None,end=None)
    response=c.post('/api/agent/'+run['id']+'/review',json={'items':[item]})
    assert response.status_code==200
    assert len(response.json()['items'])==1
    assert c.get('/api/state').json()['tasks']==[]
