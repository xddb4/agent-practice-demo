from datetime import datetime, timezone

from backend.app.services.task_expiry import LOCAL, expired, sweep_expired, expiry_reference
from backend.app.services.plan_dialogue import dialogue_context, prepare_changes
from fastapi import HTTPException
import pytest


def test_deadline_cutoff_fixed_completed_and_missing_deadlines():
    day='2026-11-21'
    assert expired({'ddl':'2026-11-20'},day)
    assert not expired({'ddl':day},day)
    assert not expired({'ddl':'bad'},day)
    assert not expired({'date':'2020-01-01'},day)
    assert not expired({'ddl':'2026-11-20','start':'08:00'},day)
    assert not expired({'ddl':'2026-11-20','done':True},day)


def test_sweep_preserves_original_and_is_idempotent_with_stale_tasks():
    task={'id':1,'title':'练习','ddl':'2026-11-20','created_at':'2026-11-01T00:00:00Z'}
    state={'tasks':[task],'evidence':[]}
    now=datetime(2026,11,20,16,0,tzinfo=timezone.utc)
    archived=sweep_expired(state,now)
    assert state['tasks']==[task] and 'expiry_count' not in task
    assert archived['tasks']==[]
    assert archived['expired_tasks'][0]['task']['created_at']==task['created_at']
    assert archived['expired_tasks'][0]['task']['expiry_count']==1
    assert sweep_expired(archived,now)==archived
    archived['tasks']=[{**task,'ddl':'2090-01-01'}]
    assert sweep_expired(archived,now)['tasks']==[]


def test_recent_expiry_evidence_is_bounded_and_conversation_scoped():
    records=[{'task':{'id':i,'title':'练习'+str(i),'agent_run_id':'mine' if i<10 else 'other'},'expiredAt':str(i).zfill(2)} for i in range(12)]
    reference=expiry_reference(records,'mine')
    assert reference['total']==10 and reference['included']==8
    assert any('减少本轮恢复数量' in item for item in reference['adjustment_advice'])
    assert all(item['agent_run_id']=='mine' for item in reference['tasks'])
    assert '不代表能力不足' in reference['limitations']
    context=dialogue_context({'items':[]},[],'mine',[],'调整任务',expired_tasks=records)
    assert context['本对话过期任务参考']['total']==10
    assert context['执行节奏参考']['expired_reference']['total']==10


def test_expired_modifications_require_all_new_schedule_fields():
    data={'items':[{'title':'练习'}]}
    task={'id':1,'title':'练习','agent_run_id':'mine','proposal_index':0,'ddl':'2000-01-01'}
    with pytest.raises(HTTPException):
        prepare_changes(data,[task],'mine',[{'action':'modify','index':0,'fields':{'date':'2090-01-01'}}])
    preview=prepare_changes(data,[task],'mine',[{'action':'modify','index':0,'fields':{'date':'2090-01-01','deadline':'2090-01-02','estimated_minutes':25}}])
    assert preview[0]['expired'] and preview[0]['after']['duration']==25
    assert prepare_changes(data,[task],'mine',[{'action':'cancel','index':0}])[0]['expired']
