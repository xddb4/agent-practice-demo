import json,uuid
from fastapi.testclient import TestClient
from backend.app.main import app,workflow

def client():
    c=TestClient(app)
    assert c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-only-password'}).status_code==200
    return c
def plan(c):return c.post('/api/agent',json={'route':'recommend','text':json.dumps({'目标':'准备缓存实验','每周小时':4},ensure_ascii=False)}).json()

def test_recommendation_reads_only_owned_materials(monkeypatch,tmp_path):
    import backend.app.main as main
    a,b=client(),client()
    monkeypatch.setattr(main,'root',tmp_path)
    upload=a.post('/api/files',files={'file':('results.txt',('听力失分较多。'*800).encode(),'text/plain')})
    assert upload.status_code==200
    body={'text':'准备考试','route':'recommend','material_ids':[upload.json()['id']]}
    assert b.post('/api/agent',json=body).status_code==404
    def capture(state):
        assert state['materials']==[{'name':'results.txt','text':('听力失分较多。'*800)[:3500]}]
        return {'route':'recommend','result':{'items':[],'notice':''}}
    monkeypatch.setattr(workflow,'invoke',capture)
    assert a.post('/api/agent',json=body).status_code==200

def test_saved_plan_partial_review_and_copy():
    c=client();original=plan(c);plan_id=original['id']
    assert any(x['id']==plan_id for x in c.get('/api/plans').json())
    other_tab=TestClient(app);other_tab.cookies.update(c.cookies)
    assert other_tab.get('/api/plans/'+plan_id).status_code==200
    item={**original['items'][1],'title':'修改后的实验任务','date':'2026-11-03'}
    assert c.post('/api/agent/'+plan_id+'/review',json={'items':[item],'indices':[1]}).status_code==200
    tasks=[{'id':1,'title':item['title'],'q':1,'date':'2026-11-03','agent_run_id':plan_id,'proposal_index':1}]
    assert c.put('/api/state',json={'tasks':tasks,'evidence':[]}).status_code==200
    restored=c.get('/api/plans/'+plan_id).json()
    assert restored['items'][1]['title']==item['title'] and restored['items'][0]['title']==original['items'][0]['title']
    assert restored['adopted_indices']==[1]
    copied=c.post('/api/plans/'+plan_id+'/copy').json()
    assert copied['id']!=plan_id and copied['adopted_indices']==[] and copied['parent_plan_id']==plan_id
    assert all(x.get('date') is None and x.get('start') is None for x in copied['items'])
    assert len(c.get('/api/state').json()['tasks'])==1
    duplicate={**tasks[0],'id':2}
    assert c.put('/api/state',json={'tasks':tasks+[duplicate],'evidence':[]}).status_code==409

def test_plan_ownership_and_explicit_memory(monkeypatch):
    a,b=client(),client();saved=plan(a);plan_id=saved['id']
    assert b.get('/api/plans/'+plan_id).status_code==404
    assert b.post('/api/plans/'+plan_id+'/copy').status_code==404
    assert all(x['id']!=plan_id for x in b.get('/api/plans').json())
    assert b.post('/api/agent',json={'route':'recommend','text':'目标','base_plan_id':plan_id}).status_code==404
    a.put('/api/state',json={'tasks':[],'evidence':[{'id':1,'title':'已接受的实验作品','dim':2,'status':'已接受'},{'id':2,'title':'未接受材料','dim':0,'status':'待确认'}]})
    contexts=[]
    def capture(state):
        contexts.append(state['context'])
        return {'route':'recommend','result':{'items':saved['items'],'notice':'','sources':[]}}
    monkeypatch.setattr(workflow,'invoke',capture)
    assert a.post('/api/agent',json={'route':'recommend','text':'新目标'}).status_code==200
    assert 'reference_plan' not in contexts[-1]
    assert len(contexts[-1]['evidence'])==1 and contexts[-1]['evidence'][0]['id']==1
    assert a.post('/api/agent',json={'route':'recommend','text':'新目标','base_plan_id':plan_id}).status_code==200
    assert contexts[-1]['reference_plan']['title']=='准备缓存实验'
    a.put('/api/state',json={'tasks':[],'evidence':[]})
    a.post('/api/agent',json={'route':'recommend','text':'继续','base_plan_id':plan_id})
    assert contexts[-1]['evidence']==[]

def test_webp_reaches_vision_workflow(monkeypatch):
    c=client();captured=[]
    def capture(state):
        captured.append(state['image'])
        return {'route':'schedule','result':{'items':[{'title':'测试课表'}],'notice':'','sources':[]}}
    monkeypatch.setattr(workflow,'invoke',capture)
    assert c.post('/api/agent',json={'route':'schedule','text':'课表','image':'data:image/webp;base64,dGVzdA=='}).status_code==200
    assert captured[0].startswith('data:image/webp;base64,')


import pytest

@pytest.fixture(autouse=True)
def offline_model_configuration(monkeypatch):
    # 这些既有业务测试使用离线工作流；真实配置入口与账号隔离单独测试。
    monkeypatch.setattr("backend.app.main.runtime_settings", lambda owner: {})
