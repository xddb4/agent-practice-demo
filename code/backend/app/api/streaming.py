"""SSE 传输适配层；连接关闭只结束读取，不取消后台生成。"""

import asyncio
import json
import queue
import uuid

from fastapi.responses import StreamingResponse

from ..repositories.agent_jobs import AgentJobRepository, job_key
from ..services.background_generation import BackgroundGeneration, StreamRegistry
from ..services.background_generation import public_job as job_view


worker_instance = uuid.uuid4().hex
registry = StreamRegistry()
TERMINAL_EVENTS = frozenset(('complete', 'error', 'cancelled'))


def public_job(data):
    return job_view(data, worker_instance)


def cancel_stream(owner, request_id):
    registry.cancel((owner, str(request_id)))


async def event_frames(request, job):
    yield ': connected\n\n'
    while not await request.is_disconnected():
        try:
            event = await asyncio.to_thread(job.channel.receive)
        except queue.Empty:
            if job.finished.is_set():
                return
            yield ': heartbeat\n\n'
            continue
        yield 'data: ' + json.dumps(event, ensure_ascii=True) + '\n\n'
        if event.get('type') in TERMINAL_EVENTS:
            return


def stream_response(request, owner, request_id, operation, metadata=None):
    job = BackgroundGeneration(
        owner, request_id, operation, AgentJobRepository(owner, request_id),
        registry, worker_instance, metadata,
    )
    job.start()
    return StreamingResponse(event_frames(request, job), media_type='text/event-stream', headers={
        'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no',
    })
