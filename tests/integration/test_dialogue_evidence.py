import uuid

from fastapi.testclient import TestClient

from backend.app.api import routes
from backend.app.main import app
from backend.app.core.db import Record, Session
from backend.app.services.context import ability_context
from backend.app.services.plan_dialogue import dialogue_context


def account():
    client=TestClient(app)
    user=client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-only-password'}).json()
    plan=uuid.uuid4().hex
    with Session() as db:
        db.add(Record(id=plan,owner=user['id'],kind='run',data={'route':'recommend','input_source':'准备科研汇报',
            'items':[{'title':'实验复盘','description':'分析对照实验的误差来源。','estimated_minutes':30,'date':'2090-01-02'}]}))
        db.commit()
    return client,user['id'],plan


def test_each_turn_reads_latest_accepted_evidence_only(monkeypatch):
    client,owner,plan=account()
    other,_,_=account()
    seen=[]
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    def invoke(state):
        seen.append(state['context']['能力证据参考'])
        return {'result':{'reply':'根据已有记录回答。','changes':[]}}
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    def record(title,status):return {'id':title,'title':title,'body':'对照实验的误差分析记录','dim':2,'status':status}
    other.put('/api/state',json={'tasks':[],'evidence':[record('other-private','已接受')]})
    records=[record('first','已接受'),record('pending','待确认'),record('watch','待观察')]
    client.put('/api/state',json={'tasks':[],'evidence':records})
    path=f'/api/plans/{plan}/dialogue'
    assert client.post(path,json={'text':'如何复盘实验'}).status_code==200
    assert [e['id'] for e in seen[-1]['evidence']]==['first']
    records[0]['body']='用户已修改的最新正文'
    records.append(record('second','已接受'))
    client.put('/api/state',json={'tasks':[],'evidence':records})
    assert client.post(path,json={'text':'再看最新记录'}).status_code==200
    assert seen[-1]['evidence'][0]['body']=='用户已修改的最新正文'
    assert {e['id'] for e in seen[-1]['evidence']}=={'first','second'}
    client.put('/api/state',json={'tasks':[],'evidence':[]})
    client.post(path,json={'text':'现在还有证据吗'})
    assert seen[-1]['evidence']==[]


def test_candidate_needs_review_is_idempotent_and_does_not_update_report(monkeypatch):
    client,owner,plan=account()
    quote='我做了两组对照实验，并记录了误差来源。'
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    candidate={'title':'对照实验复盘','quote':quote,'dimension':'实验验证与数据素养','kind':'work_result','rationale':'用户报告了对照和误差分析过程，成果尚需核对。'}
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',lambda _:{'result':{'reply':'可以核对这条记录。','changes':[],
        'evidence_candidates':[candidate,{**candidate,'quote':'模型虚构的完成记录'}]}})
    path=f'/api/plans/{plan}/dialogue'
    response=client.post(path,json={'text':quote})
    assert response.status_code==200,response.text
    candidates=response.json()['messages'][-1]['evidence_candidates']
    assert len(candidates)==1
    assert client.get('/api/state').json()['evidence']==[]
    endpoint=path+'/evidence/'+candidates[0]['id']
    body={'title':'经用户校正的记录','body':quote,'desc':'尚需核对实验附件','dim':2}
    stranger,_,_=account()
    assert stranger.post(endpoint,json=body).status_code==404
    saved=client.post(endpoint,json=body)
    assert saved.status_code==200,saved.text
    item=saved.json()['evidence'][0]
    assert item['status']=='待确认' and item['source_quote']==quote
    assert saved.json()['messages'][-1]['evidence_candidates'][0]['status']=='submitted'
    assert saved.json()['withdraw_token'] is None
    assert client.post(endpoint,json=body).json()['evidence']==[item]
    report=client.get('/api/report').json()
    assert all(not dimension['evidence'] for dimension in report['dimensions'])
    item['status']='已接受'
    client.put('/api/state',json={'tasks':[],'evidence':[item]})
    assert client.get('/api/report').json()['dimensions'][2]['evidence'][0]['id']==item['id']


def test_task_description_survives_confirmed_plan_and_calendar_changes(monkeypatch):
    client,owner,plan=account()
    path=f'/api/plans/{plan}/dialogue'
    tasks=[{'id':1,'title':'实验复盘','date':'2090-01-02','agent_run_id':plan,'proposal_index':0}]
    client.put('/api/state',json={'tasks':tasks,'evidence':[]})
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',lambda _:{'result':{'reply':'缩短名称，保留步骤。','changes':[
        {'action':'modify','index':0,'fields':{'title':'误差复盘','description':'用本次两组实验的数据逐项比较误差，并记录局限。'}}]}})
    result=client.post(path,json={'text':'把任务名简短些，保留做法'}).json()
    assert client.get('/api/state').json()['tasks']==tasks
    applied=client.post(path+'/decision',json={'proposal_id':result['pending']['id'],'apply':True})
    assert applied.status_code==200,applied.text
    assert applied.json()['tasks'][0]['description']=='用本次两组实验的数据逐项比较误差，并记录局限。'
    assert client.get(f'/api/plans/{plan}').json()['items'][0]['description']==applied.json()['tasks'][0]['description']


def test_ability_context_is_bounded_and_labels_uncertainty():
    records=[{'id':i,'title':'实验'+str(i),'body':'内容'*1000,'status':'已接受','kind':'self_report'} for i in range(100)]
    result=ability_context(records,'实验')
    assert len(result['evidence'])<=12 and result['omitted']
    assert '自述不是客观测评' in result['limitations']
