from copy import deepcopy

import pytest
from fastapi import HTTPException

from backend.app.services.tasks import validate_tasks


def task(identifier=1, **fields):
    return {'id': identifier, 'title': '复习', **fields}


@pytest.mark.parametrize(('tasks', 'status', 'message'), [
    ([task(title='  ')], 422, '任务名称不能为空'),
    ([{'id': 1}], 422, '任务名称不能为空'),
    ([task(), task()], 422, '任务编号重复'),
    ([task(agent_run_id='plan', proposal_index=0),
      task(2, agent_run_id='plan', proposal_index=0)], 409, '该方案条目已加入计划，请勿重复采纳'),
    ([task(start='08:00')], 422, '结束时间必须晚于开始时间'),
    ([task(start='08:00', end='08:00')], 422, '结束时间必须晚于开始时间'),
    ([task(start='09:00', end='08:00')], 422, '结束时间必须晚于开始时间'),
    ([task(q=4)], 422, '象限无效'),
    # Preserve the first error when several rules fail on the same task.
    ([task(), task(title='', q=4)], 422, '任务名称不能为空'),
    ([task(), task(start='09:00', end='08:00', q=4)], 422, '任务编号重复'),
])
def test_validation_preserves_errors_and_rule_order(tasks, status, message):
    with pytest.raises(HTTPException) as caught:
        validate_tasks(tasks)
    assert caught.value.status_code == status
    assert caught.value.detail == message


def test_validation_isolated_between_calls_and_does_not_mutate_tasks():
    tasks = [task(agent_run_id='plan', proposal_index=0,
                  start='08:00', end='09:00', q=3, nested={'values': [1]})]
    original = deepcopy(tasks)
    assert validate_tasks(tasks) is None
    assert validate_tasks(tasks) is None
    assert tasks == original


def test_distinct_proposals_and_existing_optional_field_semantics():
    tasks = [task(), task('1'),
             task(2, agent_run_id='plan', proposal_index=0),
             task(3, agent_run_id='other', proposal_index=0),
             task(4, agent_run_id='plan', proposal_index=1),
             task(5, agent_run_id='plan', proposal_index='0'),
             task(6, agent_run_id='plan', proposal_index='0'),
             task(7, end='09:00')]
    assert validate_tasks(tasks) is None
    assert validate_tasks([]) is None
