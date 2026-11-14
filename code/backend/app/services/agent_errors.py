"""仅呈现经过分类的错误，不返回服务商原始响应、输入或认证信息。"""
import httpx
from openai import APITimeoutError, APIConnectionError
from ..integrations.model import ModelCapabilityError

class AgentOutputError(ValueError):
    def __init__(self,issues,repair_attempted=False):
        super().__init__('Agent output validation failed')
        self.issues=issues
        self.repair_attempted=repair_attempted
class AgentOutputTooLongError(ValueError):pass

def diagnose(error,request_id,operation='schedule'):
    status=getattr(error,'status_code',None)
    code,title,reason,action,retryable='internal','识别未完成','暂时无法确定失败原因。','请重试；若持续失败，请凭错误编号排查。',True
    if isinstance(error,ModelCapabilityError):
        code,title,reason,action,retryable='capability','模型配置需要调整',str(error),'请检查所选模型及图片能力，或改用文字录入。',False
    elif isinstance(error,(APITimeoutError,httpx.TimeoutException,TimeoutError)):
        code,title,reason,action='timeout','识别等待超时','模型服务未在限定时间内返回结果。','请重试，或将通知拆成较短的内容后识别。'
    elif isinstance(error,APIConnectionError):
        code,title,reason,action='connection','无法连接模型服务','后端未能与模型服务建立连接。','请检查网络与代理设置后重试。'
    elif isinstance(error,AgentOutputError):
        code,title,reason,action='invalid_output','模型结果校验失败','模型已返回结果，但结果不符合应用要求。','请重试；若持续失败，请凭错误编号反馈。'
        if error.repair_attempted:
            reason+='自动修复 1 次后仍未通过。'
    elif isinstance(error,AgentOutputTooLongError):
        code,title,reason,action='output_limit','识别内容过长','模型输出达到长度上限，结果不完整。','请将材料按日程分段后分别识别。'
    elif status==401:
        code,title,reason,action,retryable='authentication','模型密钥验证失败','模型服务拒绝了当前API密钥。','请在个人空间的模型 API 设置中更新密钥。',False
    elif status==402:
        code,title,reason,action,retryable='balance','模型账户额度不足','模型服务返回账户额度不足。','请检查模型账户余额或更换可用账户后重试。',False
    elif status==403:
        code,title,reason,action,retryable='permission','模型访问受限','模型服务拒绝当前账户访问。','请检查模型权限及服务可用范围。',False
    elif status==429:
        code,title,reason,action='rate_limit','模型服务繁忙','请求受到模型服务限流。','请稍后重试，避免连续提交。'
    elif status==404:
        code,title,reason,action,retryable='model_not_found','模型地址或名称不可用','模型服务未找到请求的接口或模型。','请检查模型名称与接口地址。',False
    elif status in (400,422):
        code,title,reason,action,retryable='model_request','模型未接受此次请求','模型服务拒绝了请求的参数或输入格式。','请检查模型能力；图片可改用PNG/JPEG，文字可分段重试。',False
    elif status and status>=500:
        code,title,reason,action='upstream','模型服务暂时异常','模型服务返回服务器错误。','请稍后重试。'
    if operation=='dialogue':
        overrides={
            'invalid_output':('方案调整结果校验失败',reason,'点击重试，系统会重新生成调整建议；仍失败时可撤回编辑，先调整少量任务。'),
            'timeout':('对话回复超时',reason,'点击重试；若持续超时，请检查模型服务及网络，或暂时关闭模型深度思考。'),
            'output_limit':('对话回复不完整',reason,'请让 Agent 分批调整任务后重试。'),
            'internal':('对话处理异常',reason,'请凭错误编号反馈，便于查询服务端日志。'),
        }
        if code in overrides:title,reason,action=overrides[code]
    result={'code':code,'title':title,'reason':reason,'action':action,'retryable':retryable,'request_id':request_id,'message':title,'operation':operation}
    if isinstance(error,AgentOutputError):
        names={'start':'开始时间','end':'结束时间','deadline':'截止时间','title':'任务名称','date':'计划日期','estimated_minutes':'预计时长','dimension':'能力维度','notice':'结果说明','reply':'对话回复','changes':'调整列表','action':'调整类型','index':'原任务编号','fields':'修改字段','memory':'情况摘要'}
        problems=[]
        checks=[]
        for issue in error.issues[:6]:
            loc=issue.get('loc',[]);index=next((i for i in loc if isinstance(i,int)),None)
            field=names.get(str(loc[-1]),'内容') if loc else '内容'
            kind=issue.get('type','unknown')
            descriptions={'missing':'缺少必填内容','extra_forbidden':'包含不支持的字段','json_invalid':'不是完整有效的 JSON','literal_error':'不是允许的调整类型（新增、修改或取消）','too_long':'超过允许的数量或长度','int_type':'需要整数','int_parsing':'需要整数','greater_than':'必须大于允许的下限','date_parsing':'需要有效日期（年-月-日）','date_from_datetime_parsing':'需要有效日期（年-月-日）','string_pattern_mismatch':'需要有效时间（时:分）','value_error':'未满足任务调整的关联约束'}
            description=descriptions.get(kind)
            limit=issue.get('ctx',{}).get('max_length')
            if kind=='too_long' and type(limit) is int:
                description+=f'（上限 {limit}）'
            problems.append((f'第{index+1}项调整的' if operation=='dialogue' and index is not None else f'第{index+1}条的' if index is not None else '')+field+('：'+description if description else '格式或取值不符合要求'))
            # Only known field names and validation codes: never input, exception text or arbitrary keys.
            checks.append({'field':field,'item':index+1 if index is not None else None,'type':kind if kind in descriptions or kind in ('datetime_parsing','string_type','less_than_equal') else 'validation_error'})
        result['problems']=problems
        result['validation']=checks
    return result
