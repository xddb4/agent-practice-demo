from datetime import datetime,timezone,timedelta
from copy import deepcopy
import pytest
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


@pytest.mark.parametrize('previous_done,current_done,minutes', [
    (False, False, None), (True, False, None), (False, True, 10), (True, True, 5),
])
def test_completion_transition_uses_server_history_instead_of_client_timestamps(previous_done, current_done, minutes):
    start = datetime(2026, 11, 21, 2, tzinfo=timezone.utc)
    prior = {'id': 7, 'done': previous_done, 'created_at': start.isoformat(),
             'completed_at': (start + timedelta(minutes=5)).isoformat()}
    incoming = {'id': '7', 'done': current_done, 'created_at': '1900-01-01T00:00:00Z',
                'completed_at': '1900-01-01T00:00:00Z', 'elapsed_minutes': 999999}
    stamped = stamp_tasks([incoming], [prior], start + timedelta(minutes=10))[0]
    assert stamped['created_at'] == start.isoformat()
    assert stamped['elapsed_minutes'] == minutes
    if minutes is None:
        assert stamped['completed_at'] is None
    else:
        assert stamped['completed_at'] == (start + timedelta(minutes=minutes)).isoformat()


@pytest.mark.parametrize('done', [False, True])
def test_new_task_records_one_minute_precision_server_clock_for_both_fields(done):
    now = datetime(2026, 11, 21, 2, 3, 59, 123456, tzinfo=timezone.utc)
    task = stamp_tasks([{'id': 8, 'done': done}], [], now)[0]
    assert task['created_at'] == '2026-11-21T02:03:00+00:00'
    if done:
        assert task['completed_at'] == task['created_at'] and task['elapsed_minutes'] == 0
    else:
        assert task['completed_at'] is None and task['elapsed_minutes'] is None


@pytest.mark.parametrize('missing_stamp', [None, 'bad', '2026-11-21T10:00:00', 123456])
def test_invalid_or_timezone_free_legacy_times_remain_unknown(missing_stamp):
    old = [{'id': 9, 'done': True, 'created_at': missing_stamp, 'completed_at': missing_stamp}]
    incoming = [{**old[0], 'created_at': '2026-11-21T02:00:00Z', 'completed_at': '2026-11-21T02:30:00Z'}]
    task = stamp_tasks(incoming, old)[0]
    assert task['created_at'] is None and task['completed_at'] is None
    assert task['elapsed_minutes'] is None


def test_clock_reversal_never_produces_negative_elapsed_time():
    future = datetime(2026, 11, 21, 3, tzinfo=timezone.utc)
    prior = [{'id': 10, 'created_at': future.isoformat(), 'done': False}]
    task = stamp_tasks([{'id': 10, 'done': True}], prior, future - timedelta(hours=1))[0]
    assert task['elapsed_minutes'] == 0


def test_stamping_does_not_mutate_either_input_and_copies_nested_fields():
    now = datetime(2026, 11, 21, 2, tzinfo=timezone.utc)
    prior = [{'id': 11, 'done': False, 'created_at': now.isoformat()}]
    incoming = [{'id': 11, 'done': True, 'suggested_sessions': [{'start': '2026-11-21T10:00:00+08:00'}]}]
    original = deepcopy((incoming, prior))
    result = stamp_tasks(incoming, prior, now + timedelta(minutes=1))
    assert (incoming, prior) == original
    result[0]['suggested_sessions'][0]['start'] = 'changed'
    assert (incoming, prior) == original
