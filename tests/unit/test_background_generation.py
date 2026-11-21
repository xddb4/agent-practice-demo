from copy import deepcopy
import threading

from backend.app.services.background_generation import (
    BackgroundGeneration, EventChannel, JobProgress, StreamRegistry, public_job,
)
from backend.app.services.stream_events import ensure_stream_active


class MemoryJobs:
    def __init__(self):
        self.updates = []

    def update(self, data):
        self.updates.append(deepcopy(data))


def test_progress_throttles_intermediate_writes_and_forces_terminal_snapshot():
    repository, clock = MemoryJobs(), [10.0]
    progress = JobProgress(repository, {'status': 'running'}, clock=lambda: clock[0])
    progress.observe({'type': 'reply', 'text': '第一部分'})
    clock[0] += .1
    progress.observe({'type': 'reply', 'text': '完整内容'})
    assert len(repository.updates) == 1
    assert progress.data['reply'] == '完整内容'
    progress.data['status'] = 'completed'
    progress.store(force=True)
    assert len(repository.updates) == 2
    assert repository.updates[-1] == {'status': 'completed', 'reply': '完整内容'}


def test_full_channel_keeps_newest_progress_and_terminal_event_without_readers():
    channel = EventChannel(capacity=2)
    for index in range(1000):
        channel.publish({'type': 'reply', 'text': str(index)})
    channel.publish({'type': 'complete', 'result': {'id': 'plan'}})
    assert channel.receive() == {'type': 'reply', 'text': '999'}
    assert channel.receive()['type'] == 'complete'


def test_cancellation_is_owner_scoped_even_when_request_id_is_shared():
    registry = StreamRegistry()
    first, second = threading.Event(), threading.Event()
    registry.register(('first', 'request'), first)
    registry.register(('second', 'request'), second)
    registry.cancel(('first', 'request'))
    assert first.is_set() and not second.is_set()
    registry.remove(('first', 'request'))
    registry.cancel(('second', 'request'))
    assert second.is_set()


def test_cancellation_after_operation_commit_does_not_turn_success_into_failure():
    repository, registry = MemoryJobs(), StreamRegistry()

    def committed_operation():
        job.stopped.set()
        return {'id': 'saved-plan'}

    job = BackgroundGeneration('owner', 'request', committed_operation, repository, registry, 'worker')
    registry.register(job.key, job.stopped)
    job.run()
    assert job.finished.is_set()
    assert repository.updates[-1]['status'] == 'completed'
    assert job.channel.receive()['type'] == 'complete'


def test_cancel_before_commit_produces_cancelled_event_and_clears_registration():
    repository, registry = MemoryJobs(), StreamRegistry()
    job = BackgroundGeneration('owner', 'request', ensure_stream_active, repository, registry, 'worker')
    registry.register(job.key, job.stopped)
    registry.cancel(job.key)
    job.run()
    assert job.finished.is_set()
    assert repository.updates[-1]['status'] == 'cancelled'
    assert job.channel.receive()['type'] == 'cancelled'
    job.stopped.clear()
    registry.cancel(job.key)
    assert not job.stopped.is_set()


def test_restart_view_marks_only_unfinished_jobs_and_never_exposes_instance_id():
    stored = {'status': 'running', 'worker_instance': 'old-worker', 'reply': '已生成部分'}
    view = public_job(stored, 'new-worker')
    assert view['status'] == 'interrupted' and view['error']['code'] == 'worker_restarted'
    assert 'worker_instance' not in view
    assert stored['status'] == 'running'
    assert public_job({**stored, 'status': 'completed'}, 'new-worker')['status'] == 'completed'
