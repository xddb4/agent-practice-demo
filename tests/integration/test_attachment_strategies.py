import uuid

import pymupdf
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
import backend.app.api.routes as routes


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
