"""SSE transport around the existing authenticated, transactional operations."""
import asyncio
import json
import logging
import queue
import threading
import uuid
from contextvars import copy_context

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ..services.agent_errors import diagnose
from ..services.stream_events import StreamStopped, stream_scope

active_streams={}
registry_lock=threading.Lock()
log=logging.getLogger('studypilot')


def cancel_stream(owner, request_id):
    with registry_lock:
        event=active_streams.get((owner,str(request_id)))
        if event:event.set()


def stream_response(request, owner, request_id, operation):
    stopped=threading.Event()
    events=queue.Queue(maxsize=64)
    context=copy_context()
    key=(owner,str(request_id))
    end=object()

    def emit(event):
        while not stopped.is_set():
            try:events.put(event,timeout=.2);return
            except queue.Full:pass
        raise StreamStopped()

    def work():
        try:
            with stream_scope(emit,stopped):
                result=operation()
                emit({'type':'complete','result':result})
        except StreamStopped:
            try:events.put_nowait({'type':'cancelled'})
            except queue.Full:pass
        except HTTPException as error:
            detail=error.detail if isinstance(error.detail,dict) else {
                'code':'request_rejected','title':'本次请求未完成','reason':str(error.detail),
                'action':'请核对提示；必要时重新打开对话后再发送。'}
            try:emit({'type':'error','detail':detail})
            except StreamStopped:pass
        except Exception as error:
            error_id=uuid.uuid4().hex[:12]
            detail=diagnose(error,error_id,operation='dialogue')
            log.warning('stream_failed request_id=%s code=%s error_type=%s',error_id,detail['code'],type(error).__name__)
            try:emit({'type':'error','detail':detail})
            except StreamStopped:pass
        finally:
            while not stopped.is_set():
                try:events.put(end,timeout=.2);break
                except queue.Full:pass

    async def generate():
        with registry_lock:
            duplicate=key in active_streams
            if not duplicate:active_streams[key]=stopped
        if duplicate:
            yield 'data: '+json.dumps({'type':'error','detail':{'message':'这次请求正在处理，请勿重复发送'}})+'\n\n'
            return
        worker=threading.Thread(target=lambda:context.run(work),daemon=True)
        worker.start()
        try:
            yield ': connected\n\n'
            while True:
                if await request.is_disconnected():break
                try:event=await asyncio.to_thread(events.get,True,.5)
                except queue.Empty:
                    if stopped.is_set():break
                    yield ': heartbeat\n\n'
                    continue
                if event is end:break
                yield 'data: '+json.dumps(event,ensure_ascii=True)+'\n\n'
                if event.get('type') in ('complete','error','cancelled'):break
        finally:
            stopped.set()
            with registry_lock:active_streams.pop(key,None)

    return StreamingResponse(generate(),media_type='text/event-stream',headers={
        'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'})
