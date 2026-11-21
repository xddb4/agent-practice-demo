from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage

from backend.app.schemas.agent import output_contract
from backend.app.services.agent_errors import AgentOutputError
from backend.app.services.ai_safety import SafetyRefusal
from core_engine.ai.workflows.candidate_generation import CandidateGenerator, GenerationDependencies
from core_engine.ai.workflows.generation_output import InvocationRecorder, StructuredOutput, ToolConversation
from core_engine.ai.workflows.generation_strategies import select_route


@pytest.mark.parametrize('state,expected', [
    ({'text': '准备作品与比赛方案'}, 'evidence'),
    ({'text': '准备比赛'}, 'recommend'),
    ({'text': '明天下午开会'}, 'schedule'),
    ({'route': 'schedule', 'text': '整理作品证据'}, 'schedule'),
])
def test_route_rules_preserve_priority_and_explicit_choice(state, expected):
    assert select_route(state) == expected


def offline_dependencies():
    def forbidden(*args):
        raise AssertionError('Offline generation must not invoke a model or tool')
    return GenerationDependencies(
        model=forbidden, structured_model=forbidden, research_session=forbidden,
        profile_tool=forbidden, planning_slots=forbidden,
        schedule_plan=lambda items, *args: (items, {'feasible': True}),
        review_tasks=forbidden, stream_reply=forbidden,
    )


@pytest.mark.parametrize('route,count', [('schedule', 1), ('evidence', 1), ('recommend', 3)])
def test_offline_strategy_never_calls_models_or_search(monkeypatch, route, count):
    monkeypatch.setenv('MODEL_API_KEY', '')
    output = CandidateGenerator(offline_dependencies()).generate({
        'route': route, 'text': '安排练习', 'context': {},
    })
    assert len(output['items']) == count
    assert output['metrics']['model_calls'] == 0
    assert output['metrics']['stages'] == []
    assert output['sources'] == [] and output['search_status']['status'] == 'not_used'
    assert output['trace'][-1] == '等待用户确认'


def test_offline_images_do_not_fall_back_to_invented_candidates(monkeypatch):
    monkeypatch.setenv('MODEL_API_KEY', '')
    with pytest.raises(ValueError, match='视觉'):
        CandidateGenerator(offline_dependencies()).generate({
            'route': 'schedule', 'text': '识别课表', 'context': {}, 'image': 'data:image/png;base64,aA==',
        })


def test_invocation_adapter_streams_only_recommendation_dialogue_and_counts_calls():
    calls = []
    model = SimpleNamespace(invoke=lambda messages: calls.append('normal') or AIMessage(content='{}'))
    def stream(model, messages, field):
        calls.append(field)
        return AIMessage(content='{}')
    normal = InvocationRecorder({'route': 'schedule', 'dialogue_message': '安排练习'}, stream)
    normal.invoke(model, [], 'model_output')
    streaming = InvocationRecorder({'route': 'recommend', 'dialogue_message': '准备考试'}, stream)
    streaming.invoke(model, [], 'model_output')
    assert calls == ['normal', 'dialogue_reply']
    assert streaming.metrics({})['model_calls'] == 1


def test_invocation_adapter_rejects_sensitive_output_before_recording_success():
    recorder = InvocationRecorder({'route': 'schedule'}, None)
    model = SimpleNamespace(invoke=lambda _: AIMessage(content='联系13800138000'))
    with pytest.raises(SafetyRefusal):
        recorder.invoke(model, [], 'model_output')
    assert recorder.timings == []


def test_tool_strategy_stops_at_five_rounds_and_requests_structured_fallback():
    calls = []
    def invoke(model, messages, stage):
        calls.append(stage)
        return AIMessage(content='', tool_calls=[{'id': str(len(calls)), 'name': 'unknown', 'args': {}}])
    model = SimpleNamespace(bind_tools=lambda tools: 'bound-model')
    prompt = SimpleNamespace(messages=[], contract=output_contract('schedule'))
    result = ToolConversation(invoke, [], []).generate(model, prompt)
    assert result is None and len(calls) == 5
    assert any('工具轮次已达上限' in str(message.content) for message in prompt.messages)
    assert sum(message.content == '未知工具' for message in prompt.messages) == 5


def test_structured_output_repairs_once_then_reports_validation_failure():
    calls = []
    def invoke(model, messages, stage):
        calls.append(stage)
        return AIMessage(content='{}')
    prompt = SimpleNamespace(messages=[], contract=output_contract('schedule'), vision=False)
    with pytest.raises(AgentOutputError) as caught:
        StructuredOutput(invoke, lambda _: 'model', []).generate(prompt)
    assert len(calls) == 2
    assert caught.value.repair_attempted
    assert 'JSON字段校验失败' in prompt.messages[-1].content
