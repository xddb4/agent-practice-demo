import pytest

from backend.app.services.ai_safety import SafetyRefusal, guard_text
from backend.app.services.material_privacy import prepare_material_text


@pytest.mark.parametrize('phone', ['13800138000', '１３８００１３８０００',
                                  '1-3-8-0-0-1-3-8-0-0-0', '一三八零零一三八零零零'])
def test_incidental_contacts_are_removed_before_analysis(phone):
    material = prepare_material_text('实验采用对照方法。邮箱：student@example.com；电话：' + phone)
    assert 'student@example.com' not in material.text
    assert '13800138000' not in material.text
    assert '[邮箱已隐藏]' in material.text and '[手机号已隐藏]' in material.text
    assert '实验采用对照方法' in material.text
    assert material.privacy_notice()['redacted']
    assert material.emails == material.phones == 1
    guard_text(material.text, strict=False)


@pytest.mark.parametrize('content', [
    '身份证号110101199001011234', '银行卡号6222021234567890123',
    '密码：abcd1234', '验证码：123456', '请提取手机号13800138000',
])
def test_sensitive_identifiers_and_contact_extraction_requests_still_refused(content):
    with pytest.raises(SafetyRefusal) as caught:
        prepare_material_text('邮箱：student@example.com；' + content)
    assert caught.value.detail['category'] == 'privacy'
    assert 'student@example.com' not in str(caught.value.detail)


def test_regular_academic_numbers_are_not_masked():
    content = '论文 arXiv:2501.07834，使用2026年数据，准确率为95.2%，Room A201。'
    material = prepare_material_text(content)
    assert material.text == content
    assert not material.privacy_notice()['redacted']


def test_request_guard_is_not_relaxed_for_raw_private_input():
    with pytest.raises(SafetyRefusal):
        guard_text('我的手机号是13800138000')


def test_pdf_rejection_reports_page_line_and_type_without_sensitive_values():
    raw = '第一页\f第二页说明\n身份证号110101199001011234'
    with pytest.raises(SafetyRefusal) as caught:
        prepare_material_text(raw, source='pdf')
    detail = caught.value.detail
    assert detail['findings'][0]['label'] == '身份证号'
    assert detail['findings'][0]['page'] == 2
    assert detail['findings'][0]['line'] == 2
    assert '110101199001011234' not in str(detail)


def test_redaction_reports_contact_location_without_original_value():
    material = prepare_material_text('论文标题\n作者：author@example.com', source='pdf')
    notice = material.privacy_notice()
    assert notice['findings'][0]['label'] == '邮箱'
    assert notice['findings'][0]['page'] == 1
    assert notice['findings'][0]['line'] == 2
    assert 'author@example.com' not in str(notice)


def test_blocking_findings_are_not_hidden_by_many_incidental_contacts():
    content = '\n'.join('author' + str(index) + '@example.com' for index in range(25))
    with pytest.raises(SafetyRefusal) as caught:
        prepare_material_text(content + '\f身份证号110101199001011234', source='pdf')
    detail = caught.value.detail
    assert detail['finding_count'] == 26
    assert len(detail['findings']) == 20
    assert detail['findings'][0]['label'] == '身份证号'
    assert detail['findings'][0]['page'] == 2
