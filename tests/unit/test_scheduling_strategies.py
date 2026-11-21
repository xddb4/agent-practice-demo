from copy import deepcopy
from datetime import datetime, timedelta
import json

import pytest

from backend.app.services.scheduling import TZ, planning_slots, reserve_slots, schedule_plan


def stamps(day=21, hour=9, count=2):
    start = datetime(2026, 11, day, hour, tzinfo=TZ)
    return [start + timedelta(minutes=index) for index in range(count)]


@pytest.mark.parametrize('text,warning', [
    ('invalid-json', '截止日期'),
    ('[]', '截止日期'),
    (json.dumps({'截止日期': '2026-11-21', '每周小时': 'NaN'}), '每周可投入'),
    (json.dumps({'截止日期': '2026-11-21', '每周小时': -1}), '每周可投入'),
])
def test_invalid_constraints_keep_explicit_warning_without_invented_slots(text, warning):
    slots, budget = planning_slots(text, [], datetime(2026, 11, 21, 8, tzinfo=TZ))
    assert slots == [] and budget['feasible'] is False
    assert warning in budget['warnings'][0]


def test_weekly_courses_respect_start_date_and_completed_fixed_tasks_still_occupy_time():
    now = datetime(2026, 11, 21, 7, tzinfo=TZ)
    tasks = [
        {'date': '2026-11-14', 'repeat': '每周六', 'start': '08:00', 'end': '09:00'},
        {'date': '2026-11-28', 'repeat': '每周', 'start': '10:00', 'end': '11:00'},
        {'date': '2026-11-21', 'start': '12:00', 'end': '13:00', 'done': True},
        {'date': '2026-11-21', 'start': 'bad', 'end': '13:00'},
        {'date': '2026-11-21', 'duration': 90},
    ]
    slots, budget = planning_slots(json.dumps({'截止日期': '2026-11-28', '每周小时': 2}), tasks, now)
    first = [stamp for stamp in slots[0] if stamp.date() == now.date()]
    assert first[0].hour == 9
    assert any(stamp.hour == 10 for stamp in first)
    assert not any(stamp.hour == 12 for stamp in first)
    assert not any(stamp.hour == 10 for stamp in slots[1])
    assert budget['minutes_available'] == 240
    assert budget['longest_contiguous_minutes'] == 120


def test_today_starts_at_next_quarter_hour_and_never_extends_beyond_deadline():
    now = datetime(2026, 11, 21, 8, 1, tzinfo=TZ)
    slots, budget = planning_slots(json.dumps({'截止日期': '2026-11-21', '每周小时': 1}), [], now)
    assert slots[0][0] == datetime(2026, 11, 21, 8, 15, tzinfo=TZ)
    assert slots[0][-1] == datetime(2026, 11, 21, 21, 59, tzinfo=TZ)
    assert budget['minutes_available'] == 60


def test_failed_continuous_reservation_is_atomic_and_split_strategy_can_reuse_slots():
    slots = {0: [*stamps(hour=9), *stamps(hour=10)]}
    remaining = {0: 4}
    original = deepcopy((slots, remaining))
    assert reserve_slots(slots, remaining, slots[0][0], 3, True) == []
    assert (slots, remaining) == original
    chosen = reserve_slots(slots, remaining, slots[0][0], 3, False)
    assert chosen == [*stamps(hour=9), stamps(hour=10)[0]]
    assert remaining == {0: 1} and slots[0] == [stamps(hour=10)[1]]


def test_failed_multiweek_reservation_does_not_consume_partial_budget():
    slots, remaining = {0: stamps(), 1: stamps(day=28)}, {0: 2, 1: 2}
    before = deepcopy((slots, remaining))
    assert reserve_slots(slots, remaining, stamps()[0], 5, False) == []
    assert (slots, remaining) == before
    assert reserve_slots(slots, remaining, stamps()[0], 3, True) == []
    assert (slots, remaining) == before
    assert len(reserve_slots(slots, remaining, stamps()[0], 3, False)) == 3
    assert remaining == {0: 0, 1: 1}


def test_precomputed_availability_is_reusable_and_suggestions_merge_only_adjacent_minutes():
    slots = {0: [*stamps(hour=9), *stamps(hour=10)]}
    budget = {'weekly_minutes': 4, 'minutes_available': 4}
    items = [{'title': '分段练习', 'estimated_minutes': 3, 'description': '保留说明'}]
    before = deepcopy((items, slots, budget))
    result, summary = schedule_plan(items, '', [], stamps()[0], (slots, budget))
    assert (items, slots, budget) == before
    assert summary['feasible'] and summary['minutes_requested'] == 3
    assert result[0]['description'] == '保留说明'
    assert result[0]['start'] is None and result[0]['end'] is None
    assert result[0]['suggested_sessions'] == [
        {'start': '2026-11-21T09:00:00+08:00', 'end': '2026-11-21T09:02:00+08:00'},
        {'start': '2026-11-21T10:00:00+08:00', 'end': '2026-11-21T10:01:00+08:00'},
    ]


def test_failed_prerequisite_blocks_its_dependents_but_not_unrelated_task():
    slots, budget = {0: stamps(count=4)}, {'weekly_minutes': 4, 'minutes_available': 4}
    items = [
        {'title': '大任务', 'task_key': 'large', 'estimated_minutes': 5},
        {'title': '后续任务', 'task_key': 'dependent', 'depends_on': ['large'], 'estimated_minutes': 1},
        {'title': '独立任务', 'task_key': 'small', 'estimated_minutes': 2},
    ]
    result, summary = schedule_plan(items, '', [], stamps()[0], (slots, budget))
    assert not summary['feasible']
    assert '大任务' in summary['unscheduled']['dependent']
    assert result[0]['deadline'] is None and result[1]['deadline'] is None
    assert result[2]['deadline'] == '2026-11-21T09:02:00+08:00'


@pytest.mark.parametrize('items,detail', [
    ([{'title': '一', 'task_key': 'same'}, {'title': '二', 'task_key': 'same'}], '标识重复'),
    ([{'title': '一', 'task_key': 'one', 'depends_on': ['missing']}], '循环或缺失'),
])
def test_invalid_task_graph_is_rejected(items, detail):
    with pytest.raises(ValueError, match=detail):
        schedule_plan(items, '', [], stamps()[0], ({0: stamps()}, {'weekly_minutes': 2}))
