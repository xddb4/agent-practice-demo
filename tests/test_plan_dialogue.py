import json
import uuid

from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.core.db import Record, Session


def account():
    client = TestClient(main.app)
    user = client.post('/api/auth/register', json={
        'email': f'{uuid.uuid4()}@example.com', 'password': 'test-only-password',
    }).json()
    return client, user['id']


def seed_plan(owner):
    plan_id = str(uuid.uuid4())
    with Session() as db:
        db.add(Record(id=plan_id, owner=owner, kind='run', data={
            'route': 'recommend',
            'input_source': json.dumps({'目标': '准备六级', '截止日期': '2090-01-31'}),
            'items': [
                {'title': '固定练习', 'date': '2090-01-05', 'estimated_minutes': 40},
                {'title': '待取消的任务', 'date': '2090-01-06', 'estimated_minutes': 20},
                {'title': '已完成的任务', 'date': '2090-01-07', 'estimated_minutes': 20},
            ],
        }))
        db.commit()
    return plan_id


def test_recommendation_can_start_a_chat(monkeypatch):
    client, _ = account()
    monkeypatch.setattr(main, 'runtime_settings', lambda _: {})
    monkeypatch.setattr(main.workflow, 'invoke', lambda _: {'route': 'recommend', 'result': {
        'items': [{'title': '听力诊断'}], 'dialogue_reply': '我们先做一次听力诊断。',
    }})
    goal = '我要准备六级'
    response = client.post('/api/agent', json={
        'route': 'recommend', 'text': json.dumps({'目标': goal, '每周小时': 6}),
        'dialogue_message': goal, 'skill_profile': 'english-prep',
    })
    assert response.status_code == 200
    chat = client.get(f"/api/plans/{response.json()['id']}/dialogue").json()
    assert [turn['text'] for turn in chat['messages'][:2]] == [goal, '我们先做一次听力诊断。']
    assert chat['skill_profile'] == 'english-prep'
    assert client.get('/api/state').json()['tasks'] == []


def test_existing_dialogue_passes_images_to_workflow(monkeypatch):
    client, owner = account()
    path = f'/api/plans/{seed_plan(owner)}/dialogue'
    monkeypatch.setattr(main, 'runtime_settings', lambda _: {})
    image = 'data:image/png;base64,aW1hZ2U='

    def invoke(state):
        assert state['attachment_images'] == [image]
        return {'result': {'reply': '已收到图片', 'changes': []}}

    monkeypatch.setattr(main.dialogue_workflow, 'invoke', invoke)
    assert client.post(path, json={'text': '看附件', 'attachment_images': ['data:image/png;base64,!!!']}).status_code == 422
    assert client.post(path, json={'text': '看附件', 'attachment_images': [image]}).status_code == 200
    assert image not in client.get(path).text


def test_cancel_during_model_call_prevents_saving_reply(monkeypatch):
    client, owner = account()
    plan_id = seed_plan(owner)
    path = f'/api/plans/{plan_id}/dialogue'
    request_id = str(uuid.uuid4())
    monkeypatch.setattr(main, 'runtime_settings', lambda _: {})

    def invoke(_):
        assert main.cancel_dialogue_request(uuid.UUID(request_id), owner)['ok']
        return {'result': {'reply': '晚到的回复', 'changes': []}}

    monkeypatch.setattr(main.dialogue_workflow, 'invoke', invoke)
    assert client.post(path, json={'text': '准备六级', 'request_id': request_id}).status_code == 409
    assert client.get(path).json()['messages'] == []


def test_adopted_task_uses_current_calendar_fields_and_preserves_legacy_identity(monkeypatch):
    client, owner = account()
    plan_id = seed_plan(owner)
    path = f'/api/plans/{plan_id}/dialogue'
    task = {'id': 7, 'title': '固定练习', 'date': '2090-01-11', 'duration': 45, 'agent_run_id': plan_id}
    assert client.put('/api/state', json={'tasks': [task], 'evidence': []}).status_code == 200
    plan = client.get(f'/api/plans/{plan_id}').json()
    assert plan['calendar_items']['0']['date'] == '2090-01-11'
    monkeypatch.setattr(main, 'runtime_settings', lambda _: {})

    def invoke(state):
        linked = state['context']['当前方案'][0]
        assert linked['已加入日程'] and linked['date'] == '2090-01-11'
        return {'result': {'reply': '推迟这项练习', 'changes': [
            {'action': 'modify', 'index': 0, 'fields': {'date': '2090-01-12'}},
        ]}}

    monkeypatch.setattr(main.dialogue_workflow, 'invoke', invoke)
    proposal = client.post(path, json={'text': '请推迟固定练习'}).json()['pending']
    assert proposal['preview'][0]['official']
    assert client.get('/api/state').json()['tasks'] == [task]
    assert client.post(path + '/decision', json={'proposal_id': proposal['id'], 'apply': True}).status_code == 200
    updated = client.get('/api/state').json()['tasks']
    assert len(updated) == 1 and updated[0]['id'] == 7 and updated[0]['proposal_index'] == 0
    assert updated[0]['date'] == '2090-01-12'


def test_dialogue_persists_and_changes_only_confirmed_plan_items(monkeypatch):
    client, owner = account()
    plan_id = seed_plan(owner)
    other_id = seed_plan(owner)
    path = f'/api/plans/{plan_id}/dialogue'
    tasks = [
        {'id': 1, 'title': '固定练习', 'date': '2090-01-05', 'start': '18:00', 'end': '18:40',
         'location': '图书馆', 'agent_run_id': plan_id, 'proposal_index': 0},
        {'id': 2, 'title': '已完成的任务', 'date': '2090-01-07', 'done': True,
         'agent_run_id': plan_id, 'proposal_index': 2},
    ]
    assert client.put('/api/state', json={'tasks': tasks, 'evidence': []}).status_code == 200
    monkeypatch.setattr(main, 'runtime_settings', lambda _: {})
    calls = []

    def invoke(state):
        calls.append(state)
        return {'result': {'reply': '调整建议', 'memory': '用户周三没空', 'changes': [
            {'action': 'modify', 'index': 0, 'fields': {'date': '2090-01-08'}},
            {'action': 'cancel', 'index': 1},
            {'action': 'add', 'fields': {'title': '听力复盘', 'date': '2090-01-09', 'estimated_minutes': 30}},
        ] if len(calls) == 1 else []}}

    monkeypatch.setattr(main.dialogue_workflow, 'invoke', invoke)
    response = client.post(path, json={'text': '周三没空，改一下'})
    assert response.status_code == 200, response.text
    pending = response.json()['pending']
    assert calls[0]['skills'] == ['task-breakdown', 'english-prep']
    assert client.get('/api/state').json()['tasks'] == tasks
    assert client.get(path).json()['pending'] == pending
    assert client.get(f'/api/plans/{other_id}/dialogue').json()['messages'] == []
    stranger, _ = account()
    assert stranger.get(path).status_code == 404
    assert client.post(path, json={'text': '再次生成'}).status_code == 409
    decision = {'proposal_id': pending['id'], 'apply': True}
    response = client.post(path + '/decision', json=decision)
    assert response.status_code == 200, response.text
    assert response.json()['tasks'] == [{**tasks[0], 'date': '2090-01-08',
                                        'suggested_sessions': [], 'suggest': '未设置'}, tasks[1]]
    assert client.post(path + '/decision', json=decision).status_code == 409
    plan = client.get(f'/api/plans/{plan_id}').json()
    assert plan['proposal_indices'] == [0, 2, 3]
    assert plan['adopted_indices'] == [0, 2]
    assert plan['items'][-1]['title'] == '听力复盘'
    assert client.post(path, json={'text': '刚才说了什么？'}).status_code == 200
    assert calls[-1]['context']['用户长期情况摘要'] == '用户周三没空'
    assert calls[-1]['context']['近期对话'][0]['text'] == '周三没空，改一下'


def test_dialogue_rechecks_conflicts_on_apply_and_can_discard(monkeypatch):
    client, owner = account()
    path = f'/api/plans/{seed_plan(owner)}/dialogue'
    monkeypatch.setattr(main, 'runtime_settings', lambda _: {})
    monkeypatch.setattr(main.dialogue_workflow, 'invoke', lambda _: {'result': {
        'reply': '建议改为固定时段',
        'changes': [{'action': 'modify', 'index': 0,
                     'fields': {'date': '2090-01-08', 'start': '19:00', 'end': '20:00'}}],
    }})
    proposal = client.post(path, json={'text': '安排固定时段'}).json()['pending']
    fixed = {'id': 3, 'title': '临时会议', 'date': '2090-01-08', 'start': '19:30', 'end': '20:30'}
    assert client.put('/api/state', json={'tasks': [fixed], 'evidence': []}).status_code == 200
    decision = {'proposal_id': proposal['id'], 'apply': True}
    assert client.post(path + '/decision', json=decision).status_code == 409
    assert client.get(path).json()['pending'] == proposal
    assert client.post(path + '/decision', json={**decision, 'apply': False}).status_code == 200
    assert client.get('/api/state').json()['tasks'] == [fixed]


def test_withdraw_discards_only_unconfirmed_round(monkeypatch):
    client, owner = account()
    path = f'/api/plans/{seed_plan(owner)}/dialogue'
    monkeypatch.setattr(main, 'runtime_settings', lambda _: {})
    monkeypatch.setattr(main.dialogue_workflow, 'invoke', lambda _: {'result': {
        'reply': '建议缩短练习',
        'memory': '本周时间较少',
        'changes': [{'action': 'modify', 'index': 0, 'fields': {'estimated_minutes': 25}}],
    }})
    first = client.post(path, json={'text': '这周时间不够'}).json()
    decision = {'proposal_id': first['pending']['id'], 'apply': True}
    response = client.post(path + '/withdraw', json={'token': first['withdraw_token']}).json()
    assert response['restored'] == '这周时间不够'
    assert response['messages'] == [] and response['pending'] is None
    assert client.post(path + '/decision', json=decision).status_code == 409
    second = client.post(path, json={'text': '这周时间不够'}).json()
    assert second['withdraw_token'] != first['withdraw_token']
    assert client.post(path + '/withdraw', json={'token': first['withdraw_token']}).status_code == 409
    decision['proposal_id'] = second['pending']['id']
    assert client.post(path + '/decision', json=decision).status_code == 200
    assert client.post(path + '/withdraw', json={'token': second['withdraw_token']}).status_code == 409
