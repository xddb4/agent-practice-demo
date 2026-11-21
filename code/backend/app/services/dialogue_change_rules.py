"""调整建议校验管线：单项约束、数量、依赖及时间冲突相互独立。"""

from datetime import date, datetime, timedelta

from fastapi import HTTPException

from .dialogue_tasks import LOCAL, task_view


RESTORE_ERROR = '恢复过期任务须同时重设今天或之后的计划日期、截止日期和预计时长'
DEADLINE_ERROR = '调整建议超出任务或目标截止日期，请缩小范围后重试'
DEPENDENCY_ERROR = '调整建议打乱了前置任务或间隔，请重新安排'
TIME_FIELDS = ('date', 'start', 'end')


def validate_restoration(after, patch, was_expired):
    if not was_expired:
        return
    today = datetime.now(LOCAL).date().isoformat()
    day, deadline = after.get('date'), after.get('ddl')
    complete = {'date', 'ddl', 'duration'} <= patch.keys()
    valid_day = bool(day) and day >= today
    valid_deadline = bool(deadline) and valid_day and deadline >= day
    if not all((complete, valid_day, valid_deadline, after.get('duration'))):
        raise HTTPException(422, RESTORE_ERROR)


def validate_fixed_slot(after):
    start, end = after.get('start'), after.get('end')
    if bool(start) != bool(end):
        raise HTTPException(422, '调整建议的固定时段无效，请补充完整的日期和起止时间')
    if start and (not after.get('date') or start >= end):
        raise HTTPException(422, '调整建议的固定时段无效，请补充完整的日期和起止时间')


def validate_deadline(after, patch, cutoff):
    if not {'date', 'ddl'} & patch.keys():
        return
    day, deadline = after.get('date'), after.get('ddl')
    if day and deadline and day > deadline:
        raise HTTPException(422, DEADLINE_ERROR)
    if cutoff and any(value and value > cutoff for value in (day, deadline)):
        raise HTTPException(422, DEADLINE_ERROR)


def validate_capacity(context, previews):
    delta = sum((change['action'] == 'add') - (change['action'] == 'cancel') for change in previews)
    if len(context.items) - len(context.cancelled) + delta > 100:
        raise HTTPException(422, '单份方案最多保留 100 项任务，请先取消不再需要的任务')


class DependencyRule:
    def __init__(self, context, previews):
        self.context = context
        self.touched = {change['index'] for change in previews}
        self.replacements = {change['index']: change['after'] for change in previews}
        self.by_key = {item['task_key']: index for index, item in enumerate(context.items)
                       if item.get('task_key') and index not in context.cancelled}

    def validate(self):
        for index, item in enumerate(self.context.items):
            if self._removed(index):
                continue
            self._validate_item(index, item)

    def _removed(self, index):
        return index in self.context.cancelled or (index in self.replacements and self.replacements[index] is None)

    def _view(self, index):
        return self.replacements.get(index, task_view(self.context.items[index], self.context.linked.get(index)))

    def _validate_item(self, index, item):
        for key in item.get('depends_on', []):
            prerequisite = self.by_key.get(key)
            if prerequisite is None or not ({index, prerequisite} & self.touched):
                continue
            self._validate_pair(self._view(prerequisite), self._view(index), item)

    def _validate_pair(self, earlier, later, item):
        if earlier is None:
            raise HTTPException(422, '建议取消的任务仍有后续依赖，请一并调整相关任务')
        first = earlier.get('date') if earlier.get('end') else earlier.get('ddl') or earlier.get('date')
        second = later.get('date')
        if not first or not second:
            return
        earliest = date.fromisoformat(first) + timedelta(days=item.get('min_gap_days', 0))
        if date.fromisoformat(second) < earliest:
            raise HTTPException(422, DEPENDENCY_ERROR)
        if first == second and earlier.get('end') and later.get('start') and earlier['end'] > later['start']:
            raise HTTPException(422, DEPENDENCY_ERROR)


def overlaps(task, after):
    if task.get('date') != after['date'] or not task.get('start') or not task.get('end'):
        return False
    return after['start'] < task['end'] and task['start'] < after['end']


class ConflictRule:
    def __init__(self, context, previews):
        self.previews = previews
        touched = {change['index'] for change in previews}
        moved_ids = {context.linked[index]['id'] for index in touched if index in context.linked}
        occupied = [task for task in context.tasks if task['id'] not in moved_ids]
        occupied.extend(task_view(item) for index, item in enumerate(context.items)
                        if index not in touched and index not in context.linked
                        and index not in context.cancelled and item.get('start'))
        proposed = [change['after'] for change in previews if change['after'] and change['after'].get('start')]
        self.occupied = [*occupied, *proposed]

    def validate(self):
        for change in self.previews:
            after = change['after']
            if not after or not after.get('start'):
                continue
            if self._conflicts(change):
                raise HTTPException(409, '建议的固定时间与日程冲突，请要求 Agent 换一个时段')

    def _conflicts(self, change):
        after, before = change['after'], change['before']
        if not any(after.get(key) != before.get(key) for key in TIME_FIELDS):
            return False
        return any(overlaps(task, after) for task in self.occupied if task is not after)


def validate_batch(context, previews):
    validate_capacity(context, previews)
    DependencyRule(context, previews).validate()
    ConflictRule(context, previews).validate()
