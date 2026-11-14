import json

import pytest
from langchain_core.messages import AIMessage

from backend.app.services.agent_errors import AgentOutputError, AgentOutputTooLongError, diagnose
from core_engine.ai.workflows import plan_dialogue


def run(monkeypatch, outputs):
    calls = []

    class Model:
        def invoke(self, messages):
            calls.append(list(messages))
            return outputs[len(calls)-1]

    monkeypatch.setattr(plan_dialogue, 'structured_model', lambda _: Model())
    return calls, lambda: plan_dialogue.propose({'context': {}, 'skills': []})


def test_whole_plan_can_adjust_sixteen_tasks(monkeypatch):
    payload = {'reply': '已生成待确认调整', 'changes': [
        {'action': 'modify', 'index': i, 'fields': {'estimated_minutes': 15}} for i in range(16)
    ]}
    calls, invoke = run(monkeypatch, [AIMessage(content=json.dumps(payload))])
    assert len(invoke()['result']['changes']) == 16
    assert len(calls) == 1
    assert 'JSON Schema' in calls[0][0].content


def test_invalid_result_is_repaired_once(monkeypatch):
    calls, invoke = run(monkeypatch, [
        AIMessage(content=json.dumps({'reply': '建议'})),
        AIMessage(content=json.dumps({'reply': '建议', 'changes': []})),
    ])
    assert invoke()['result']['changes'] == []
    assert len(calls) == 2
    assert 'missing' in calls[-1][-1].content


def test_failed_repair_returns_specific_safe_diagnosis(monkeypatch):
    bad = AIMessage(content=json.dumps({'reply': 'private-marker', 'changes': [
        {'action': 'modify', 'index': 0, 'fields': {'start': 'tomorrow'}}
    ]}))
    calls, invoke = run(monkeypatch, [bad, bad])
    with pytest.raises(AgentOutputError) as caught:
        invoke()
    detail = diagnose(caught.value, 'example', operation='dialogue')
    assert len(calls) == 2
    assert '自动修复 1 次' in detail['reason']
    assert detail['problems'] == ['第1项调整的开始时间：需要有效时间（时:分）']
    assert 'private-marker' not in str(detail) and 'tomorrow' not in str(detail)
    assert '手动添加' not in detail['action']


def test_truncated_output_has_its_own_category(monkeypatch):
    calls, invoke = run(monkeypatch, [AIMessage(content='{', response_metadata={'finish_reason': 'length'})])
    with pytest.raises(AgentOutputTooLongError):
        invoke()
    assert len(calls) == 1


def test_no_false_claim_of_repair():
    detail = diagnose(AgentOutputError([{'type': 'missing', 'loc': ['reply']}]), 'example', operation='dialogue')
    assert '修复' not in detail['reason']
    assert detail['problems'] == ['对话回复：缺少必填内容']


def test_only_user_quotes_can_become_evidence_candidates(monkeypatch):
    quote='我比较了两种方法的误差并记录了实验局限。'
    candidate={'title':'实验反思','quote':quote,'kind':'self_report','dimension':'实验验证与数据素养','rationale':'用户报告的过程，尚待核对。'}
    calls, invoke = run(monkeypatch, [AIMessage(content=json.dumps({'reply':'已分析。','changes':[],
        'evidence_candidates':[candidate,{**candidate,'quote':'模型自己推断用户已经掌握了方法'}]}))])
    result=plan_dialogue.propose({'context':{'本轮消息':quote},'skills':[]})['result']
    assert result['evidence_candidates']==[candidate]
