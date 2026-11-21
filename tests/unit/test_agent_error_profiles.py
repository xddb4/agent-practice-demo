import httpx
import pytest
from openai import APIConnectionError, APITimeoutError

from backend.app.integrations.model import ModelCapabilityError
from backend.app.services.agent_errors import (
    AgentOutputError, AgentOutputTooLongError, diagnose,
)


class UpstreamError(Exception):
    def __init__(self, status):
        super().__init__('private-provider-response')
        self.status_code = status


@pytest.mark.parametrize(('status', 'code', 'retryable'), [
    (None, 'internal', True), (0, 'internal', True), (418, 'internal', True),
    (401, 'authentication', False), (402, 'balance', False),
    (403, 'permission', False), (404, 'model_not_found', False),
    (400, 'model_request', False), (422, 'model_request', False),
    (429, 'rate_limit', True), (500, 'upstream', True), (503, 'upstream', True),
])
def test_status_profiles_keep_retry_and_safe_response(status, code, retryable):
    result = diagnose(UpstreamError(status), 'request-1')
    assert result['code'] == code
    assert result['retryable'] is retryable
    assert result['request_id'] == 'request-1'
    assert result['operation'] == 'schedule'
    assert result['message'] == result['title']
    assert 'private-provider-response' not in str(result)
    assert 'validation' not in result


@pytest.mark.parametrize(('error', 'code', 'retryable'), [
    (ModelCapabilityError('未设置视觉模型'), 'capability', False),
    (TimeoutError('private-timeout'), 'timeout', True),
    (httpx.ReadTimeout('private-timeout'), 'timeout', True),
    (APITimeoutError(request=httpx.Request('GET', 'https://example.test')), 'timeout', True),
    (APIConnectionError(request=httpx.Request('GET', 'https://example.test')), 'connection', True),
    (AgentOutputError([]), 'invalid_output', True),
    (AgentOutputTooLongError('private-output'), 'output_limit', True),
])
def test_typed_rules_take_priority_over_http_status(error, code, retryable):
    error.status_code = 401
    result = diagnose(error, 'request-2')
    assert result['code'] == code
    assert result['retryable'] is retryable
    assert 'private-' not in str(result)


@pytest.mark.parametrize(('error', 'title'), [
    (AgentOutputError([], repair_attempted=True), '方案调整结果校验失败'),
    (TimeoutError(), '对话回复超时'),
    (AgentOutputTooLongError(), '对话回复不完整'),
    (ValueError('private-error'), '对话处理异常'),
])
def test_dialogue_presentation_changes_messages_without_changing_classification(error, title):
    schedule = diagnose(error, 'request', 'schedule')
    dialogue = diagnose(error, 'request', 'dialogue')
    assert dialogue['title'] == dialogue['message'] == title
    assert dialogue['action'] != schedule['action']
    for key in ('code', 'reason', 'retryable', 'request_id'):
        assert dialogue[key] == schedule[key]


def test_repair_and_capability_messages_do_not_mutate_shared_profiles():
    assert '自动修复 1 次' in diagnose(AgentOutputError([], True), 'a')['reason']
    assert '自动修复' not in diagnose(AgentOutputError([]), 'b')['reason']
    assert diagnose(ModelCapabilityError('未设置视觉模型'), 'c')['reason'] == '未设置视觉模型'
    assert diagnose(ModelCapabilityError('未设置文本模型'), 'd')['reason'] == '未设置文本模型'


def test_validation_limits_allowlists_and_numbering():
    issues = [
        {'loc': ['changes', 0, 'fields', 'start'], 'type': 'string_pattern_mismatch'},
        {'loc': ['private-field'], 'type': 'private-type', 'input': 'private-input',
         'msg': 'private-message', 'ctx': {'error': ValueError('private-error')}},
        {'loc': [], 'type': 'too_long', 'ctx': {'max_length': 12}},
        {'loc': ['reply'], 'type': 'too_long', 'ctx': {'max_length': True}},
        {'loc': ['items', 2, 'end'], 'type': 'datetime_parsing'},
        {'loc': ['reply'], 'type': 'missing'},
        {'loc': ['notice'], 'type': 'missing'},
    ]
    result = diagnose(AgentOutputError(issues), 'request', 'dialogue')
    assert result['problems'] == [
        '第1项调整的开始时间：需要有效时间（时:分）',
        '内容格式或取值不符合要求', '内容：超过允许的数量或长度（上限 12）',
        '对话回复：超过允许的数量或长度', '第3项调整的结束时间格式或取值不符合要求',
        '对话回复：缺少必填内容',
    ]
    assert result['validation'][1] == {'field': '内容', 'item': None, 'type': 'validation_error'}
    assert result['validation'][4] == {'field': '结束时间', 'item': 3, 'type': 'datetime_parsing'}
    assert len(result['validation']) == 6
    assert 'private-' not in str(result)
