"""Server-recorded task timestamps; elapsed wall time is not active study time."""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone

from .task_expiry import expiry_reference


def valid_stamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed if parsed.tzinfo else None
    except ValueError:
        return None


def clear_completion(_prior, _now):
    return None


def record_completion(_prior, now):
    return now


def retain_completion(prior, _now):
    return valid_stamp(prior.get('completed_at'))


# (current done, previous done): a save is a transition, not a client timestamp.
COMPLETION_POLICIES = {
    (False, False): clear_completion,
    (False, True): clear_completion,
    (True, False): record_completion,
    (True, True): retain_completion,
}


@dataclass(frozen=True)
class TaskTimestamps:
    created: datetime | None
    completed: datetime | None

    def elapsed_minutes(self):
        if self.created is None or self.completed is None:
            return None
        return max(0, int((self.completed - self.created).total_seconds() // 60))

    def fields(self):
        return {
            'created_at': self.created.isoformat() if self.created else None,
            'completed_at': self.completed.isoformat() if self.completed else None,
            'elapsed_minutes': self.elapsed_minutes(),
        }


class LifecycleStamper:
    def __init__(self, previous_tasks, now):
        self.previous = {str(task.get('id')): task for task in previous_tasks}
        self.now = now

    def stamp(self, task):
        prior = self.previous.get(str(task.get('id')))
        created = self.now
        if prior:
            created = valid_stamp(prior.get('created_at'))
        transition = (bool(task.get('done')), bool(prior and prior.get('done')))
        completed = COMPLETION_POLICIES[transition](prior, self.now)
        task.update(TaskTimestamps(created, completed).fields())
        return task


def stamp_tasks(tasks, previous_tasks, now=None):
    now = (now or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    stamper = LifecycleStamper(previous_tasks, now)
    return [stamper.stamp(task) for task in deepcopy(tasks)]


def execution_context(tasks, recent_limit=10, expired_tasks=None):
    completed=[task for task in tasks if task.get('done') and not task.get('start')]
    timed=[task for task in completed if task.get('elapsed_minutes') is not None]
    recent=sorted(completed,key=lambda task:task.get('completed_at') or '',reverse=True)[:recent_limit]
    return {'completed_flexible_tasks':len(completed),'known_elapsed_tasks':len(timed),'unknown_elapsed_tasks':len(completed)-len(timed),'expired_reference':expiry_reference(expired_tasks or []),
            'recent':[{key:(str(task.get(key,''))[:160] if key=='title' else task.get(key)) for key in ('id','title','ability','created_at','completed_at','elapsed_minutes')} for task in recent],
            'limitations':'历时为任务建立到标记完成的自然经过时间，包含等待与休息，并非实际学习用时；仅参考执行节奏，不能据此判断能力高低。旧任务未记录的时间不推测。'}
