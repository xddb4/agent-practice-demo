import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


spec = importlib.util.spec_from_file_location(
    'validate_user_samples', Path(__file__).resolve().parents[2] / 'scripts/validate_user_samples.py')
samples = importlib.util.module_from_spec(spec)
spec.loader.exec_module(samples)


def test_five_pending_samples_cover_three_groups_and_two_goals():
    data = samples.load_cases()
    assert data['year'] == 2026 and data['status'] == 'pending_live'
    assert len(data['cases']) == 5
    assert {case['group'] for case in data['cases']} == {'中文通知', '中文课表', '默认目标推荐'}
    assert all(case['automatic'] and case['manual'] for case in data['cases'])
    assert data['defaults']['goal_deadline'] is None
    assert data['defaults']['weekly_hours'] is None


def test_prepare_never_invokes_model_even_if_environment_has_key(monkeypatch, tmp_path):
    from core_engine.ai.workflows import pilot
    def forbidden(_state):
        pytest.fail('Preparation must not invoke any model')
    monkeypatch.setattr(pilot, 'workflow', SimpleNamespace(invoke=forbidden))
    monkeypatch.setenv('MODEL_API_KEY', 'private-test-key')
    output = tmp_path / 'report.json'
    assert samples.main(['--output', str(output)]) == 0
    report = json.loads(output.read_text(encoding='utf-8'))
    assert report['mode'] == 'prepare_only'
    assert all(row['status'] == 'pending_live' for row in report['results'])
    assert 'private-test-key' not in output.read_text(encoding='utf-8')


@pytest.mark.parametrize(('value', 'expected'), [
    ('2026-11-25T14:00:00+08:00', True),
    ('2026-11-25T06:00:00+00:00', True),
    ('2026-11-25T14:00:00', False),
    (None, False),
])
def test_timestamp_checks_compare_instants_not_string_prefixes(value, expected):
    rule = {'kind': 'timestamp', 'field': 'start', 'value': '2026-11-25T14:00:00+08:00'}
    assert samples.check_rule(rule, [{'start': value}]) is expected


def test_deadline_day_is_checked_in_shanghai():
    rule = {'kind': 'date', 'field': 'deadline', 'value': '2026-11-24'}
    assert samples.check_rule(rule, [{'deadline': '2026-11-23T16:00:00+00:00'}])
    assert not samples.check_rule(rule, [{'deadline': '2026-11-24T20:00:00+00:00'}])


def test_unknown_weeks_reject_invented_ranges_and_empty_output():
    rule = {'kind': 'unknown_weeks'}
    assert samples.check_rule(rule, [{'from_week': None, 'to_week': None, 'pattern': None}])
    assert not samples.check_rule(rule, [{'from_week': 1, 'to_week': 16, 'pattern': 'all'}])
    assert not samples.check_rule(rule, [])


def test_live_without_config_is_blocked_instead_of_using_offline_success(monkeypatch):
    monkeypatch.delenv('MODEL_API_KEY', raising=False)
    data = samples.load_cases()
    result = samples.run_case(data['cases'][0], data['defaults'], live=True)
    assert result['status'] == 'blocked_model_config'


def test_automatic_success_still_requires_manual_review(monkeypatch):
    from core_engine.ai.workflows import pilot
    for key in ('MODEL_API_KEY', 'MODEL_NAME', 'MODEL_BASE_URL'):
        monkeypatch.setenv(key, 'test-placeholder')
    data = samples.load_cases()
    output = {'items': [
        {'title': '参加培训', 'start': '2026-11-25T14:00:00+08:00'},
        {'title': '填写报名表', 'deadline': '2026-11-24T12:00:00+08:00'},
    ], 'notice': '结束时间未提供'}
    monkeypatch.setattr(pilot, 'workflow', SimpleNamespace(invoke=lambda _: {'result': output}))
    result = samples.run_case(data['cases'][0], data['defaults'], live=True)
    assert result['status'] == 'generated_pending_manual'
    assert all(check['passed'] for check in result['automatic_checks'])
    assert all(check['status'] == 'pending' for check in result['manual_review'])


def test_provider_errors_do_not_expose_raw_error_strings(monkeypatch):
    from core_engine.ai.workflows import pilot
    for key in ('MODEL_API_KEY', 'MODEL_NAME', 'MODEL_BASE_URL'):
        monkeypatch.setenv(key, 'private-test-key')
    def fail(_state):
        raise ValueError('private-test-key private-provider-response')
    monkeypatch.setattr(pilot, 'workflow', SimpleNamespace(invoke=fail))
    data = samples.load_cases()
    result = samples.run_case(data['cases'][0], data['defaults'], live=True)
    assert result['status'] == 'execution_failed'
    assert result['error_type'] == 'ValueError'
    assert 'private-' not in json.dumps(result)
