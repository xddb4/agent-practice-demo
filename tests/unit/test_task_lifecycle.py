from datetime import datetime,timezone,timedelta
from backend.app.services.task_lifecycle import stamp_tasks,execution_context
from backend.app.services.context import bounded_context


def test_creation_and_completion_are_server_recorded_and_reopen_clears_completion():
    start=datetime(2026,11,21,2,0,tzinfo=timezone.utc)
    first=stamp_tasks([{'id':1,'created_at':'2000-01-01T00:00:00Z','done':False}],[],start)
    assert first[0]['created_at']==start.isoformat()
    done=stamp_tasks([{**first[0],'done':True,'completed_at':'2000-01-01T00:00:00Z'}],first,start+timedelta(minutes=43,seconds=22))
    assert done[0]['elapsed_minutes']==43
    assert stamp_tasks(done,done,start+timedelta(days=1))==done
    reopened=stamp_tasks([{**done[0],'done':False}],done,start+timedelta(days=1))
    assert reopened[0]['created_at']==first[0]['created_at']
    assert reopened[0]['completed_at'] is None and reopened[0]['elapsed_minutes'] is None
    again=stamp_tasks([{**reopened[0],'done':True}],reopened,start+timedelta(days=1,minutes=7))
    assert again[0]['elapsed_minutes']==1447
    context=bounded_context({'tasks':again,'evidence':[]})
    assert context['execution_reference']['recent'][0]['elapsed_minutes']==1447
    assert '不能据此判断能力高低' in context['execution_reference']['limitations']


def test_legacy_missing_dates_are_unknown_not_inferred_from_plan_or_numeric_id():
    legacy=[{'id':1795220000000,'title':'旧任务','date':'2026-11-01','done':True}]
    result=stamp_tasks(legacy,legacy)
    assert result[0]['created_at'] is None and result[0]['completed_at'] is None
    summary=execution_context(result)
    assert summary['known_elapsed_tasks']==0 and summary['unknown_elapsed_tasks']==1
    assert '并非实际学习用时' in summary['limitations']
