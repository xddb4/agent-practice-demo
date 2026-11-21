from copy import deepcopy

from backend.app.services.completion_evidence import completion_snapshot


def test_legacy_completed_flexible_tasks_become_pending_once():
    task={'id':1,'title':'精听','done':True,'ability':-1,'agent_run_id':'plan'}
    state=completion_snapshot([task,{'id':2,'done':True,'start':'08:00'},{'id':3,'done':False}],[])
    assert len(state['evidence'])==1
    candidate=state['evidence'][0]
    assert candidate['status']=='待确认' and candidate['dim']==-1
    assert candidate['agent_run_id']=='plan'
    assert not candidate['completion_details_confirmed']
    assert completion_snapshot(**state)==state
    # A queued write captured before the first response does not drop the candidate.
    late=completion_snapshot([task],[],state)
    assert late['evidence']==state['evidence']


def test_cancel_completion_retracts_pending_but_preserves_confirmed_evidence():
    state=completion_snapshot([{'id':1,'done':True}],[])
    state['tasks'][0]['done']=False
    assert completion_snapshot(**state)['evidence']==[]
    state['evidence'][0].update(status='已接受',completion_details_confirmed=True,dim=1)
    assert completion_snapshot(**state)['evidence']==state['evidence']


def test_intentionally_deleted_candidate_is_not_recreated():
    state=completion_snapshot([{'id':1,'done':True}],[])
    assert completion_snapshot(state['tasks'],[],state)['evidence']==[]


def test_reuse_matches_normalized_task_id_and_keeps_first_candidate():
    evidence = [
        {'id': 1, 'task_id': 7, 'source_type': 'manual'},
        {'id': 2, 'task_id': '7', 'source_type': 'task_completion'},
        {'id': 3, 'task_id': 7, 'source_type': 'task_completion'},
    ]
    state = completion_snapshot([{'id': 7, 'done': True}], evidence)
    assert state['tasks'][0]['completion_evidence_id'] == 2
    assert state['evidence'] == evidence


def test_withdraw_only_first_pending_even_for_fixed_task():
    evidence = [
        {'id': 1, 'task_id': 7, 'source_type': 'task_completion', 'status': '已接受'},
        {'id': 2, 'task_id': 7, 'source_type': 'task_completion', 'status': '待观察'},
        {'id': 3, 'task_id': 7, 'source_type': 'task_completion', 'status': '待确认'},
    ]
    task = {'id': 7, 'done': False, 'start': '08:00', 'completion_evidence_id': 2}
    state = completion_snapshot([task], evidence)
    assert [entry['id'] for entry in state['evidence']] == [1, 3]
    assert 'completion_evidence_id' not in state['tasks'][0]


def test_factory_allocates_after_history_and_keeps_self_report_fields():
    previous = {'evidence': [{'id': 10**18}]}
    task = {'id': 1, 'done': True, 'ability': True, 'description': '计划复听',
            'created_at': 'created', 'completed_at': 'completed', 'elapsed_minutes': 12}
    state = completion_snapshot([task, {'id': 2, 'done': True, 'ability': 5}], [], previous)
    first, second = state['evidence']
    assert [first['id'], second['id']] == [10**18 + 1, 10**18 + 2]
    assert [first['dim'], second['dim']] == [-1, 5]
    assert first['status'] == '待确认' and first['kind'] == 'self_report'
    assert first['completion_details_confirmed'] is False
    assert first['body'] == '用户已将此任务标记完成。\n计划执行说明（并非实际成果）：计划复听'
    assert {key: first[key] for key in ('created_at', 'completed_at', 'elapsed_minutes')} == {
        key: task[key] for key in ('created_at', 'completed_at', 'elapsed_minutes')}


def test_capacity_stops_batch_but_allows_history_recovery_first():
    evidence = [{'id': index, 'source_type': 'manual'} for index in range(5000)]
    pending = {'id': 6000, 'task_id': 3, 'source_type': 'task_completion', 'status': '待确认'}
    evidence[-1] = pending
    recovered = {**pending, 'id': 6001, 'task_id': 1}
    previous = {'tasks': [{'id': 1, 'completion_evidence_id': 6001}], 'evidence': [recovered]}
    tasks = [{'id': 1, 'done': True}, {'id': 2, 'done': True}, {'id': 3, 'done': False}]
    state = completion_snapshot(tasks, evidence, previous)
    assert len(state['evidence']) == 5001
    assert state['evidence'][-1] == recovered
    assert pending in state['evidence']
    assert state['tasks'][0]['completion_evidence_id'] == 6001
    assert 'completion_evidence_id' not in state['tasks'][1]
    # Capacity terminates the original batch, including later withdrawals.
    assert state['tasks'][2] == tasks[2]


def test_snapshot_and_recovered_evidence_do_not_share_mutable_inputs():
    tasks = [{'id': 1, 'done': True, 'nested': {'values': [1]}}]
    evidence = [{'id': 3, 'nested': {'values': [2]}}]
    previous = {'tasks': [{'id': 1, 'completion_evidence_id': 4}], 'evidence': [
        {'id': 4, 'task_id': 1, 'source_type': 'task_completion', 'nested': {'values': [3]}}]}
    original = deepcopy((tasks, evidence, previous))
    state = completion_snapshot(tasks, evidence, previous)
    state['tasks'][0]['nested']['values'].append(4)
    for entry in state['evidence']:
        entry['nested']['values'].append(4)
    assert (tasks, evidence, previous) == original
