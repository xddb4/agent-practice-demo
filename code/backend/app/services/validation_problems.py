"""Present allowlisted validation metadata without echoing model or user input."""

FIELD_NAMES = {
    'start': '开始时间', 'end': '结束时间', 'deadline': '截止时间',
    'title': '任务名称', 'date': '计划日期', 'estimated_minutes': '预计时长',
    'dimension': '能力维度', 'notice': '结果说明', 'reply': '对话回复',
    'changes': '调整列表', 'action': '调整类型', 'index': '原任务编号',
    'fields': '修改字段', 'memory': '情况摘要',
}
DESCRIPTIONS = {
    'missing': '缺少必填内容', 'extra_forbidden': '包含不支持的字段',
    'json_invalid': '不是完整有效的 JSON',
    'literal_error': '不是允许的调整类型（新增、修改或取消）',
    'too_long': '超过允许的数量或长度',
    'int_type': '需要整数', 'int_parsing': '需要整数',
    'greater_than': '必须大于允许的下限',
    'date_parsing': '需要有效日期（年-月-日）',
    'date_from_datetime_parsing': '需要有效日期（年-月-日）',
    'string_pattern_mismatch': '需要有效时间（时:分）',
    'value_error': '未满足任务调整的关联约束',
}
SAFE_VALIDATION_TYPES = frozenset(DESCRIPTIONS) | {
    'datetime_parsing', 'string_type', 'less_than_equal',
}


def issue_description(issue):
    kind = issue.get('type', 'unknown')
    description = DESCRIPTIONS.get(kind)
    limit = issue.get('ctx', {}).get('max_length')
    if kind == 'too_long' and type(limit) is int:
        description += f'（上限 {limit}）'
    if description:
        return '：' + description
    return '格式或取值不符合要求'


class ValidationProblemPresenter:
    """Build user hints and machine checks from at most six issues."""

    def __init__(self, operation):
        self.operation = operation

    def prefix(self, index):
        if index is None:
            return ''
        if self.operation == 'dialogue':
            return f'第{index + 1}项调整的'
        return f'第{index + 1}条的'

    def render_issue(self, issue):
        location = issue.get('loc', [])
        index = next((part for part in location if isinstance(part, int)), None)
        field = '内容'
        if location:
            field = FIELD_NAMES.get(str(location[-1]), field)
        kind = issue.get('type', 'unknown')
        safe_kind = kind if kind in SAFE_VALIDATION_TYPES else 'validation_error'
        item = None
        if index is not None:
            item = index + 1
        problem = self.prefix(index) + field + issue_description(issue)
        return problem, {'field': field, 'item': item, 'type': safe_kind}

    def present(self, issues):
        problems, checks = [], []
        for issue in issues[:6]:
            problem, check = self.render_issue(issue)
            problems.append(problem)
            checks.append(check)
        return {'problems': problems, 'validation': checks}
