"""候选生成门面：选择在线/离线策略，组织工具、校验与排期。"""

from dataclasses import dataclass
from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from backend.app.services.ai_safety import guard_text, redact_context
from backend.app.services.model_settings import model_env
from core_engine.ai.prompts.generation import build_prompt
from core_engine.ai.skills import SKILL_LABELS
from .generation_output import InvocationRecorder, StructuredOutput, ToolConversation
from .generation_planning import RecommendationPlanner
from .generation_strategies import STRATEGIES


@dataclass
class GenerationDependencies:
    model: Callable
    structured_model: Callable
    research_session: Callable
    profile_tool: Callable
    planning_slots: Callable
    schedule_plan: Callable
    review_tasks: Callable
    stream_reply: Callable


def safe_state(state):
    guard_text(state['text'])
    return {
        **state, 'context': redact_context(state['context']),
        'schedule_tasks': redact_context(state.get('schedule_tasks', state['context'].get('tasks', []))),
        'materials': redact_context(state.get('materials', [])),
    }


class OfflineGeneration:
    def __init__(self, dependencies):
        self.dependencies = dependencies

    def generate(self, state, strategy):
        if state.get('image') or state.get('attachment_images'):
            raise ValueError('图片分析需要配置支持视觉的模型 API')
        route = state['route']
        items = strategy.offline_items(state['text'])
        output = {
            'items': items, 'notice': '离线规则模式，未调用模型或网络；所有字段需核对。',
            'sources': [], 'search_status': {
                'status': 'not_used', 'message': '本次未进行联网检索，方案仅依据你提供的信息。',
            },
            'trace': ['Router: ' + route, '离线候选生成', '等待用户确认'],
        }
        if route == 'recommend':
            output['items'], output['planning'] = self.dependencies.schedule_plan(
                items, state['text'], state['schedule_tasks'],
            )
        return output


class OnlineGeneration:
    def __init__(self, dependencies, recorder):
        self.dependencies = dependencies
        self.recorder = recorder

    def generate(self, state, strategy, now):
        research = self.dependencies.research_session()
        tools = [self.dependencies.profile_tool(state['context']), research.tool()]
        availability = self._availability(state, now)
        prompt = build_prompt(state, strategy, now, availability)
        trace = ['Router: ' + state['route']]
        trace.extend('Skill: ' + name for name in prompt.skills)
        result = self._result(state, prompt, tools, trace)
        if state['route'] == 'recommend':
            planner = RecommendationPlanner(self.dependencies, self.recorder.invoke, trace)
            result = planner.process(result, state, prompt, now, availability)
        result.update(
            sources=research.sources, search_status=research.status(), trace=trace + ['等待用户确认'],
            skills=[{'id': name, 'label': SKILL_LABELS[name]} for name in prompt.skills],
        )
        return result

    def _availability(self, state, now):
        if state['route'] == 'recommend':
            return self.dependencies.planning_slots(state['text'], state['schedule_tasks'], now)
        return None

    def _result(self, state, prompt, tools, trace):
        result = None
        if state['route'] == 'recommend' and not state.get('attachment_images'):
            conversation = ToolConversation(self.recorder.invoke, tools, trace)
            result = conversation.generate(self.dependencies.model(), prompt)
        if result is None:
            output = StructuredOutput(self.recorder.invoke, self.dependencies.structured_model, trace)
            result = output.generate(prompt)
        return result


class CandidateGenerator:
    def __init__(self, dependencies):
        self.dependencies = dependencies

    def generate(self, state):
        state = safe_state(state)
        now = datetime.now(ZoneInfo('Asia/Shanghai'))
        recorder = InvocationRecorder(state, self.dependencies.stream_reply)
        strategy = STRATEGIES[state['route']]
        if model_env('MODEL_API_KEY'):
            output = OnlineGeneration(self.dependencies, recorder).generate(state, strategy, now)
        else:
            output = OfflineGeneration(self.dependencies).generate(state, strategy)
        output['metrics'] = recorder.metrics(state['context'])
        return output
