"""排期门面：保留公共调用方式，协调空闲时间构建与任务分配策略。"""

from datetime import datetime

from .scheduling_availability import AvailabilityBuilder, TZ
from .scheduling_engine import PlanScheduler
from .scheduling_reservations import ReservationPool, allocation_strategy, contiguous_start


__all__ = ['TZ', 'planning_slots', 'contiguous_start', 'reserve_slots', 'schedule_plan']


def planning_slots(text, tasks, now):
    return AvailabilityBuilder(text, tasks, now).build()


def reserve_slots(slots, remaining, earliest, duration, continuous):
    return ReservationPool(slots, remaining).reserve(earliest, duration, allocation_strategy(continuous))


def schedule_plan(items, text, tasks, now=None, availability=None):
    now = now or datetime.now(TZ)
    if availability is None:
        availability = planning_slots(text, tasks, now)
    slots, budget = availability
    if 'warnings' in budget:
        return items, budget
    return PlanScheduler(items, slots, budget, now).schedule()
