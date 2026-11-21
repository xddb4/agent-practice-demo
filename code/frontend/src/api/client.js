/** Existing JSON API contract. Do not silently change error messages or HTTP methods here. */
function apiErrorMessage(detail, fallback = '输入无效，请核对字段') {
  if (typeof detail === 'string') return detail || fallback;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return fallback;
  const message = [detail.reply, detail.message, detail.reason, detail.title].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  if (!message) return fallback;
  const action = typeof detail.action === 'string' ? detail.action.trim() : '';
  return action && action !== message ? message + '\n' + action : message;
}

async function api(path, body, method) {
  const r = await fetch('/api/' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(apiErrorMessage(data.detail));
  return data;
}

function attachmentPrivacyMessage(detail) {
  const lines = [];
  if (detail.file_name) lines.push('附件：' + detail.file_name);
  if (detail.message || detail.reply) lines.push(detail.message || detail.reply);
  for (const item of (detail.findings || []).slice(0, 20)) {
    let location = item.source === 'filename' ? '文件名' : '提取正文';
    if (item.page) location += '第' + item.page + '页';
    if (item.line) location += '第' + item.line + '行';
    lines.push(location + '：' + item.label + '（内容已隐藏）');
  }
  if (detail.finding_count > 20) lines.push('仅列出前20处，请检查整个文件。');
  if (detail.action) lines.push(detail.action);
  lines.push(...(detail.limitations || []));
  lines.push('定位基于提取文字，行号可能与原文件版面不同；未检测到不代表不存在。');
  return lines.join('\n');
}

async function reviewAttachmentPrivacy(privacy, name) {
  // Successful server-side redaction is informational; only a genuine blocking
  // finding needs user correction. Generic limitations never block submission.
  if (!privacy?.findings?.some((item) => item.blocked)) return true;
  showStudyAlert(attachmentPrivacyMessage({ ...privacy, file_name: name }), '附件需要修改');
  return false;
}
