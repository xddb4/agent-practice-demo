"""Expose only the intended top-level reply while retaining full JSON validation."""
import json

from langchain_core.utils.json import parse_partial_json

from ..services.stream_events import emit_event, ensure_stream_active, streaming_enabled


def invoke_with_reply_stream(model, messages, field):
    if not streaming_enabled():return model.invoke(messages)
    emit_event({'type':'status','message':'正在整理你的情况…'})
    full=None
    previous=''
    chunks=model.stream(messages)
    try:
        for chunk in chunks:
            ensure_stream_active()
            full=chunk if full is None else full+chunk
            content=full.content
            if not isinstance(content,str) or not content.lstrip().startswith('{'):continue
            try:partial=parse_partial_json(content)
            except (ValueError,TypeError):continue
            text=partial.get(field) if isinstance(partial,dict) else None
            if isinstance(text,str) and text!=previous:
                # JSON dumps in the transport escapes newlines and surrogate boundaries.
                previous=text
                emit_event({'type':'reply','text':text})
        if full is None:raise ValueError('Empty model stream')
        ensure_stream_active()
        emit_event({'type':'status','message':'正在核对回复与任务安排…'})
        return full
    finally:
        if hasattr(chunks,'close'):chunks.close()
