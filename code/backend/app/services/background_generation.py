"""后台生成服务：取消注册、非阻塞事件通道及进度持久化各自独立。"""

import logging
import queue
import threading
import time
import uuid
from contextvars import copy_context
from datetime import datetime, timezone

from fastapi import HTTPException

from .agent_errors import diagnose
from .stream_events import StreamStopped, stream_scope


log = logging.getLogger('studypilot')


def public_job(data, worker_instance):
    job = dict(data)
    instance = job.pop('worker_instance', None)
    if job.get('status') == 'running' and instance != worker_instance:
        job.update(status='interrupted', error={
            'code': 'worker_restarted', 'title': '生成任务已中断',
            'reason': '网页后端服务已重启，这次尚未完成的模型调用无法继续。',
            'action': '原消息已保留，请核对历史对话后重新发送。',
        })
    return job


class StreamRegistry:
    def __init__(self):
        self._active = {}
        self._lock = threading.Lock()

    def register(self, key, stopped):
        with self._lock:
            self._active[key] = stopped

    def remove(self, key):
        with self._lock:
            self._active.pop(key, None)

    def cancel(self, key):
        with self._lock:
            event = self._active.get(key)
            if event:
                event.set()


class EventChannel:
    """Slow or absent readers must never block model generation."""

    def __init__(self, capacity=64):
        self.events = queue.Queue(maxsize=capacity)
        self._publish_lock = threading.Lock()

    def publish(self, event):
        with self._publish_lock:
            if self.events.full():
                try:
                    self.events.get_nowait()
                except queue.Empty:
                    pass
            self.events.put_nowait(event)

    def receive(self):
        return self.events.get(True, .5)


class JobProgress:
    SAVE_INTERVAL = .4

    def __init__(self, repository, data, clock=None):
        self.repository = repository
        self.data = data
        self._last_saved = 0.0
        self._clock = clock or time.monotonic

    def store(self, *, force=False):
        now = self._clock()
        if not force and now - self._last_saved < self.SAVE_INTERVAL:
            return
        self.repository.update(self.data)
        self._last_saved = now

    def observe(self, event):
        if event['type'] == 'reply':
            self.data['reply'] = event['text']
        elif event['type'] == 'status':
            self.data['message'] = event['message']
        self.store()


class BackgroundGeneration:
    def __init__(self, owner, request_id, operation, repository, registry, worker_instance, metadata=None):
        self.key = (owner, str(request_id))
        self.operation = operation
        self.registry = registry
        self.stopped = threading.Event()
        self.finished = threading.Event()
        self.channel = EventChannel()
        self.context = copy_context()
        data = {
            **(metadata or {}), 'request_id': str(request_id), 'status': 'running',
            'worker_instance': worker_instance, 'reply': '',
            'created_at': datetime.now(timezone.utc).isoformat(),
        }
        self.progress = JobProgress(repository, data)

    def start(self):
        self.progress.repository.create(self.progress.data)
        self.registry.register(self.key, self.stopped)
        threading.Thread(target=self.context.run, args=(self.run,), daemon=True).start()

    def emit(self, event):
        if self.stopped.is_set():
            raise StreamStopped()
        self.progress.observe(event)
        self.channel.publish(event)

    def transition(self, status, event, **fields):
        self.progress.data.update(status=status, **fields)
        self.progress.store(force=True)
        self.channel.publish(event)

    def fail(self, detail):
        self.transition('failed', {'type': 'error', 'detail': detail}, error=detail)

    def run(self):
        try:
            with stream_scope(self.emit, self.stopped):
                result = self.operation()
            # The operation's transaction decides whether cancellation or commit won.
            self.transition('completed', {'type': 'complete', 'result': result}, plan_id=result.get('id'))
        except StreamStopped:
            self.transition('cancelled', {'type': 'cancelled'})
        except HTTPException as error:
            self.fail(request_error(error))
        except Exception as error:
            error_id = uuid.uuid4().hex[:12]
            detail = diagnose(error, error_id, operation='dialogue')
            log.warning('stream_failed request_id=%s code=%s error_type=%s', error_id, detail['code'], type(error).__name__)
            self.fail(detail)
        finally:
            self.finished.set()
            self.registry.remove(self.key)


def request_error(error):
    if isinstance(error.detail, dict):
        return error.detail
    return {
        'code': 'request_rejected', 'title': '本次请求未完成', 'reason': str(error.detail),
        'action': '请核对提示；必要时重新打开对话后再发送。',
    }
