"""推荐任务的质量审查、试排与一次范围修订。"""

import json

from langchain_core.messages import HumanMessage
from openai import APIError
from pydantic import ValidationError


def revision_message(draft, planning):
    feedback = {
        'draft': [{key: item[key] for key in (
            'task_key', 'title', 'estimated_minutes', 'requires_contiguous', 'depends_on', 'min_gap_days',
        )} for item in draft],
        'unscheduled': planning['unscheduled'],
    }
    return HumanMessage(content=(
        '首次试排发现下列任务排不下。根据系统给出的可用时间摘要，重选本轮任务范围与练习量，'
        '保留目标所需的核心训练及其前置任务，减少可选任务或改用能独立完成的较小练习。'
        '不要压缩必要的真实时长，也不要缩短用户要求的练习间隔。'
        '在 notice 简述调整或延后的内容。返回完整 JSON 候选，不再调用工具。\n'
        + json.dumps(feedback, ensure_ascii=False)
    ))


class RecommendationPlanner:
    def __init__(self, dependencies, invoke, trace):
        self.dependencies = dependencies
        self.invoke = invoke
        self.trace = trace

    def process(self, result, state, prompt, now, availability):
        result, quality = self.dependencies.review_tasks(result, {
            'request': state['text'], 'availability': availability[1],
            'profile': state['context'], 'materials': state.get('materials', []),
        }, self.invoke, prompt.vision)
        result['quality_review'] = quality
        self.trace.append('任务粒度与材料依赖审查：' + quality['status'])
        draft = result['items']
        result['items'], result['planning'] = self._schedule(draft, state, now, availability)
        planning = result['planning']
        if planning.get('unscheduled') and planning.get('minutes_available', 0) > 0:
            self._revise(result, draft, state, prompt, now, availability)
        if quality['status'] == 'unavailable':
            result['planning'].setdefault('warnings', []).append('任务细化检查未完成，请核对练习范围和材料。')
        return result

    def _schedule(self, items, state, now, availability):
        return self.dependencies.schedule_plan(items, state['text'], state['schedule_tasks'], now, availability)

    def _revise(self, result, draft, state, prompt, now, availability):
        messages = [*prompt.messages, revision_message(draft, result['planning'])]
        try:
            response = self.invoke(self.dependencies.structured_model(prompt.vision), messages, 'model_budget_revision')
            revised = prompt.contract.model_validate_json(response.content).model_dump(mode='json')
            items, planning = self._schedule(revised['items'], state, now, availability)
            if planning['feasible']:
                self._accept_revision(result, revised, items, planning, state)
        except (APIError, ValidationError, TypeError):
            self.trace.append('任务范围调整未完成，保留首次试排结果')

    def _accept_revision(self, result, revised, items, planning, state):
        planning['scope_adjustment'] = revised['notice'] or '已根据可用时间调整本轮任务范围。'
        result.update(items=items, planning=planning, notice=revised['notice'])
        if state.get('dialogue_message'):
            result['dialogue_reply'] = revised.get('dialogue_reply') or (
                '已根据你的可用时间缩减近期任务范围。' + revised['notice']
                + ' 可以查看近期任务，也可以继续补充情况。'
            )
        self.trace.append('根据试排结果调整任务范围')
