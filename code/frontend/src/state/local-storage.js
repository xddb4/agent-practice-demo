// Local prototype only. This does not establish server-side identity or authorization.
const LOCAL_PREFIX = 'studypilot-local-v1:';
function readJSON(key, fallback) {
  try {
    let v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
let localAccounts = readJSON(LOCAL_PREFIX + 'accounts', []);
let activeAccount = null;
try {
  sessionStorage.removeItem(LOCAL_PREFIX + 'session');
} catch {}
function dataKey(kind) {
  return LOCAL_PREFIX + (activeAccount ? activeAccount.id : 'guest') + ':' + kind;
}
function localDefault(value) {
  return activeAccount ? [] : value;
}
