"""状态快照的兼容语义及失败原子性。"""

import uuid

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.repositories.state import StateRepository


def account():
    client = TestClient(app)
    response = client.post('/api/auth/register', json={
        'email': uuid.uuid4().hex + '@example.com',
        'password': 'snapshot-test-password',
    })
    assert response.status_code == 200
    return client


def test_omitted_trash_preserves_records_but_explicit_empty_list_clears_them():
    client = account()
    trash = [{'trashId': 'one', 'task': {'id': 1, 'title': '已删除练习', 'q': 1}}]
    saved = client.put('/api/state', json={
        'tasks': [], 'evidence': [], 'task_trash': trash,
    })
    assert saved.status_code == 200
    stored = saved.json()['task_trash']
    preserved = client.put('/api/state', json={'tasks': [], 'evidence': []})
    assert preserved.status_code == 200
    assert preserved.json()['task_trash'] == stored
    cleared = client.put('/api/state', json={
        'tasks': [], 'evidence': [], 'task_trash': [],
    })
    assert cleared.status_code == 200
    assert cleared.json()['task_trash'] == []


def test_invalid_trash_returns_validation_error_without_overwriting_state():
    client = account()
    client.put('/api/state', json={
        'tasks': [{'id': 1, 'title': '保留任务', 'q': 1}], 'evidence': [],
    })
    before = client.get('/api/state').json()
    response = client.put('/api/state', json={
        'tasks': [], 'evidence': [],
        'task_trash': [{'trashId': 'bad', 'task': 'invalid'}],
    })
    assert response.status_code == 422
    assert response.json()['detail'] == '回收站记录无效'
    assert client.get('/api/state').json() == before


def test_failed_state_write_rolls_back_completion_statistics(monkeypatch):
    client = account()
    client.put('/api/state', json={
        'tasks': [{'id': 1, 'title': '未完成任务', 'q': 1}], 'evidence': [],
    })
    before = client.get('/api/state').json()

    def fail_save(self, snapshot):
        raise HTTPException(409, '模拟状态写入失败')

    monkeypatch.setattr(StateRepository, 'save', fail_save)
    response = client.put('/api/state', json={
        'tasks': [{**before['tasks'][0], 'done': True}], 'evidence': [],
    })
    assert response.status_code == 409
    assert client.get('/api/state').json() == before
    assert client.get('/api/completion-stats').json()['completed_tasks'] == 0
