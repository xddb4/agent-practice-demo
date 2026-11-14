import threading

import pytest
from langchain_core.messages import AIMessageChunk

from backend.app.integrations.model_stream import invoke_with_reply_stream
from backend.app.services.stream_events import StreamStopped, stream_scope


def test_reply_arrives_before_model_finishes_without_json_or_reasoning():
    events=[]
    class Model:
        def stream(self,messages):
            yield AIMessageChunk(content='{"reply":"你',additional_kwargs={'reasoning_content':'private reasoning'})
            assert events[-1]=={'type':'reply','text':'你'}
            yield AIMessageChunk(content='好\\n先练习","changes":[')
            yield AIMessageChunk(content='],"memory":"private memory"}')
    with stream_scope(events.append,threading.Event()):
        result=invoke_with_reply_stream(Model(),[],'reply')
    assert 'changes' in result.content
    assert [e['text'] for e in events if e['type']=='reply']==['你','你好\n先练习']
    assert 'private' not in str(events)


def test_cancellation_closes_model_iterator():
    stopped=threading.Event();closed=[]
    class Model:
        def stream(self,messages):
            try:
                yield AIMessageChunk(content='{"reply":"正在回复')
                stopped.set()
                yield AIMessageChunk(content='"}')
            finally:closed.append(True)
    with stream_scope(lambda _:None,stopped),pytest.raises(StreamStopped):
        invoke_with_reply_stream(Model(),[],'reply')
    assert closed==[True]


def test_nested_reply_is_not_exposed_as_a_user_answer():
    events=[]
    class Model:
        def stream(self,messages):
            yield AIMessageChunk(content='{"tool":{"reply":"private"},"reply":"真正的回答"}')
    with stream_scope(events.append,threading.Event()):invoke_with_reply_stream(Model(),[],'reply')
    assert [e['text'] for e in events if e['type']=='reply']==['真正的回答']


def test_stream_context_survives_langgraph_execution(monkeypatch):
    from core_engine.ai.workflows import plan_dialogue
    events=[]
    class Model:
        def stream(self,messages):
            yield AIMessageChunk(content='{"reply":"先看')
            assert any(e.get('text')=='先看' for e in events)
            yield AIMessageChunk(content='情况","changes":[]}',response_metadata={'finish_reason':'stop'})
    monkeypatch.setattr(plan_dialogue,'structured_model',lambda _:Model())
    with stream_scope(events.append,threading.Event()):
        result=plan_dialogue.workflow.invoke({'context':{},'skills':[]})
    assert result['result']['reply']=='先看情况'
