"""Explain request validation without echoing input values or unknown keys."""
FIELD_NAMES = {
    'text': '输入正文', 'dialogue_message': '对话正文', 'material_ids': '附件列表',
    'attachment_images': '图片列表', 'request_id': '请求编号', 'skill_profile': '能力配置',
    'image': '图片', 'route': '任务类型', 'base_plan_id': '参考方案编号',
}


def input_problem(issue):
    field = next((part for part in issue.get('loc', ()) if part in FIELD_NAMES), None)
    name = FIELD_NAMES.get(field, '请求字段')
    kind = issue.get('type')
    limit = issue.get('ctx', {}).get('max_length')
    if kind in ('string_too_long', 'too_long') and type(limit) is int:
        unit = '项' if field in ('material_ids', 'attachment_images') else '字'
        return name + f'超过上限（最多 {limit} {unit}）。'
    if kind in ('string_too_short', 'missing'):
        return name + '不能为空或缺失。'
    if kind in ('uuid_parsing', 'uuid_type'):
        return name + '编号无效，请重新选择附件或方案。'
    return name + '格式无效，请核对填写内容。'


def invalid_agent_input(issues):
    problems = list(dict.fromkeys(input_problem(issue) for issue in issues[:6]))
    return {
        'code': 'invalid_ai_input', 'title': '输入格式需要调整',
        'reason': '请求未通过字段校验，尚未调用模型。',
        'problems': problems, 'action': '请按上述具体字段提示修改后重新提交。',
        'retryable': False,
    }
