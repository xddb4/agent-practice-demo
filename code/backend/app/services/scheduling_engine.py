"""排期引擎：按依赖顺序组织分配，独立生成执行时段与失败说明。"""

from dataclasses import dataclass, field
from datetime import timedelta

from .scheduling_availability import MINUTE
from .scheduling_reservations import ReservationPool, allocation_strategy


class TaskGraph:
    def __init__(self, items):
        self.keys = [item.get('task_key') or 'task-' + str(index + 1) for index, item in enumerate(items)]
        if len(set(self.keys)) != len(self.keys):
            raise ValueError('任务标识重复')
        self.lookup = dict(zip(self.keys, items))

    def ordered_keys(self):
        ordered, remaining = [], list(self.keys)
        resolved = set()
        while remaining:
            ready = next((key for key in remaining if all(
                dep in resolved for dep in self.lookup[key].get('depends_on', [])
            )), None)
            if ready is None:
                raise ValueError('任务依赖存在循环或缺失')
            ordered.append(ready)
            resolved.add(ready)
            remaining.remove(ready)
        return ordered


def suggested_sessions(chosen):
    sessions = []
    start = previous = chosen[0]
    for stamp in chosen[1:]:
        if stamp - previous != MINUTE:
            sessions.append({'start': start.isoformat(), 'end': (previous + MINUTE).isoformat()})
            start = stamp
        previous = stamp
    sessions.append({'start': start.isoformat(), 'end': (previous + MINUTE).isoformat()})
    return sessions


def unscheduled_item(item, key):
    return {**item, 'task_key': key, 'depends_on': item.get('depends_on', []),
            'start': None, 'end': None, 'date': None, 'deadline': None,
            'suggested_finish': None, 'suggested_sessions': []}


@dataclass
class ScheduleResult:
    finishes: dict = field(default_factory=dict)
    items: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    unscheduled: dict = field(default_factory=dict)

    def reject(self, item, reason):
        self.unscheduled[item['task_key']] = reason
        self.warnings.append('“' + item['title'] + '”：' + reason)


class PlanScheduler:
    def __init__(self, items, slots, budget, now):
        self.items = items
        self.graph = TaskGraph(items)
        self.budget = budget
        copied_slots = {week: values.copy() for week, values in slots.items()}
        self.pool = ReservationPool(copied_slots, {week: budget['weekly_minutes'] for week in slots})
        self.now = now
        self.result = ScheduleResult()

    def schedule(self):
        for key in self.graph.ordered_keys():
            self._schedule_item(key)
        return self.result.items, {
            **self.budget, 'feasible': not self.result.warnings,
            'minutes_requested': sum(item['estimated_minutes'] for item in self.items),
            'warnings': self.result.warnings, 'unscheduled': self.result.unscheduled,
        }

    def _schedule_item(self, key):
        item = unscheduled_item(self.graph.lookup[key], key)
        missing = [dep for dep in item['depends_on'] if dep not in self.result.finishes]
        if missing:
            names = '、'.join('「' + self.graph.lookup[dep]['title'] + '」' for dep in missing)
            self.result.reject(item, '前置任务 ' + names + ' 尚未排期。')
        else:
            self._allocate(item)
        self.result.items.append(item)

    def _allocate(self, item):
        earliest = max((self.result.finishes[dep] for dep in item['depends_on']), default=self.now)
        earliest += timedelta(days=item.get('min_gap_days', 0))
        strategy = allocation_strategy(item.get('requires_contiguous', False))
        duration = item['estimated_minutes']
        chosen = self.pool.reserve(earliest, duration, strategy)
        if not chosen:
            self.result.reject(item, strategy.failure_reason(duration))
            return
        finish = chosen[-1] + MINUTE
        self.result.finishes[item['task_key']] = finish
        item.update(date=chosen[0].date().isoformat(), deadline=finish.isoformat(),
                    suggested_finish=finish.isoformat(), suggested_sessions=suggested_sessions(chosen))
