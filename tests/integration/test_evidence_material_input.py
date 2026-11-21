import uuid

from fastapi.testclient import TestClient

from backend.app.main import app
import backend.app.api.routes as routes
from core_engine.ai.prompts.generation import message_content


def account():
    client = TestClient(app)
    assert client.post('/api/auth/register', json={
        'email': uuid.uuid4().hex + '@example.com', 'password': 'evidence-test-password',
    }).status_code == 200
    return client


def test_long_redacted_evidence_reaches_workflow_as_owned_material(monkeypatch, tmp_path):
    client, other = account(), account()
    monkeypatch.setattr(routes, 'root', tmp_path)
    monkeypatch.setattr(routes, 'runtime_settings', lambda _: {})
    raw = '研究方法与复现过程。author@example.com\n' + '实验记录。' * 7000
    uploaded = client.post('/api/files', files={'file': ('paper.txt', raw.encode(), 'text/plain')})
    assert uploaded.status_code == 200
    assert uploaded.json()['privacy']['redacted']
    payload = {'route': 'evidence', 'text': '已完成论文阅读和复现', 'material_ids': [uploaded.json()['id']]}
    def capture(state):
        assert len(state['materials'][0]['text']) == 30000
        assert 'author@example.com' not in str(state)
        assert '[邮箱已隐藏]' in state['materials'][0]['text']
        assert '用户上传的辅助资料摘录' in message_content(state)[1]['text']
        return {'route': 'evidence', 'result': {'items': [], 'notice': '等待核对'}}
    monkeypatch.setattr(routes.workflow, 'invoke', capture)
    assert other.post('/api/agent', json=payload).status_code == 404
    result = client.post('/api/agent', json=payload)
    assert result.status_code == 200, result.text


def test_length_error_reports_actual_field_without_privacy_accusation():
    response = account().post('/api/agent', json={'route': 'evidence', 'text': 'private-marker' + '文' * 30000})
    assert response.status_code == 422
    detail = response.json()['detail']
    assert '30000' in detail['problems'][0]
    assert '输入正文' in detail['problems'][0]
    assert '敏感' not in str(detail)
    assert 'private-marker' not in response.text
