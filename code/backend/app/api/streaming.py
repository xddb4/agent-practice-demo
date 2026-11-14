"""Background generation survives closing a window or disconnecting an SSE reader."""
import asyncio
import json
import logging
import queue
import threading
import time
import uuid
from contextvars import copy_context
from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError

from ..core.db import Session, Record
from ..services.agent_errors import diagnose
from ..services.stream_events import StreamStopped, stream_scope

active_streams = {}
registry_lock = threading.Lock()
log = logging.getLogger('studypilot')
worker_instance = uuid.uuid4().hex


def public_job(data):
    job=dict(data)
    instance=job.pop('worker_instance',None)
    if job.get('status')=='running' and instance!=worker_instance:
        job.update(status='interrupted',error={
            'code':'worker_restarted','title':'生成任务已中断',
            'reason':'网页后端服务已重启，这次尚未完成的模型调用无法继续。',
            'action':'原消息已保留，请核对历史对话后重新发送。'})
    return job


def job_key(owner, request_id):
    return 'agent-job:' + owner + ':' + str(request_id)


def cancel_stream(owner, request_id):
    with registry_lock:
        event = active_streams.get((owner, str(request_id)))
        if event:
            event.set()


def stream_response(request, owner, request_id, operation, metadata=None):
    stopped = threading.Event()
    finished = threading.Event()
    events = queue.Queue(maxsize=64)
    context = copy_context()
    key = (owner, str(request_id))
    record_key = job_key(owner, request_id)
    data = {
        **(metadata or {}), 'request_id': str(request_id), 'status': 'running',
        'worker_instance':worker_instance,
        'reply': '', 'created_at': datetime.now(timezone.utc).isoformat(),
    }
    with Session() as db:
        db.add(Record(id=record_key, owner=owner, kind='agent-job', data=data))
        try:
            db.commit()
        except IntegrityError:
            raise HTTPException(409, '这次生成请求已经存在，请查看原对话') from None
    with registry_lock:
        active_streams[key] = stopped
    last_saved = 0.0

    def store(force=False):
        nonlocal last_saved
        now = time.monotonic()
        if not force and now - last_saved < .4:
            return
        with Session() as db:
            row = db.get(Record, record_key)
            if row:
                row.data = {**data, 'updated_at': datetime.now(timezone.utc).isoformat()}
                db.commit()
        last_saved = now

    def publish(event):
        # Slow/absent readers must never block a background model call.
        if events.full():
            try:
                events.get_nowait()
            except queue.Empty:
                pass
        events.put_nowait(event)

    def emit(event):
        if stopped.is_set():
            raise StreamStopped()
        if event['type'] == 'reply':
            data['reply'] = event['text']
        elif event['type'] == 'status':
            data['message'] = event['message']
        store()
        publish(event)

    def fail(detail):
        data.update(status='failed', error=detail)
        store(True)
        publish({'type': 'error', 'detail': detail})

    def work():
        try:
            with stream_scope(emit, stopped):
                result = operation()
            # The operation's transaction decides whether cancellation or commit won.
            data.update(status='completed', plan_id=result.get('id'))
            store(True)
            publish({'type': 'complete', 'result': result})
        except StreamStopped:
            data.update(status='cancelled')
            store(True)
            publish({'type': 'cancelled'})
        except HTTPException as error:
            detail = error.detail if isinstance(error.detail, dict) else {
                'code': 'request_rejected', 'title': '本次请求未完成', 'reason': str(error.detail),
                'action': '请核对提示；必要时重新打开对话后再发送。',
            }
            fail(detail)
        except Exception as error:
            error_id = uuid.uuid4().hex[:12]
            detail = diagnose(error, error_id, operation='dialogue')
            log.warning('stream_failed request_id=%s code=%s error_type=%s', error_id, detail['code'], type(error).__name__)
            fail(detail)
        finally:
            finished.set()
            with registry_lock:
                active_streams.pop(key, None)

    threading.Thread(target=lambda: context.run(work), daemon=True).start()

    async def generate():
        yield ': connected\n\n'
        while True:
            if await request.is_disconnected():
                return
            try:
                event = await asyncio.to_thread(events.get, True, .5)
            except queue.Empty:
                if finished.is_set():
                    return
                yield ': heartbeat\n\n'
                continue
            yield 'data: ' + json.dumps(event, ensure_ascii=True) + '\n\n'
            if event.get('type') in ('complete', 'error', 'cancelled'):
                return

    return StreamingResponse(generate(), media_type='text/event-stream', headers={
        'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
    })
