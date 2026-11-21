"""Build and validate changes without writing them to the plan or calendar."""

from datetime import datetime

from .plans import linked_tasks, plan_items, plan_title
from .context import ability_context
from .task_lifecycle import execution_context
from .task_expiry import expiry_reference
from .dialogue_tasks import LOCAL, local_time, task_view, plan_deadline
from .dialogue_change_commands import ChangeContext, PlanMutation, PreviewBuilder

__all__ = [
    'dialogue_context', 'prepare_changes', 'apply_changes',
    'local_time', 'task_view', 'plan_deadline',
]


def dialogue_context(data, tasks, plan_id, messages, text, evidence=None, expired_tasks=None):
    items = plan_items(data)
    own_expired=[item for item in expired_tasks or [] if item['task'].get('agent_run_id')==plan_id]
    active_linked=linked_tasks(tasks,plan_id,items)
    linked = linked_tasks([*tasks,*[item['task'] for item in own_expired]], plan_id, items)
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
             **task_view(item, linked.get(index)), '已加入日程': index in active_linked,'已过期':index in linked and index not in active_linked,
             '建议时段': (linked.get(index, item).get('suggested_sessions') or [])[:8]}
            for index, item in enumerate(items) if index not in cancelled
        ],
        '近期固定安排': [task_view({}, task) for task in upcoming[:60]],
        '近期对话': [{key: turn[key][:1600] for key in ('role', 'text')} for turn in messages[-10:]],
        '历史检索线索（保留原检索时间，不代表本轮已核验）': [
            {key: source.get(key) for key in ('title', 'url', 'checked_at')}
            for source in [*data.get('sources', []), *[
                source for turn in messages[-10:] for source in turn.get('sources', [])
            ]][-10:]
        ],
        '本轮消息': text,
        '能力证据参考': ability_context(evidence or [], plan_title(data)+' '+text),
        '执行节奏参考': execution_context(tasks,recent_limit=5,expired_tasks=own_expired),
        '本对话过期任务参考': expiry_reference(own_expired,plan_id=plan_id),
        '过期调整规则':'仅调整当前对话来源的过期任务。恢复必须同时给出今天或之后的计划日期、新截止日期和预计时长。先解释取舍，再提出修改或取消建议，等待用户确认；不能仅凭过期推断能力不足。',
    }


def prepare_changes(data, tasks, plan_id, changes):
    context = ChangeContext(data, tasks, plan_id)
    return PreviewBuilder(context).build(changes)


def apply_changes(data, tasks, plan_id, previews):
    context = ChangeContext(data, tasks, plan_id)
    return PlanMutation(context).apply(previews)
