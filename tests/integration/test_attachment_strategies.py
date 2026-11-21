import uuid

import pymupdf
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
import backend.app.api.routes as routes
from backend.app.core.db import Record, Session
from backend.app.services.attachments import AttachmentService


def account():
    client = TestClient(app)
    assert client.post('/api/auth/register', json={
        'email': uuid.uuid4().hex + '@example.com',
        'password': 'attachment-test-password',
    }).status_code == 200
    return client


def test_pdf_strategy_extracts_text_and_download_keeps_owner_isolation(monkeypatch, tmp_path):
    monkeypatch.setattr(routes, 'root', tmp_path)
    client, other = account(), account()
    with pymupdf.open() as document:
        document.new_page().insert_text((40, 40), 'Study notes')
        data = document.tobytes()
    response = client.post('/api/files', files={'file': ('notes.pdf', data, 'application/pdf')})
    assert response.status_code == 200, response.text
    attachment = response.json()
    assert 'Study notes' in attachment['text']
    download = client.get(attachment['url'])
    assert download.status_code == 200 and download.content == data
    assert other.get(attachment['url']).status_code == 404


@pytest.mark.parametrize('name,data', [
    ('notes.txt', b'\xff\xfe'), ('notes.pdf', b'not-a-pdf'), ('notes.exe', b'unsupported'),
])
def test_invalid_attachment_does_not_write_file(monkeypatch, tmp_path, name, data):
    monkeypatch.setattr(routes, 'root', tmp_path)
    response = account().post('/api/files', files={'file': (name, data, 'application/octet-stream')})
    assert response.status_code == 422
    assert not list(tmp_path.glob('uploads/*'))


def test_image_strategy_keeps_raw_file_without_inventing_text(monkeypatch, tmp_path):
    monkeypatch.setattr(routes, 'root', tmp_path)
    client = account()
    data = b'raw-image-content'
    response = client.post('/api/files', files={'file': ('notes.png', data, 'image/png')})
    assert response.status_code == 200
    assert response.json()['text'] == ''
    assert client.get(response.json()['url']).content == data


def test_contact_details_are_removed_from_response_storage_and_model_materials(monkeypatch, tmp_path):
    monkeypatch.setattr(routes, 'root', tmp_path)
    client, other = account(), account()
    original = '实验比较了两种算法。联系作者：student@example.com；电话：13800138000。'
    response = client.post('/api/files', files={
        'file': ('student@example.com.txt', original.encode(), 'text/plain')})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['privacy']['redacted']
    assert payload['privacy']['emails_removed'] == 2
    assert payload['privacy']['phones_removed'] == 1
    assert 'student@example.com' not in response.text and '13800138000' not in response.text
    with Session() as db:
        row = db.get(Record, 'file:' + payload['id'])
        owner = row.owner
        assert 'student@example.com' not in str(row.data)
        assert '13800138000' not in str(row.data)
    materials = AttachmentService(tmp_path).read_plan_materials(owner, [payload['id']], [])
    assert '实验比较了两种算法' in materials[0]['text']
    assert 'student@example.com' not in str(materials) and '13800138000' not in str(materials)
    # The owner may still download the original; other accounts cannot.
    assert client.get(payload['url']).content == original.encode()
    assert other.get(payload['url']).status_code == 404


def test_pdf_with_author_email_is_accepted_after_redaction(monkeypatch, tmp_path):
    monkeypatch.setattr(routes, 'root', tmp_path)
    with pymupdf.open() as document:
        document.new_page().insert_text((40, 40), 'Research methods. Contact: author@example.com')
        raw = document.tobytes()
    response = account().post('/api/files', files={'file': ('paper.pdf', raw, 'application/pdf')})
    assert response.status_code == 200, response.text
    assert 'Research methods' in response.json()['text']
    assert 'author@example.com' not in response.text
    assert response.json()['privacy']['redacted']


def test_historical_attachment_is_sanitized_again_when_used(tmp_path):
    owner, key = uuid.uuid4().hex, uuid.uuid4().hex
    with Session() as db:
        db.add(Record(id='file:' + key, owner=owner, kind='file', data={
            'name': 'author@example.com.pdf', 'text': 'Study notes. author@example.com'}))
        db.commit()
    materials = AttachmentService(tmp_path).read_plan_materials(owner, [key], [])
    assert 'author@example.com' not in str(materials)
    assert 'Study notes' in materials[0]['text']
