"""Request-scoped events shared by graph workers and the HTTP stream."""
from contextlib import contextmanager
from contextvars import ContextVar


class StreamStopped(BaseException):
    """Control flow, deliberately not a model/service failure."""


current_stream = ContextVar('studypilot_stream', default=None)


@contextmanager
def stream_scope(emit, stopped):
    token=current_stream.set((emit, stopped))
    try:yield
    finally:current_stream.reset(token)


def ensure_stream_active():
    state=current_stream.get()
    if state and state[1].is_set():raise StreamStopped()


def emit_event(event):
    ensure_stream_active()
    state=current_stream.get()
    if state:state[0](event)


def streaming_enabled():return current_stream.get() is not None
