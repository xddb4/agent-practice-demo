/** Existing JSON API contract. Do not silently change error messages or HTTP methods here. */
async function api(path, body, method) {
  const r = await fetch('/api/' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(typeof data.detail === 'string' ? data.detail : '输入无效，请核对字段');
  return data;
}
