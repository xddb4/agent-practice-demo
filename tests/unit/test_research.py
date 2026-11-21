import json

from langchain_core.messages import AIMessage

from core_engine.ai.tools.research import ResearchSession
from core_engine.ai.workflows import plan_dialogue


def source(url):
    return {'title': url, 'url': 'https://example.com/' + url, 'summary': '官方通知摘要'}


def test_no_search_without_a_gap():
    session = ResearchSession(search_fn=lambda *a, **kw: (_ for _ in ()).throw(AssertionError('unexpected search')))
    assert session.status()['status'] == 'not_used'
    assert session.sources == []


def test_targeted_followup_dedup_and_count_budget():
    calls = []
    def search(query, **kwargs):
        calls.append((query, kwargs))
        return {'status': 'success', 'sources': [source(str(i)) for i in range(5)] if len(calls) == 1
                else [source(str(i)) for i in range(4, 9)], 'checked_at': '2026-11-14'}
    session = ResearchSession(search_fn=search)
    session.run('比赛 通知', '确认届次与日期', 5)
    assert session.run('比赛  通知', '重复核验', 5)['cached']
    session.run('比赛 评分标准', '补查官方评分标准', 5)
    assert len(session.sources) == 9
    session.run('比赛 提交格式', '补查提交要求', 5)
    assert calls[-1][1]['count'] == 1
    assert session.run('更多资料', '不必要搜索', 5)['status'] == 'budget_exhausted'
    assert len(calls) == 3
    assert session.status()['requests'][1]['purpose'] == '补查官方评分标准'


def test_search_time_budget_and_failure_are_honest():
    now = [0]
    def search(query, **kwargs):
        assert kwargs['timeout'] <= 12
        now[0] += 16
        return {'status': 'failed', 'sources': [], 'message': '联网检索超时'}
    session = ResearchSession(search_fn=search, clock=lambda: now[0])
    session.run('考试 日期', '确认日期', 1)
    session.run('官方 通知', '补查通知', 1)
    assert session.run('第三次', '核验', 1)['status'] == 'budget_exhausted'
    assert session.status()['status'] == 'failed'
    assert session.sources == []


def test_dialogue_can_search_then_supplement_without_changing_tasks(monkeypatch):
    monkeypatch.setattr(plan_dialogue, 'search_provider', lambda: 'test')
    session = ResearchSession(search_fn=lambda query, **kwargs: {
        'status': 'success', 'sources': [source(query)], 'checked_at': '2026-11-14'})
    monkeypatch.setattr(plan_dialogue, 'ResearchSession', lambda: session)
    outputs = [
        AIMessage(content='', tool_calls=[{'name': 'search', 'args': {'query': '考试通知', 'purpose': '日期', 'count': 1}, 'id': 'a'}]),
        AIMessage(content='', tool_calls=[{'name': 'search', 'args': {'query': '考试机构 评分说明', 'purpose': '评分', 'count': 2}, 'id': 'b'}]),
        AIMessage(content=json.dumps({'reply': '日期和评分规则已获得检索线索，请核对官方通知。', 'changes': []})),
    ]
    calls = []
    class Model:
        def bind_tools(self, tools):
            return self
        def invoke(self, messages):
            calls.append(list(messages))
            return outputs.pop(0)
    monkeypatch.setattr(plan_dialogue, 'create_model', lambda: Model())
    monkeypatch.setattr(plan_dialogue, 'structured_model', lambda _: Model())
    result = plan_dialogue.propose({'context': {'本轮消息': '今年考试规则有更新吗'}, 'skills': []})['result']
    assert result['changes'] == []
    assert len(result['sources']) == 2
    assert result['search_status']['search_calls'] == 2
    assert any(message.type == 'tool' for message in calls[-1])


def test_dialogue_may_skip_search_even_when_available(monkeypatch):
    monkeypatch.setattr(plan_dialogue, 'search_provider', lambda: 'test')
    class Model:
        def bind_tools(self, tools):
            return self
        def invoke(self, messages):
            return AIMessage(content=json.dumps({'reply': '可以先将周三练习改到周四，待你确认具体时段。', 'changes': []}))
    monkeypatch.setattr(plan_dialogue, 'create_model', lambda: Model())
    monkeypatch.setattr(plan_dialogue, 'structured_model', lambda _: Model())
    result = plan_dialogue.propose({'context': {'本轮消息': '周三没空'}, 'skills': []})['result']
    assert result['search_status']['search_calls'] == 0
    assert result['sources'] == []


def test_initial_recommendation_can_supplement_information(monkeypatch):
    from core_engine.ai.workflows import pilot
    monkeypatch.setenv('MODEL_API_KEY', 'test-only')
    session = ResearchSession(search_fn=lambda query, **kwargs: {
        'status': 'success', 'sources': [source(query)]})
    monkeypatch.setattr(pilot, 'ResearchSession', lambda: session)
    monkeypatch.setattr(pilot, 'planning_slots', lambda *args: ([], {}))
    monkeypatch.setattr(pilot, 'schedule_plan', lambda items, *args: (items, {'feasible': True}))
    monkeypatch.setattr(pilot, 'review_tasks', lambda result, *args: (result, {'status': 'ok'}))
    payload = {'items': [{'title': '核对参赛提交要求', 'estimated_minutes': 20,
        'important': True, 'urgent': False, 'rationale': '确保符合规则',
        'task_key': 'rules', 'requires_contiguous': False}], 'notice': '请核对'}
    outputs = [
        AIMessage(content='', tool_calls=[{'name': 'search', 'args': {'query': '赛事官方通知', 'purpose': '核实日期', 'count': 1}, 'id': 'a'}]),
        AIMessage(content='', tool_calls=[{'name': 'search', 'args': {'query': '赛事提交指南', 'purpose': '补查格式要求', 'count': 2}, 'id': 'b'}]),
        AIMessage(content=json.dumps(payload)),
    ]
    class Model:
        def bind_tools(self, tools):
            return self
        def invoke(self, messages):
            return outputs.pop(0)
    monkeypatch.setattr(pilot, 'model', lambda: Model())
    result = pilot.generate({'route': 'recommend', 'text': '准备比赛', 'context': {}})['result']
    assert result['search_status']['search_calls'] == 2
    assert len(result['sources']) == 2
    assert result['items'][0]['title'] == '核对参赛提交要求'
