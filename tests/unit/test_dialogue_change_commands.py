from copy import deepcopy
import json

from fastapi import HTTPException
import pytest

from backend.app.services.plan_dialogue import apply_changes, prepare_changes


def item(title, **fields):
    return {'title': title, 'date': '2090-01-01', 'estimated_minutes': 30, **fields}


def modify(index, **fields):
    return {'action': 'modify', 'index': index, 'fields': fields}


def test_mixed_commands_preserve_indices_and_do_not_mutate_input_or_auto_adopt_additions():
    data = {'items': [item('旧任务'), item('待取消')], 'planning': {'old': True}}
    tasks = [
        {'id': 10, 'title': '旧任务', 'agent_run_id': 'plan', 'proposal_index': 0,
         'q': 1, 'description': '原说明', 'created_at': '2026-11-01T00:00:00Z'},
        {'id': 11, 'title': '待取消', 'agent_run_id': 'plan', 'proposal_index': 1},
        {'id': 12, 'title': '其他对话任务', 'agent_run_id': 'other'},
    ]
    original = deepcopy((data, tasks))
    changes = [modify(0, title='新任务', description='具体执行说明'),
               {'action': 'cancel', 'index': 1},
               {'action': 'add', 'fields': {'title': '新增候选', 'date': '2090-01-02', 'estimated_minutes': 20}}]
    previews = prepare_changes(data, tasks, 'plan', changes)
    assert [change['index'] for change in previews] == [0, 1, 2]
    updated, calendar = apply_changes(data, tasks, 'plan', previews)
    assert (data, tasks) == original
    assert updated['items'][0]['title'] == '新任务'
    assert updated['items'][2]['estimated_minutes'] == 20
    assert updated['cancelled_indices'] == [1] and updated['planning'] == {}
    assert [task['id'] for task in calendar] == [10, 12]
    assert calendar[0]['description'] == '具体执行说明'
    assert calendar[0]['q'] == 1 and calendar[0]['created_at'] == tasks[0]['created_at']
    assert calendar[1] == tasks[2]


def test_noop_is_ignored_but_duplicate_target_still_requires_regeneration():
    data = {'items': [item('练习')]}
    assert prepare_changes(data, [], 'plan', [modify(0, title='练习')]) == []
    with pytest.raises(HTTPException) as error:
        prepare_changes(data, [], 'plan', [modify(0, title='练习'), modify(0, title='另一练习')])
    assert error.value.status_code == 422


def test_dependency_cancellation_requires_cancelling_dependent_task_in_same_batch():
    data = {'items': [item('准备', task_key='prep'), item('练习', depends_on=['prep'])]}
    with pytest.raises(HTTPException) as error:
        prepare_changes(data, [], 'plan', [{'action': 'cancel', 'index': 0}])
    assert '后续依赖' in error.value.detail
    preview = prepare_changes(data, [], 'plan', [
        {'action': 'cancel', 'index': 0}, {'action': 'cancel', 'index': 1},
    ])
    assert len(preview) == 2


def test_dependency_gap_uses_deadline_for_flexible_prerequisite():
    data = {'items': [item('准备', task_key='prep', deadline='2090-01-02T23:59:00+08:00'),
                      item('练习', date='2090-01-05', depends_on=['prep'], min_gap_days=2)]}
    with pytest.raises(HTTPException) as error:
        prepare_changes(data, [], 'plan', [modify(1, date='2090-01-03')])
    assert '前置任务或间隔' in error.value.detail
    assert prepare_changes(data, [], 'plan', [modify(1, date='2090-01-04')])[0]['after']['date'] == '2090-01-04'


def test_batch_slot_swap_excludes_old_slots_but_rejects_overlapping_new_slots():
    data = {'items': [item('练习一'), item('练习二')]}
    tasks = [
        {'id': 1, 'title': '练习一', 'agent_run_id': 'plan', 'proposal_index': 0,
         'date': '2090-01-01', 'start': '09:00', 'end': '10:00'},
        {'id': 2, 'title': '练习二', 'agent_run_id': 'plan', 'proposal_index': 1,
         'date': '2090-01-01', 'start': '10:00', 'end': '11:00'},
    ]
    swap = [modify(0, start='10:00', end='11:00'), modify(1, start='09:00', end='10:00')]
    previews = prepare_changes(data, tasks, 'plan', swap)
    _, calendar = apply_changes(data, tasks, 'plan', previews)
    assert [task['start'] for task in calendar] == ['10:00', '09:00']
    with pytest.raises(HTTPException) as error:
        prepare_changes(data, tasks, 'plan', [modify(0, start='09:30', end='10:30'), modify(1, start='10:00', end='11:30')])
    assert error.value.status_code == 409


def test_unadopted_fixed_candidate_also_blocks_conflicting_addition_but_allows_adjacent_slot():
    data = {'items': [item('已有候选', start='2090-01-01T10:00:00+08:00', end='2090-01-01T11:00:00+08:00')]}
    fields = {'title': '新增候选', 'date': '2090-01-01', 'start': '10:30', 'end': '11:30', 'estimated_minutes': 60}
    with pytest.raises(HTTPException) as error:
        prepare_changes(data, [], 'plan', [{'action': 'add', 'fields': fields}])
    assert error.value.status_code == 409
    fields.update(start='11:00', end='12:00')
    assert len(prepare_changes(data, [], 'plan', [{'action': 'add', 'fields': fields}])) == 1


def test_unchanged_dates_are_preserved_and_capacity_is_checked_after_whole_batch():
    data = {'input_source': json.dumps({'截止日期': '2026-11-21'}), 'items': [item('练习')]}
    assert prepare_changes(data, [], 'plan', [modify(0, title='新的练习')])
    with pytest.raises(HTTPException) as error:
        prepare_changes(data, [], 'plan', [modify(0, date='2090-01-02')])
    assert error.value.status_code == 422
    data = {'items': [item('任务' + str(index)) for index in range(100)]}
    add = {'action': 'add', 'fields': {'title': '替换任务', 'date': '2090-01-01', 'estimated_minutes': 10}}
    with pytest.raises(HTTPException):
        prepare_changes(data, [], 'plan', [add])
    previews = prepare_changes(data, [], 'plan', [add, {'action': 'cancel', 'index': 0}])
    assert [change['index'] for change in previews] == [100, 0]
