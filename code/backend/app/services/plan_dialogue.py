"""Build and validate changes without writing them to the plan or calendar."""

import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from .plans import linked_tasks, plan_items, plan_title

LOCAL = ZoneInfo('Asia/Shanghai')


def local_time(value):
    return datetime.fromisoformat(value).astimezone(LOCAL).strftime('%H:%M') if value else ''


def task_view(item, official=None):
    if official:
        return {key: official.get(key) for key in ('title', 'date', 'start', 'end', 'duration', 'ddl', 'done')}
    return {
        'title': item['title'], 'date': item.get('date'),
        'start': local_time(item.get('start')), 'end': local_time(item.get('end')),
        'duration': item.get('estimated_minutes'), 'ddl': (item.get('deadline') or '')[:10],
    }


def dialogue_context(data, tasks, plan_id, messages, text):
    items = plan_items(data)
    linked = linked_tasks(tasks, plan_id, items)
    cancelled = set(data.get('cancelled_indices', []))
    today = datetime.now(LOCAL).date().isoformat()
    upcoming = sorted((task for task in tasks if task.get('date', '') >= today and task.get('start')),
                      key=lambda task: (task['date'], task['start']))
    return {
        '当前日期': today, '时区': 'Asia/Shanghai', '目标': plan_title(data),
        '原始目标条件': data.get('input_source', '')[:3000],
        '用户长期情况摘要': data.get('dialogue', {}).get('memory', ''),
        '当前方案': [
            {'index': index, 'key': item.get('task_key'), 'depends_on': item.get('depends_on', []),
             'min_gap_days': item.get('min_gap_days', 0), 'requires_contiguous': item.get('requires_contiguous', False),
             **task_view(item, linked.get(index)), '已加入日程': index in linked,
             '建议时段': (linked.get(index, item).get('suggested_sessions') or [])[:8]}
            for index, item in enumerate(items) if index not in cancelled
        ],
        '近期固定安排': [task_view({}, task) for task in upcoming[:60]],
        '近期对话': [{key: turn[key][:1600] for key in ('role', 'text')} for turn in messages[-10:]],
        '本轮消息': text,
    }


def plan_deadline(data):
    try:
        source = json.loads(data.get('input_source', ''))
        return date.fromisoformat(source['截止日期']).isoformat()
    except (ValueError, TypeError, KeyError):
        return ''


def prepare_changes(data, tasks, plan_id, changes):
    items = plan_items(data)
    linked = linked_tasks(tasks, plan_id, items)
    cancelled = set(data.get('cancelled_indices', []))
    seen = set()
    previews = []
    cutoff = plan_deadline(data)
    for change in changes:
        action = change['action']
        index = change.get('index')
        if action == 'add':
            index = len(items) + sum(item['action'] == 'add' for item in previews)
            before = {}
        else:
            if index in seen or index in cancelled or index >= len(items):
                raise HTTPException(422, '调整建议包含重复或无效的任务编号，请重新描述')
            seen.add(index)
            before = task_view(items[index], linked.get(index))
            if before.get('done'):
                raise HTTPException(422, '调整建议涉及已完成的任务，请重新描述')
        after = None
        if action != 'cancel':
            patch = { {'estimated_minutes': 'duration', 'deadline': 'ddl'}.get(key, key): value
                      for key, value in change['fields'].items() }
            after = {**before, **patch}
            start, end = after.get('start'), after.get('end')
            if bool(start) != bool(end) or (start and (not after.get('date') or start >= end)):
                raise HTTPException(422, '调整建议的固定时段无效，请补充完整的日期和起止时间')
            day, deadline = after.get('date'), after.get('ddl')
            if (('date' in patch or 'ddl' in patch) and ((day and deadline and day > deadline)
                    or (cutoff and any(value and value > cutoff for value in (day, deadline))))):
                raise HTTPException(422, '调整建议超出任务或目标截止日期，请缩小范围后重试')
            if before and all((value or None) == (before.get(key) or None) for key, value in patch.items()):
                continue
        previews.append({'action': action, 'index': index, 'official': index in linked,
                         'before': before, 'after': after})

    if len(items) - len(cancelled) + sum((change['action'] == 'add') - (change['action'] == 'cancel') for change in previews) > 100:
        raise HTTPException(422, '单份方案最多保留 100 项任务，请先取消不再需要的任务')
    touched = {change['index'] for change in previews}
    replacements = {change['index']: change['after'] for change in previews}
    by_key = {item['task_key']: index for index, item in enumerate(items)
              if item.get('task_key') and index not in cancelled}
    for index, item in enumerate(items):
        if index in cancelled or (index in replacements and replacements[index] is None):
            continue
        for key in item.get('depends_on', []):
            prerequisite = by_key.get(key)
            if prerequisite is None or not ({index, prerequisite} & touched):
                continue
            earlier = replacements.get(prerequisite, task_view(items[prerequisite], linked.get(prerequisite)))
            later = replacements.get(index, task_view(item, linked.get(index)))
            if earlier is None:
                raise HTTPException(422, '建议取消的任务仍有后续依赖，请一并调整相关任务')
            first = earlier.get('date') if earlier.get('end') else earlier.get('ddl') or earlier.get('date')
            second = later.get('date')
            if first and second:
                earliest = date.fromisoformat(first) + timedelta(days=item.get('min_gap_days', 0))
                if date.fromisoformat(second) < earliest or (first == second and earlier.get('end')
                        and later.get('start') and earlier['end'] > later['start']):
                    raise HTTPException(422, '调整建议打乱了前置任务或间隔，请重新安排')
    moved_ids = {linked[index]['id'] for index in touched if index in linked}
    occupied = [task for task in tasks if task['id'] not in moved_ids]
    occupied.extend(task_view(item) for index, item in enumerate(items)
                    if index not in touched and index not in linked and index not in cancelled and item.get('start'))
    proposed_slots = [change['after'] for change in previews if change['after'] and change['after'].get('start')]
    for change in previews:
        after = change['after']
        before = change['before']
        if not after or not after.get('start'):
            continue
        time_keys = ('date', 'start', 'end')
        if any(after.get(key) != before.get(key) for key in time_keys) and any(
                task.get('date') == after['date'] and task.get('start') and task.get('end')
                and after['start'] < task['end'] and task['start'] < after['end']
                for task in [*occupied, *proposed_slots] if task is not after):
            raise HTTPException(409, '建议的固定时间与日程冲突，请要求 Agent 换一个时段')
    return previews


def apply_changes(data, tasks, plan_id, previews):
    items = plan_items(data)
    linked = linked_tasks(tasks, plan_id, items)
    cancelled = set(data.get('cancelled_indices', []))
    updates = {}
    for change in previews:
        index, action, after = change['index'], change['action'], change['after']
        if action == 'cancel':
            cancelled.add(index)
        else:
            previous = items[index] if action == 'modify' else {}
            day = after.get('date')
            deadline = after.get('ddl')
            schedule_changed = any(after.get(key) != change['before'].get(key)
                                   for key in ('date', 'start', 'end', 'ddl', 'duration'))
            item = {**previous, 'title': after['title'],
                    'important': previous.get('important', True), 'urgent': previous.get('urgent', False),
                    'rationale': previous.get('rationale') or '根据本次对话新增'}
            before = change['before']
            if action == 'add' or any(after.get(key) != before.get(key) for key in ('date', 'start', 'end')):
                item.update(date=day, start=f"{day}T{after['start']}:00+08:00" if after.get('start') else None,
                            end=f"{day}T{after['end']}:00+08:00" if after.get('end') else None)
            if action == 'add' or deadline != before.get('ddl'):
                item['deadline'] = f'{deadline}T23:59:00+08:00' if deadline else None
            if action == 'add' or after.get('duration') != before.get('duration'):
                item['estimated_minutes'] = after.get('duration') or previous.get('estimated_minutes') or 30
            if schedule_changed:
                item.update(suggested_sessions=[], suggested_finish=None)
            if action == 'add':
                items.append(item)
            else:
                items[index] = item
        if index in linked:
            task = linked[index]
            if after is None:
                updates[task['id']] = None
            else:
                fields = {key: value for key, value in after.items() if value != change['before'].get(key)}
                fields = {key: (value if value is not None else '') for key, value in fields.items()}
                if schedule_changed:
                    fields.update(suggested_sessions=[], suggest='未设置')
                updates[task['id']] = {**task, **fields, 'proposal_index': index}
    data = {**data, 'items': items, 'cancelled_indices': sorted(cancelled), 'item_revisions': {},
            'reviewed_items': [], 'reviewed_indices': [], 'planning': {}}
    return data, [updates.get(task['id'], task) for task in tasks if updates.get(task['id'], task) is not None]
