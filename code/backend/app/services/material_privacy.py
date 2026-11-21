"""Remove incidental contact details while retaining strict checks for other data."""
from dataclasses import dataclass

from .ai_safety import (
    CARD, EMAIL, IDENTITY, PHONE, PRIVATE_INTENT, SECRET,
    SafetyRefusal, guard_text, normalized,
)
from .material_findings import material_findings


@dataclass(frozen=True)
class PreparedMaterial:
    text: str
    emails: int = 0
    phones: int = 0
    findings: tuple = ()

    def privacy_notice(self):
        changed = bool(self.emails or self.phones)
        message = ''
        if changed:
            message = '已隐藏附件中的邮箱或手机号，分析仅使用脱敏正文；原文件仍保存在你的附件区。'
        return {'redacted': changed, 'emails_removed': self.emails,
                'phones_removed': self.phones, 'message': message,
                'findings': list(self.findings[:20]), 'finding_count': len(self.findings)}


def prepare_material_text(text, *, source='body'):
    """Sanitize extracted material, never requests to obtain private information."""
    candidate = normalized(text)
    findings = material_findings(text, source)
    if any(pattern.search(candidate) for pattern in (IDENTITY, CARD, SECRET, PRIVATE_INTENT)):
        error = SafetyRefusal('privacy')
        labels = list(dict.fromkeys(item['label'] for item in findings if item['blocked']))
        error.detail.update(
            title='附件包含需要修改的信息',
            reply='检测到' + '、'.join(labels or ['敏感信息']) + '，本次附件未提交给模型。',
            action='请在原文件中删除或遮盖对应信息，重新导出后上传。原始敏感内容不会显示在提示中。',
            findings=sorted(findings, key=lambda item: not item['blocked'])[:20],
            finding_count=len(findings),
        )
        raise error
    # Preserve academic punctuation and symbols for ordinary material. Only use
    # normalized text when an obfuscated contact remains after direct masking.
    prepared, emails = EMAIL.subn('[邮箱已隐藏]', str(text))
    prepared, phones = PHONE.subn('[手机号已隐藏]', prepared)
    remaining = normalized(prepared)
    if EMAIL.search(remaining) or PHONE.search(remaining):
        prepared, extra_emails = EMAIL.subn('[邮箱已隐藏]', remaining)
        prepared, extra_phones = PHONE.subn('[手机号已隐藏]', prepared)
        emails += extra_emails
        phones += extra_phones
    guard_text(prepared, strict=False)
    return PreparedMaterial(prepared, emails, phones, tuple(findings))
