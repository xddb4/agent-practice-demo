"""时段分配策略；仅在整项任务可排下时提交预留。"""

from bisect import bisect_left

from .scheduling_availability import MINUTE


def contiguous_start(slots, start, duration):
    first = start
    for index in range(start, len(slots)):
        if index > first and slots[index] - slots[index - 1] != MINUTE:
            first = index
        if index - first + 1 == duration:
            return first
    return len(slots)


class SplitAllocation:
    def propose(self, slots, start, duration, remaining):
        return start, min(duration, remaining, len(slots) - start)

    def failure_reason(self, _duration):
        return '在当前预算、依赖间隔与截止日期内排不下。'


class ContinuousAllocation:
    def propose(self, slots, start, duration, remaining):
        if remaining < duration:
            return start, 0
        start = contiguous_start(slots, start, duration)
        if start + duration > len(slots):
            return start, 0
        return start, duration

    def failure_reason(self, duration):
        return '在截止日期前的周预算内找不到 ' + str(duration) + ' 分钟的连续空档。'


SPLIT_ALLOCATION = SplitAllocation()
CONTINUOUS_ALLOCATION = ContinuousAllocation()


def allocation_strategy(continuous):
    return CONTINUOUS_ALLOCATION if continuous else SPLIT_ALLOCATION


class ReservationPool:
    def __init__(self, slots, remaining):
        self.slots = slots
        self.remaining = remaining

    def reserve(self, earliest, duration, strategy):
        reservations = []
        for week, slots in self.slots.items():
            start = bisect_left(slots, earliest)
            start, count = strategy.propose(slots, start, duration, self.remaining[week])
            if not count:
                continue
            reservations.append((week, start, count))
            duration -= count
            if not duration:
                break
        if duration:
            return []
        return self._commit(reservations)

    def _commit(self, reservations):
        chosen = []
        for week, start, count in reservations:
            chosen.extend(self.slots[week][start:start + count])
            del self.slots[week][start:start + count]
            self.remaining[week] -= count
        return chosen
