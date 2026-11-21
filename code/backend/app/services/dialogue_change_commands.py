"""调整命令：新增、修改、取消共享预览契约，各自处理方案更新。"""

from fastapi import HTTPException

from .dialogue_change_rules import (
    TIME_FIELDS, validate_batch, validate_deadline, validate_fixed_slot, validate_restoration,
)
from .dialogue_tasks import plan_deadline, task_view
from .plans import linked_tasks, plan_items
from .task_expiry import expired


PATCH_FIELDS = {'estimated_minutes': 'duration', 'deadline': 'ddl'}
SCHEDULE_FIELDS = (*TIME_FIELDS, 'ddl', 'duration')


class ChangeContext:
    def __init__(self, data, tasks, plan_id):
        self.data = data
        self.items = plan_items(data)
        self.linked = linked_tasks(tasks, plan_id, self.items)
        self.cancelled = set(data.get('cancelled_indices', []))
        self.tasks = tasks
        self.cutoff = plan_deadline(data)


def schedule_changed(change):
    return any(change['after'].get(key) != change['before'].get(key) for key in SCHEDULE_FIELDS)


def iso_time(day, value):
    return f'{day}T{value}:00+08:00' if value else None


def build_plan_item(previous, change):
    after, before = change['after'], change['before']
    adding = change['action'] == 'add'
    day, deadline = after.get('date'), after.get('ddl')
    item = {**previous, 'title': after['title'],
            'important': previous.get('important', True), 'urgent': previous.get('urgent', False),
            'rationale': previous.get('rationale') or '根据本次对话新增'}
    if 'description' in after:
        item['description'] = after['description']
    if adding or any(after.get(key) != before.get(key) for key in TIME_FIELDS):
        item.update(date=day, start=iso_time(day, after.get('start')), end=iso_time(day, after.get('end')))
    if adding or deadline != before.get('ddl'):
        item['deadline'] = f'{deadline}T23:59:00+08:00' if deadline else None
    if adding or after.get('duration') != before.get('duration'):
        item['estimated_minutes'] = after.get('duration') or previous.get('estimated_minutes') or 30
    if schedule_changed(change):
        item.update(suggested_sessions=[], suggested_finish=None)
    return item


class AddCommand:
    def prepare(self, builder, change):
        index = len(builder.context.items) + sum(item['action'] == 'add' for item in builder.previews)
        return builder.changed_preview(change, index, {})

    def apply(self, mutation, change):
        mutation.context.items.append(build_plan_item({}, change))


class ModifyCommand:
    def prepare(self, builder, change):
        index = change.get('index')
        return builder.changed_preview(change, index, builder.existing(index))

    def apply(self, mutation, change):
        index = change['index']
        mutation.context.items[index] = build_plan_item(mutation.context.items[index], change)


class CancelCommand:
    def prepare(self, builder, change):
        index = change.get('index')
        return builder.preview('cancel', index, builder.existing(index), None)

    def apply(self, mutation, change):
        mutation.context.cancelled.add(change['index'])


COMMANDS = {'add': AddCommand(), 'modify': ModifyCommand(), 'cancel': CancelCommand()}


class PreviewBuilder:
    def __init__(self, context):
        self.context = context
        self.seen = set()
        self.previews = []

    def build(self, changes):
        for change in changes:
            preview = COMMANDS[change['action']].prepare(self, change)
            if preview is not None:
                self.previews.append(preview)
        validate_batch(self.context, self.previews)
        return self.previews

    def existing(self, index):
        if type(index) is not int or not 0 <= index < len(self.context.items):
            raise HTTPException(422, '调整建议包含重复或无效的任务编号，请重新描述')
        if index in self.seen or index in self.context.cancelled:
            raise HTTPException(422, '调整建议包含重复或无效的任务编号，请重新描述')
        self.seen.add(index)
        before = task_view(self.context.items[index], self.context.linked.get(index))
        if before.get('done'):
            raise HTTPException(422, '调整建议涉及已完成的任务，请重新描述')
        return before

    def was_expired(self, index):
        return index in self.context.linked and expired(self.context.linked[index])

    def changed_preview(self, change, index, before):
        patch = {PATCH_FIELDS.get(key, key): value for key, value in change['fields'].items()}
        after = {**before, **patch}
        validate_restoration(after, patch, self.was_expired(index))
        validate_fixed_slot(after)
        validate_deadline(after, patch, self.context.cutoff)
        if before and all((value or None) == (before.get(key) or None) for key, value in patch.items()):
            return None
        return self.preview(change['action'], index, before, after)

    def preview(self, action, index, before, after):
        result = {'action': action, 'index': index, 'official': index in self.context.linked,
                  'before': before, 'after': after}
        if self.was_expired(index):
            result['expired'] = True
        return result


class PlanMutation:
    def __init__(self, context):
        self.context = context
        self.updates = {}

    def apply(self, previews):
        for change in previews:
            COMMANDS[change['action']].apply(self, change)
            self._update_calendar(change)
        data = {**self.context.data, 'items': self.context.items,
                'cancelled_indices': sorted(self.context.cancelled), 'item_revisions': {},
                'reviewed_items': [], 'reviewed_indices': [], 'planning': {}}
        tasks = [self.updates.get(task['id'], task) for task in self.context.tasks
                 if self.updates.get(task['id'], task) is not None]
        return data, tasks

    def _update_calendar(self, change):
        index, after = change['index'], change['after']
        task = self.context.linked.get(index)
        if task is None:
            return
        if after is None:
            self.updates[task['id']] = None
            return
        fields = {key: value for key, value in after.items() if value != change['before'].get(key)}
        fields = {key: (value if value is not None else '') for key, value in fields.items()}
        if schedule_changed(change):
            fields.update(suggested_sessions=[], suggest='未设置')
        self.updates[task['id']] = {**task, **fields, 'proposal_index': index}
