"""Locate privacy rule matches without returning the matched values or context."""
from .ai_safety import CARD, EMAIL, IDENTITY, PHONE, PRIVATE_INTENT, SECRET, normalized


def secret_label(value):
    for prefix, label in (('密码', '密码'), ('验证码', '验证码'),
                          ('护照', '护照号'), ('身份证', '身份证号'),
                          ('银行卡', '银行卡号'), ('银行账号', '银行账号')):
        if value.startswith(prefix):
            return label
    return '敏感认证字段'


RULES = (
    (IDENTITY, '身份证号', True), (CARD, '银行卡号', True),
    (SECRET, None, True), (PRIVATE_INTENT, '提取个人联系方式的请求', True),
    (EMAIL, '邮箱', False), (PHONE, '手机号', False),
)


def material_findings(text, source='body'):
    findings = []
    for page, segment in enumerate(str(text).split('\f'), 1):
        candidate = normalized(segment)
        occupied = []
        for pattern, label, blocked in RULES:
            for match in pattern.finditer(candidate):
                start, end = match.span()
                if any(start < right and end > left for left, right in occupied):
                    continue
                occupied.append((start, end))
                findings.append({
                    'label': label or secret_label(match.group()),
                    'blocked': blocked, 'source': source,
                    'page': page if source == 'pdf' else None,
                    'line': None if source == 'filename' else candidate.count('\n', 0, start) + 1,
                    'preview': '[内容已隐藏]',
                })
    return findings
