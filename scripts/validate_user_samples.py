"""Prepare user-supplied model checks; network calls require an explicit --live."""
import argparse
import base64
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
from time import perf_counter
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/model_validation_2026.json'
sys.path.insert(0, str(ROOT / 'code'))


def load_cases(path=FIXTURE):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    identifiers = [case['id'] for case in data['cases']]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError('Duplicate case identifiers')
    return data


def image_data(path):
    raw = Path(path).read_bytes()
    if len(raw) > 10 * 1024 * 1024:
        raise ValueError('Image exceeds 10MB')
    mime = None
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif raw.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif raw.startswith(b'RIFF') and raw[8:12] == b'WEBP':
        mime = 'image/webp'
    if mime is None:
        raise ValueError('Unsupported image format')
    return 'data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii')


def timestamp_matches(value, expected):
    try:
        return datetime.fromisoformat(str(value)) == datetime.fromisoformat(expected)
    except ValueError:
        return False


def check_rule(rule, items):
    kind = rule['kind']
    if kind == 'timestamp':
        return any(timestamp_matches(item.get(rule['field']), rule['value']) for item in items)
    if kind == 'date':
        # Compare the date in Shanghai, not the provider's arbitrary offset.
        for item in items:
            try:
                value = datetime.fromisoformat(str(item.get(rule['field'])))
                if value.tzinfo and value.astimezone(ZoneInfo('Asia/Shanghai')).date().isoformat() == rule['value']:
                    return True
            except ValueError:
                continue
        return False
    if kind == 'course':
        return any(rule['title'] in ''.join(str(item.get('title', '')).split())
                   and all(item.get(key) == rule[key] for key in ('day', 'start', 'end'))
                   for item in items)
    if kind == 'unknown_weeks':
        return bool(items) and all(item.get(key) is None for item in items
                                   for key in ('from_week', 'to_week', 'pattern'))
    if kind == 'actionable_items':
        return bool(items) and all(item.get('title') and item.get('completion_criteria')
                                   and type(item.get('estimated_minutes')) is int
                                   and item['estimated_minutes'] > 0 for item in items)
    raise ValueError('Unknown check kind')


def run_case(case, defaults, *, live=False, image=None):
    record = {
        'case_id': case['id'], 'group': case['group'], 'status': 'pending_live',
        'input_sha256': hashlib.sha256(case['text'].encode()).hexdigest(),
        'manual_review': [{'criterion': text, 'status': 'pending'} for text in case['manual']],
    }
    if not live:
        if case.get('image_required'):
            record['image_available'] = bool(image and Path(image).is_file())
        return record
    if not all(os.getenv(key) for key in ('MODEL_API_KEY', 'MODEL_NAME', 'MODEL_BASE_URL')):
        return {**record, 'status': 'blocked_model_config'}
    state = {
        'route': case['route'], 'text': case['text'],
        'context': defaults['context'], 'skill_profile': defaults['skill_profile'],
    }
    if case['route'] == 'recommend':
        state['dialogue_message'] = case['text']
    if case.get('image_required'):
        if not image or not Path(image).is_file():
            return {**record, 'status': 'blocked_missing_image'}
        if os.getenv('MODEL_SUPPORTS_VISION', '').lower() != 'true' or not os.getenv('VISION_MODEL'):
            return {**record, 'status': 'blocked_vision_config'}
        state['image'] = image_data(image)
        record['image_sha256'] = hashlib.sha256(Path(image).read_bytes()).hexdigest()
    from core_engine.ai.workflows.pilot import workflow
    from backend.app.schemas.agent import GeneratedRecommendation, output_contract
    from backend.app.services.ai_safety import guard_model_output
    started = perf_counter()
    try:
        output = workflow.invoke(state)['result']
        guard_model_output(output)
        contract = output_contract(case['route'], bool(state.get('image')))
        if case['route'] == 'recommend':
            contract = GeneratedRecommendation
        contract.model_validate_json(json.dumps({
            key: value for key, value in output.items() if key in contract.model_fields
        }))
        checks = [{**rule, 'passed': bool(check_rule(rule, output['items']))}
                  for rule in case['automatic']]
        record.update(
            status='generated_pending_manual', schema_passed=True,
            automatic_checks=checks, output=output,
        )
        if not all(check['passed'] for check in checks):
            record['status'] = 'automatic_checks_failed'
    except Exception as error:
        # Never print provider responses, secrets or arbitrary exception strings.
        record.update(status='execution_failed', error_type=type(error).__name__)
    record['seconds'] = round(perf_counter() - started, 3)
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Explicitly allow billed API calls')
    parser.add_argument('--case', action='append', dest='cases', help='Select a case ID; repeat to select more')
    parser.add_argument('--image', type=Path, help='Original Chinese timetable screenshot')
    parser.add_argument('--output', type=Path, default=ROOT / '.runtime/model-validation-2026.json')
    args = parser.parse_args(argv)
    fixture = load_cases()
    cases = fixture['cases']
    if args.cases:
        unknown = set(args.cases) - {case['id'] for case in cases}
        if unknown:
            parser.error('Unknown case ID')
        cases = [case for case in cases if case['id'] in args.cases]
    report = {
        'executed_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
        'mode': 'live' if args.live else 'prepare_only',
        'model': os.getenv('MODEL_NAME') if args.live else None,
        'vision_model': os.getenv('VISION_MODEL') if args.live else None,
        'defaults': fixture['defaults'],
        'note': '自动检查通过不等于完整验收；人工项仍需逐条核对。只生成候选，不写入用户日程。',
        'results': [],
    }
    for case in cases:
        result = run_case(case, fixture['defaults'], live=args.live, image=args.image)
        report['results'].append(result)
        print(json.dumps({'case': case['id'], 'status': result['status']}, ensure_ascii=False), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Report saved; raw results are local and require review before publication.')
    failures = ('execution_failed', 'automatic_checks_failed', 'blocked_model_config',
                'blocked_missing_image', 'blocked_vision_config')
    return int(any(result['status'] in failures for result in report['results']))


if __name__ == '__main__':
    raise SystemExit(main())
