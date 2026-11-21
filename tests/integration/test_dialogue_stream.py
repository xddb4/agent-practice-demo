import json
import threading
import uuid
import socket
import time

import httpx
import uvicorn

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.api import routes
from backend.app.services.agent_errors import AgentOutputError
from backend.app.services.stream_events import emit_event,ensure_stream_active
from backend.app.core.db import Session,Record


def setup(monkeypatch):
    client=TestClient(app)
    owner=client.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-only-password'}).json()['id']
    plan=uuid.uuid4().hex
    with Session() as db:
        db.add(Record(id=plan,owner=owner,kind='run',data={'route':'recommend','input_source':'准备考试','items':[]}));db.commit()
    monkeypatch.setattr(routes,'runtime_settings',lambda _: {})
    return client,f'/api/plans/{plan}/dialogue'


def frames(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]


def test_stream_completes_only_after_validated_transaction(monkeypatch):
    client,path=setup(monkeypatch)
    def invoke(_):
        emit_event({'type':'reply','text':'先分析'})
        emit_event({'type':'reply','text':'先分析，再安排。'})
        return {'result':{'reply':'先分析，再安排。','changes':[]}}
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    response=client.post(path+'/stream',json={'text':'帮我分析'})
    assert response.headers['content-type'].startswith('text/event-stream')
    events=frames(response)
    assert [e['type'] for e in events]==['reply','reply','complete']
    assert events[-1]['result']['messages'][-1]['text']=='先分析，再安排。'
    assert client.get(path).json()['messages'][-1]['text']=='先分析，再安排。'
    assert TestClient(app).post(path+'/stream',json={'text':'test'}).status_code==401


def test_schema_failure_after_partial_reply_does_not_save_it(monkeypatch):
    client,path=setup(monkeypatch)
    def invoke(_):
        emit_event({'type':'reply','text':'这只是尚未完成的答复'})
        raise AgentOutputError([{'type':'missing','loc':['changes'],'input':'private-input'}],repair_attempted=True)
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    response=client.post(path+'/stream',json={'text':'调整任务'})
    events=frames(response)
    assert events[-1]['type']=='error' and events[-1]['detail']['code']=='invalid_output'
    assert all(e['type']!='complete' for e in events)
    assert client.get(path).json()['messages']==[]
    assert 'private-input' not in response.text


def test_stop_cancels_live_worker_and_prevents_commit(monkeypatch):
    client,path=setup(monkeypatch)
    started=threading.Event();finished=threading.Event();responses=[]
    def invoke(_):
        emit_event({'type':'reply','text':'正在回复'})
        started.set()
        try:
            for _ in range(400):
                ensure_stream_active()
                finished.wait(.01)
            raise AssertionError('cancel did not stop worker')
        finally:finished.set()
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    request_id=str(uuid.uuid4())
    thread=threading.Thread(target=lambda:responses.append(client.post(path+'/stream',json={'text':'调整','request_id':request_id})),daemon=True)
    thread.start()
    assert started.wait(3)
    cancellation=TestClient(app);cancellation.cookies.update(client.cookies)
    assert cancellation.post('/api/dialogue-requests/'+request_id+'/cancel').status_code==200
    assert finished.wait(3)
    thread.join(3)
    assert not thread.is_alive()
    assert client.get(path).json()['messages']==[]
    assert all(e['type']!='complete' for e in frames(responses[0]))


def test_initial_recommendation_uses_same_stream_protocol(monkeypatch):
    client,_=setup(monkeypatch)
    def invoke(_):
        emit_event({'type':'reply','text':'先确定近期方向。'})
        return {'route':'recommend','result':{'items':[{'title':'诊断练习'}],'dialogue_reply':'先确定近期方向。'}}
    monkeypatch.setattr(routes.workflow,'invoke',invoke)
    response=client.post('/api/agent/stream',json={'route':'recommend','text':'准备考试','dialogue_message':'准备考试'})
    events=frames(response)
    assert events[0]['type']=='reply'
    assert events[-1]['type']=='complete'
    assert events[-1]['result']['id']


def test_duplicate_stream_request_does_not_start_second_worker(monkeypatch):
    client,path=setup(monkeypatch)
    calls=[]
    def invoke(_):
        calls.append(True)
        return {'result':{'reply':'分析完成。','changes':[]}}
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    request_id=str(uuid.uuid4())
    body={'text':'帮我分析','request_id':request_id}
    first=client.post(path+'/stream',json=body)
    assert frames(first)[-1]['type']=='complete'
    second=client.post(path+'/stream',json=body)
    assert second.status_code==409
    assert calls==[True]
    assert client.get('/api/agent-jobs/'+request_id).json()['status']=='completed'


def test_http_client_receives_reply_while_generation_is_still_running(monkeypatch):
    client,path=setup(monkeypatch)
    release=threading.Event();model_finished=threading.Event()
    def invoke(_):
        emit_event({'type':'reply','text':'先看你的情况。'})
        assert release.wait(4)
        model_finished.set()
        return {'result':{'reply':'先看你的情况，再安排近期任务。','changes':[]}}
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
    port=listener.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,log_config=None,log_level='critical',access_log=False))
    thread=threading.Thread(target=lambda:server.run(sockets=[listener]),daemon=True)
    thread.start()
    try:
        deadline=time.monotonic()+4
        while not server.started and time.monotonic()<deadline:time.sleep(.01)
        assert server.started
        with httpx.Client(cookies={'session':client.cookies.get('session')},timeout=3,trust_env=False) as http:
            with http.stream('POST',f'http://127.0.0.1:{port}'+path+'/stream',json={'text':'帮我分析'}) as response:
                lines=response.iter_lines()
                first=next(line for line in lines if line.startswith('data: '))
                assert json.loads(first[6:])['text']=='先看你的情况。'
                assert not model_finished.is_set()
                assert client.get(path).json()['messages']==[]
                release.set()
                assert any('"type": "complete"' in line for line in lines)
    finally:
        release.set();server.should_exit=True;thread.join(4);listener.close()


def test_disconnect_keeps_job_running_and_result_is_recoverable(monkeypatch):
    client,path=setup(monkeypatch)
    release=threading.Event()
    def invoke(_):
        emit_event({'type':'reply','text':'正在后台继续分析。'})
        assert release.wait(5)
        return {'result':{'reply':'后台分析已完成。','changes':[]}}
    monkeypatch.setattr(routes.dialogue_workflow,'invoke',invoke)
    listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
    port=listener.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,log_config=None,log_level='critical',access_log=False))
    thread=threading.Thread(target=lambda:server.run(sockets=[listener]),daemon=True);thread.start()
    request_id=str(uuid.uuid4())
    try:
        deadline=time.monotonic()+4
        while not server.started and time.monotonic()<deadline:time.sleep(.01)
        assert server.started
        with httpx.Client(cookies={'session':client.cookies.get('session')},timeout=3,trust_env=False) as http:
            with http.stream('POST',f'http://127.0.0.1:{port}'+path+'/stream',json={'text':'请继续分析','request_id':request_id}) as response:
                first=next(line for line in response.iter_lines() if line.startswith('data: '))
                assert 'reply' in first
            # The browser connection has closed. The producer must still be alive.
            progress=client.get('/api/agent-jobs/'+request_id)
            assert progress.json()['status']=='running'
            assert progress.json()['reply']=='正在后台继续分析。'
            listed=client.get('/api/agent-jobs').json()
            assert any(job['request_id']==request_id and job['status']=='running' for job in listed)
            assert TestClient(app).get('/api/agent-jobs/'+request_id).status_code==401
            release.set()
            deadline=time.monotonic()+4
            while time.monotonic()<deadline:
                job=client.get('/api/agent-jobs/'+request_id).json()
                if job['status']!='running':break
                time.sleep(.02)
            assert job['status']=='completed'
            assert job['result']['messages'][-1]['text']=='后台分析已完成。'
            assert client.get(path).json()['messages'][-1]['text']=='后台分析已完成。'
    finally:
        release.set();server.should_exit=True;thread.join(4);listener.close()
