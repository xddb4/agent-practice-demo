/** Read real SSE frames; only a complete event returns a saved result to the caller. */
async function waitForDialogueJob(requestId, signal, onEvent) {
  while (!signal?.aborted) {
    const job = await dialogueRequest('agent-jobs/' + requestId);
    if (job.reply) onEvent({ type: 'reply', text: job.reply });
    if (job.status === 'completed') return job.result;
    if (['failed', 'interrupted'].includes(job.status))
      throw Object.assign(new Error(job.error?.reason || '后台生成失败'), {
        diagnostic: job.error,
        code: job.error?.code,
      });
    if (job.status === 'cancelled')
      throw Object.assign(new Error('已停止生成'), { name: 'AbortError' });
    onEvent({ type: 'status', message: job.message || '正在后台生成…' });
    await new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('已停止读取'), { name: 'AbortError' }));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, 600);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw Object.assign(new Error('已停止读取'), { name: 'AbortError' });
}

async function dialogueStreamRequest(path, body, signal, onEvent) {
  let response;
  try {
    response = await fetch('/api/' + path + '/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (body.request_id) return waitForDialogueJob(body.request_id, signal, onEvent);
    throw Object.assign(new Error('无法连接 StudyPilot，请检查容器状态并重新打开对话核对结果。'), {
      code: 'backend_connection',
    });
  }
  if (!response.ok) {
    const result = await response.json(),
      detail = result.detail;
    throw Object.assign(
      new Error(
        typeof detail === 'string' ? detail : detail?.reason || detail?.message || '请求未完成',
      ),
      {
        code: detail?.code,
        requestId: detail?.request_id,
        diagnostic: typeof detail === 'object' ? detail : null,
      },
    );
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw Error('服务未返回流式回复，请刷新后重试。');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replaceAll('\r\n', '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.type === 'error') {
          const detail = event.detail;
          throw Object.assign(new Error(detail.reason || detail.message || '回复未完成'), {
            code: detail.code,
            requestId: detail.request_id,
            diagnostic: detail,
          });
        }
        if (event.type === 'cancelled')
          throw Object.assign(new Error('已停止生成'), { name: 'AbortError' });
        if (event.type === 'complete') return event.result;
        onEvent(event);
      }
      if (done)
        throw Object.assign(new Error('回复连接中断，请重新打开对话核对是否已保存，再重试。'), {
          code: 'stream_interrupted',
        });
    }
  } catch (error) {
    if (
      body.request_id &&
      error.name !== 'AbortError' &&
      (!error.code || error.code === 'stream_interrupted') &&
      !error.diagnostic
    )
      return waitForDialogueJob(body.request_id, signal, onEvent);
    if (error.name === 'AbortError' || error.code || error.diagnostic) throw error;
    throw Object.assign(new Error('回复连接中断，请重新打开对话核对保存状态后重试。'), {
      code: 'stream_interrupted',
    });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function dialogueRequest(path, body, signal) {
  let response;
  try {
    response = await fetch(
      '/api/' + path,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          },
    );
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw Object.assign(new Error('浏览器无法连接 StudyPilot 后端。'), {
      code: 'backend_connection',
      diagnostic: {
        title: '无法连接 StudyPilot',
        reason: '浏览器未收到后端响应，暂时无法确认这次请求的处理结果。',
        action: '请检查 Docker 容器是否运行；恢复连接后重新打开对话，核对结果后再重试。',
      },
    });
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(new Error('后端响应格式异常'), {
      code: 'backend_response',
      diagnostic: {
        title: '后端响应异常',
        reason: '后端未返回有效的接口结果（HTTP ' + response.status + '）。',
        action: '请检查容器运行状态和服务器日志，重新打开对话后核对结果。',
      },
    });
  }
  if (!response.ok) {
    const detail = result.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : [
            detail?.title || detail?.message,
            detail?.reason,
            ...(detail?.problems || []),
            detail?.action,
          ]
            .filter(Boolean)
            .join(' ');
    throw Object.assign(new Error(message || '暂时无法处理，请重试'), {
      code: detail?.code,
      requestId: detail?.request_id,
      diagnostic: typeof detail === 'object' && !Array.isArray(detail) ? detail : null,
    });
  }
  return result;
}
