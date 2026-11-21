"""模型调用计时、工具交互和结构化修复，各自限制调用次数。"""

import json
from time import perf_counter

from langchain_core.messages import HumanMessage, ToolMessage
from pydantic import ValidationError

from backend.app.services.ai_safety import guard_model_output
from backend.app.services.agent_errors import AgentOutputError, AgentOutputTooLongError


class InvocationRecorder:
    def __init__(self, state, stream_reply):
        self.streaming = state['route'] == 'recommend' and bool(state.get('dialogue_message'))
        self.stream_reply = stream_reply
        self.started = perf_counter()
        self.timings = []

    def invoke(self, llm, messages, stage):
        stamp = perf_counter()
        if self.streaming:
            reply = self.stream_reply(llm, messages, 'dialogue_reply')
        else:
            reply = llm.invoke(messages)
        guard_model_output(reply.content)
        self.timings.append({'stage': stage, 'seconds': round(perf_counter() - stamp, 3)})
        return reply

    def metrics(self, context):
        return {
            'total_seconds': round(perf_counter() - self.started, 3), 'stages': self.timings,
            'model_calls': sum(item['stage'].startswith('model_') for item in self.timings),
            'context_characters': len(json.dumps(context, ensure_ascii=False)),
        }


class ToolConversation:
    MAX_ROUNDS = 5

    def __init__(self, invoke, tools, trace):
        self.invoke = invoke
        self.tools = tools
        self.trace = trace
        self.lookup = {tool.name: tool for tool in tools}

    def generate(self, model, prompt):
        llm = model.bind_tools(self.tools)
        for _ in range(self.MAX_ROUNDS):
            reply = self.invoke(llm, prompt.messages, 'model_tools')
            prompt.messages.append(reply)
            if not reply.tool_calls:
                break
            self._execute_tools(reply.tool_calls, prompt.messages)
        else:
            prompt.messages.append(HumanMessage(content='工具轮次已达上限。利用已有结果直接输出最终JSON，明确尚未核实的事实，不再调用工具。'))
        try:
            return prompt.contract.model_validate_json(reply.content).model_dump(mode='json')
        except (ValidationError, TypeError):
            prompt.messages.append(HumanMessage(content='根据上面的实际工具结果，输出符合JSON Schema的最终JSON候选。不再调用工具。'))
            return None

    def _execute_tools(self, calls, messages):
        for call in calls:
            self.trace.append('工具: ' + call['name'])
            tool = self.lookup.get(call['name'])
            value = tool.invoke(call['args']) if tool else '未知工具'
            messages.append(ToolMessage(content=str(value), tool_call_id=call['id']))


class StructuredOutput:
    MAX_ATTEMPTS = 2

    def __init__(self, invoke, model_factory, trace):
        self.invoke = invoke
        self.model_factory = model_factory
        self.trace = trace

    def generate(self, prompt):
        for attempt in range(self.MAX_ATTEMPTS):
            reply = self.invoke(self.model_factory(prompt.vision), prompt.messages, 'model_output')
            if reply.response_metadata.get('finish_reason') == 'length':
                raise AgentOutputTooLongError()
            try:
                return prompt.contract.model_validate_json(reply.content).model_dump(mode='json')
            except ValidationError as error:
                self._repair(prompt.messages, reply, error, attempt)
        raise RuntimeError('Structured output attempts exhausted')

    def _repair(self, messages, reply, error, attempt):
        self.trace.append('Schema校验失败，重试1次')
        issues = [{'loc': list(item['loc']), 'type': item['type'], 'message': item['msg']} for item in error.errors()]
        if attempt:
            raise AgentOutputError(issues, repair_attempted=True) from None
        messages.extend([reply, HumanMessage(content='JSON字段校验失败，请根据Schema修复。错误位置：' + json.dumps(issues, ensure_ascii=False))])
