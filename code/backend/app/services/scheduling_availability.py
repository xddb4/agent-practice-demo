"""空闲时间构建器：解析约束，排除固定安排，汇总真实周预算。"""

import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, time
from zoneinfo import ZoneInfo


TZ = ZoneInfo('Asia/Shanghai')
MINUTE = timedelta(minutes=1)


class InvalidPlanningConstraints(ValueError):
    pass


def parse_goal(text):
    try:
        goal = json.loads(text)
    except (ValueError, TypeError):
        return {}
    return goal if isinstance(goal, dict) else {}


def weekly_minutes(goal):
    try:
        return int(float(goal.get('每周小时', 0)) * 60)
    except (ValueError, TypeError, OverflowError):
        return 0


@dataclass(frozen=True)
class PlanningConstraints:
    deadline: date
    weekly: int

    @classmethod
    def from_text(cls, text):
        goal = parse_goal(text)
        try:
            deadline = datetime.fromisoformat(str(goal.get('截止日期', ''))).date()
        except ValueError:
            raise InvalidPlanningConstraints('请补充目标截止日期，才能计算建议DDL。') from None
        weekly = weekly_minutes(goal)
        if weekly <= 0:
            raise InvalidPlanningConstraints('请补充每周可投入时间。')
        return cls(deadline, weekly)


class FixedScheduleCalendar:
    def __init__(self, tasks):
        self.tasks = tasks

    def _matches_day(self, task, day):
        if task.get('date') == day.isoformat():
            return True
        if task.get('repeat') not in ['每周', '每周六']:
            return False
        if task.get('date', '9999') > day.isoformat():
            return False
        try:
            return datetime.fromisoformat(task['date']).date().weekday() == day.weekday()
        except ValueError:
            return False

    def busy_intervals(self, day):
        busy = []
        for task in self.tasks:
            if not task.get('start') or not task.get('end'):
                continue
            if not self._matches_day(task, day):
                continue
            try:
                busy.append(tuple(int(value[:2]) * 60 + int(value[3:5])
                                  for value in [task['start'], task['end']]))
            except (ValueError, TypeError):
                pass
        return busy


class AvailabilityBuilder:
    def __init__(self, text, tasks, now):
        self.text = text
        self.calendar = FixedScheduleCalendar(tasks)
        self.now = now
        self.slots = {}
        self.longest = {}

    def build(self):
        try:
            constraints = PlanningConstraints.from_text(self.text)
        except InvalidPlanningConstraints as error:
            return [], {'feasible': False, 'warnings': [str(error)]}
        end = min(constraints.deadline, self.now.date() + timedelta(days=366))
        day = self.now.date()
        while day <= end:
            self._collect_day(day)
            day += timedelta(days=1)
        weeks = self._weeks(end, constraints.weekly)
        return self.slots, {
            'weekly_minutes': constraints.weekly,
            'minutes_available': sum(week['available_minutes'] for week in weeks),
            'longest_contiguous_minutes': max((week['longest_contiguous_minutes'] for week in weeks), default=0),
            'target_date': constraints.deadline.isoformat(), 'weeks': weeks,
        }

    def _collect_day(self, day):
        week = (day - self.now.date()).days // 7
        week_slots = self.slots.setdefault(week, [])
        start = 8 * 60
        if day == self.now.date():
            start = max(start, math.ceil((self.now.hour * 60 + self.now.minute + 1) / 15) * 15)
        busy = self.calendar.busy_intervals(day)
        consecutive = 0
        for minute in range(start, 22 * 60):
            if any(a <= minute < b for a, b in busy):
                continue
            slot = datetime.combine(day, time(minute // 60, minute % 60), TZ)
            consecutive = consecutive + 1 if week_slots and slot - week_slots[-1] == MINUTE else 1
            self.longest[week] = max(self.longest.get(week, 0), consecutive)
            week_slots.append(slot)

    def _weeks(self, end, weekly):
        return [{
            'start': (self.now.date() + timedelta(days=week * 7)).isoformat(),
            'end': min(end, self.now.date() + timedelta(days=week * 7 + 6)).isoformat(),
            'available_minutes': min(weekly, len(week_slots)),
            'longest_contiguous_minutes': min(weekly, self.longest.get(week, 0)),
        } for week, week_slots in self.slots.items()]
