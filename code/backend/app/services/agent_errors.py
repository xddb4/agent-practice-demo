"""仅呈现经过分类的错误，不返回服务商原始响应、输入或认证信息。"""
from dataclasses import dataclass, replace

import httpx
from openai import APITimeoutError, APIConnectionError

from ..integrations.model import ModelCapabilityError
from .validation_problems import ValidationProblemPresenter


class AgentOutputError(ValueError):
    def __init__(self, issues, repair_attempted=False):
        super().__init__('Agent output validation failed')
        self.issues = issues
        self.repair_attempted = repair_attempted


class AgentOutputTooLongError(ValueError):
    pass


@dataclass(frozen=True)
class ErrorProfile:
    code: str
    title: str
    reason: str
    action: str
    retryable: bool = True

    def payload(self, request_id, operation):
        title, action = self.title, self.action
        if operation == 'dialogue':
            title, action = DIALOGUE_MESSAGES.get(self.code, (title, action))
        return {
            'code': self.code, 'title': title, 'reason': self.reason,
            'action': action, 'retryable': self.retryable,
            'request_id': request_id, 'message': title, 'operation': operation,
        }


ERROR_PROFILES = {
    'internal': ErrorProfile('internal', '识别未完成', '暂时无法确定失败原因。', '请重试；若持续失败，请凭错误编号排查。'),
    'capability': ErrorProfile('capability', '模型配置需要调整', '', '请检查所选模型及图片能力，或改用文字录入。', False),
    'timeout': ErrorProfile('timeout', '识别等待超时', '模型服务未在限定时间内返回结果。', '请重试，或将通知拆成较短的内容后识别。'),
    'connection': ErrorProfile('connection', '无法连接模型服务', '后端未能与模型服务建立连接。', '请检查网络与代理设置后重试。'),
    'invalid_output': ErrorProfile('invalid_output', '模型结果校验失败', '模型已返回结果，但结果不符合应用要求。', '请重试；若持续失败，请凭错误编号反馈。'),
    'output_limit': ErrorProfile('output_limit', '识别内容过长', '模型输出达到长度上限，结果不完整。', '请将材料按日程分段后分别识别。'),
    'authentication': ErrorProfile('authentication', '模型密钥验证失败', '模型服务拒绝了当前API密钥。', '请在个人空间的模型 API 设置中更新密钥。', False),
    'balance': ErrorProfile('balance', '模型账户额度不足', '模型服务返回账户额度不足。', '请检查模型账户余额或更换可用账户后重试。', False),
    'permission': ErrorProfile('permission', '模型访问受限', '模型服务拒绝当前账户访问。', '请检查模型权限及服务可用范围。', False),
    'rate_limit': ErrorProfile('rate_limit', '模型服务繁忙', '请求受到模型服务限流。', '请稍后重试，避免连续提交。'),
    'model_not_found': ErrorProfile('model_not_found', '模型地址或名称不可用', '模型服务未找到请求的接口或模型。', '请检查模型名称与接口地址。', False),
    'model_request': ErrorProfile('model_request', '模型未接受此次请求', '模型服务拒绝了请求的参数或输入格式。', '请检查模型能力；图片可改用PNG/JPEG，文字可分段重试。', False),
    'upstream': ErrorProfile('upstream', '模型服务暂时异常', '模型服务返回服务器错误。', '请稍后重试。'),
}

DIALOGUE_MESSAGES = {
    'invalid_output': ('方案调整结果校验失败', '点击重试，系统会重新生成调整建议；仍失败时可撤回编辑，先调整少量任务。'),
    'timeout': ('对话回复超时', '点击重试；若持续超时，请检查模型服务及网络，或暂时关闭模型深度思考。'),
    'output_limit': ('对话回复不完整', '请让 Agent 分批调整任务后重试。'),
    'internal': ('对话处理异常', '请凭错误编号反馈，便于查询服务端日志。'),
}

# Timeout must precede APIConnectionError because the SDK timeout subclasses it.
EXCEPTION_CODES = (
    (ModelCapabilityError, 'capability'),
    ((APITimeoutError, httpx.TimeoutException, TimeoutError), 'timeout'),
    (APIConnectionError, 'connection'),
    (AgentOutputError, 'invalid_output'),
    (AgentOutputTooLongError, 'output_limit'),
)
STATUS_CODES = {
    401: 'authentication', 402: 'balance', 403: 'permission',
    429: 'rate_limit', 404: 'model_not_found', 400: 'model_request', 422: 'model_request',
}


def capability_profile(error):
    # ModelCapabilityError carries application-authored configuration guidance.
    return replace(ERROR_PROFILES['capability'], reason=str(error))


def output_profile(error):
    profile = ERROR_PROFILES['invalid_output']
    if error.repair_attempted:
        return replace(profile, reason=profile.reason + '自动修复 1 次后仍未通过。')
    return profile


PROFILE_STRATEGIES = {'capability': capability_profile, 'invalid_output': output_profile}


def classify_error(error):
    for error_types, code in EXCEPTION_CODES:
        if isinstance(error, error_types):
            return code
    status = getattr(error, 'status_code', None)
    if status in STATUS_CODES:
        return STATUS_CODES[status]
    if status and status >= 500:
        return 'upstream'
    return 'internal'


def diagnose(error, request_id, operation='schedule'):
    """Facade for error classification, safe messages and validation details."""
    code = classify_error(error)
    strategy = PROFILE_STRATEGIES.get(code)
    profile = strategy(error) if strategy else ERROR_PROFILES[code]
    result = profile.payload(request_id, operation)
    if isinstance(error, AgentOutputError):
        result.update(ValidationProblemPresenter(operation).present(error.issues))
    return result
