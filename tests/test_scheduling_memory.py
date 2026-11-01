import json,uuid
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from backend.app.services.scheduling import schedule_plan
from backend.app.services.context import bounded_context
from backend.app.services.memory import pack,unpack
from backend.app.core.db import Session,Record
from backend.app.main import app

def test_schedule_dependencies_budget_and_fixed_conflicts():
    now=datetime(2026,10,29,8,tzinfo=ZoneInfo('Asia/Shanghai'))
    items=[{'title':'修改作文','task_key':'revise','depends_on':['write'],'estimated_minutes':40},{'title':'写作文','task_key':'write','estimated_minutes':60}]
    text=json.dumps({'截止日期':'2026-11-04','每周小时':2})
    scheduled,meta=schedule_plan(items,text,[{'date':'2026-10-29','start':'08:00','end':'10:00'}],now)
    assert meta['feasible'] and meta['minutes_available']<=120
    assert scheduled[0]['task_key']=='write' and scheduled[1]['task_key']=='revise'
    assert scheduled[1]['deadline']>scheduled[0]['deadline']
    assert all(item['start'] is None and item['end'] is None for item in scheduled)
    assert scheduled[0]['suggested_sessions'][0]['start']>='2026-10-29T10:00'
    for item in scheduled:
        for session in item['suggested_sessions']:assert session['start']<session['end']

def test_insufficient_budget_never_fabricates_ddl():
    now=datetime(2026,10,29,21,59,tzinfo=ZoneInfo('Asia/Shanghai'))
    items,meta=schedule_plan([{'title':'大任务','estimated_minutes':120}],json.dumps({'截止日期':'2026-10-29','每周小时':1}),[],now)
    assert not meta['feasible'] and meta['warnings']
    assert items[0]['deadline'] is None

def test_dependency_cycle_rejected():
    with pytest.raises(ValueError):schedule_plan([{'title':'A','task_key':'a','depends_on':['b'],'estimated_minutes':10},{'title':'B','task_key':'b','depends_on':['a'],'estimated_minutes':10}],json.dumps({'截止日期':'2026-11-20','每周小时':2}),[])

def test_context_is_bounded_without_changing_evidence():
    state={'tasks':[{'id':i,'title':'任务'*200,'date':'2026-11-01','done':False} for i in range(500)],'evidence':[{'id':i,'title':'作品','body':'正文'*2000,'status':'已接受' if i%2 else '待确认'} for i in range(100)],'reference_plan':{'title':'参考','items':[{'title':'项目'*100,'estimated_minutes':60} for _ in range(100)]}}
    view=bounded_context(state,2000)
    assert len(json.dumps(view,ensure_ascii=False))<=2000
    assert all(item['status']=='已接受' for item in view['evidence'])
    assert len(state['tasks'])==500 and len(state['evidence'])==100

def test_compression_is_lossless():
    original={'route':'recommend','items':[{'title':'论文任务'*100,'source':'原始证据'*200} for _ in range(20)],'sources':[{'url':'https://example.com','checked_at':'2026-10-29'}]}
    compacted=pack(original)
    assert '_compressed_v1' in compacted
    assert unpack(compacted)==original

def test_memory_cleanup_and_plan_read_after_compression():
    c=TestClient(app);c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-only-password'})
    plans=[c.post('/api/agent',json={'route':'recommend','text':'准备实验'}).json() for _ in range(3)]
    old=(datetime.now(ZoneInfo('UTC'))-timedelta(days=60)).isoformat()
    with Session() as db:
        for plan in plans:
            record=db.get(Record,plan['id']);record.data={**record.data,'created_at':old}
        db.commit()
    task={'id':1,'title':'已采纳','q':1,'agent_run_id':plans[0]['id'],'proposal_index':0}
    c.put('/api/state',json={'tasks':[task],'evidence':[]})
    c.post('/api/plans/'+plans[1]['id']+'/archive',json={'archived':True})
    result=c.post('/api/memory/compact').json();assert result['compressed']>0
    assert c.get('/api/plans/'+plans[0]['id']).json()['items'][0]['title']==plans[0]['items'][0]['title']
    assert c.post('/api/plans/'+plans[0]['id']+'/copy').status_code==200
    options={'older_than_days':30,'keep_recent':0}
    assert c.post('/api/memory/cleanup-preview',json=options).json()['count']==1
    assert c.post('/api/memory/cleanup',json=options).json()['deleted']==1
    assert c.get('/api/state').json()['tasks']==[task]
    assert c.get('/api/plans/'+plans[1]['id']).status_code==404
    assert c.delete('/api/plans/'+plans[0]['id']).status_code==409

def test_valid_tool_answer_is_not_generated_twice(monkeypatch):
    import backend.app.ai.workflows.pilot as pilot
    monkeypatch.setenv('MODEL_API_KEY','test-only-key')
    answer={'items':[{'title':'写作','estimated_minutes':30,'important':True,'urgent':False,'rationale':'基础训练','task_key':'write','depends_on':[]}],'notice':''}
    class FakeModel:
        def bind_tools(self,_):return self
        def invoke(self,_):return AIMessage(content=json.dumps(answer))
    monkeypatch.setattr(pilot,'model',lambda:FakeModel())
    def forbidden(_):raise AssertionError('不应再调用模型重写已通过校验的答案')
    monkeypatch.setattr(pilot,'structured_model',forbidden)
    result=pilot.generate({'route':'recommend','text':json.dumps({'截止日期':'2026-12-01','每周小时':2}),'context':{'tasks':[],'evidence':[]}})['result']
    assert result['metrics']['model_calls']==1 and result['items'][0]['deadline']

def test_memory_operations_do_not_affect_other_accounts():
    def make():
        c=TestClient(app);c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-only-password'});return c
    a,b=make(),make()
    first=a.post('/api/agent',json={'text':'计划A','route':'recommend'}).json()
    second=b.post('/api/agent',json={'text':'计划B','route':'recommend'}).json()
    a.post('/api/plans/'+first['id']+'/archive',json={'archived':True})
    assert a.post('/api/plans/'+second['id']+'/archive',json={'archived':True}).status_code==404
    assert a.delete('/api/plans/'+second['id']).status_code==404
    a.post('/api/memory/compact')
    a.post('/api/memory/cleanup',json={'older_than_days':0,'keep_recent':0})
    assert b.get('/api/plans/'+second['id']).status_code==200
