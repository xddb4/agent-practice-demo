import json

from langchain_core.messages import AIMessage

from core_engine.ai.workflows import task_review


def task(key, title, **extra):
    return {
        'task_key': key, 'title': title, 'stage': '长对话专项',
        'estimated_minutes': 30, 'important': True, 'urgent': False,
        'requires_contiguous': True, 'rationale': '处理已反馈的问题', **extra,
    }


def test_review_can_split_a_bundled_task_with_explicit_materials(monkeypatch):
    draft = {'items': [task('all', '听力练习和复盘')], 'notice': ''}
    revised = {'items': [
        task('attempt', '限时完成诊断卷A长对话'),
        task('review', '对照诊断卷A原文标出错题中的漏听词', depends_on=['attempt']),
        task('retest', '限时完成未做过的材料B长对话', depends_on=['review'], min_gap_days=1),
    ], 'notice': ''}

    class Model:
        def invoke(self, messages):
            assert '每周预算' in messages[0].content
            assert '本周只有120分钟' in messages[1].content
            return AIMessage(content=json.dumps({'issues': ['限时练习和复盘混在一项'], 'revised': revised}))

    monkeypatch.setattr(task_review, 'structured_model', lambda _: Model())
    result, audit = task_review.review_tasks(draft, {'feedback': '本周只有120分钟'}, lambda model, messages, _: model.invoke(messages))
    assert audit['status'] == 'revised'
    assert result['items'][1]['depends_on'] == ['attempt']
    assert result['items'][2]['min_gap_days'] == 1
    assert draft['items'][0]['title'] == '听力练习和复盘'


def test_invalid_review_cannot_replace_valid_draft_or_retry_without_bound(monkeypatch):
    draft = {'items': [task('attempt', '完成诊断卷A长对话')], 'notice': ''}
    calls = []

    class Model:
        def invoke(self, messages):
            calls.append(messages)
            return AIMessage(content=json.dumps({'issues': ['需要调整'], 'revised': {
                'items': [task('attempt', '复盘', depends_on=['missing'])], 'notice': '',
            }}))

    monkeypatch.setattr(task_review, 'structured_model', lambda _: Model())
    result, audit = task_review.review_tasks(draft, {}, lambda model, messages, _: model.invoke(messages))
    assert result is draft and audit['status'] == 'unavailable'
    assert len(calls) == 1
