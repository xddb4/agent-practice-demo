// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
const DAILY_MOTTOS = [
  '把今天的一小步，走成明天的底气。',
  '让专注有方向，让成长有回响。',
  '留一点空白，给思考和新的可能。',
  '从一个清晰的问题开始。',
  '按自己的节奏，把重要的事做好。',
];

function currentMotto() {
  return (
    activeAccount?.motto || DAILY_MOTTOS[Math.floor(Date.now() / 86400000) % DAILY_MOTTOS.length]
  );
}

function dailyAdvice() {
  let due = dayTasks().filter((t) => !t.done && t.ddl === date);
  return due.length
    ? '所选日期有 ' + due.length + ' 项任务截止，先核对安排，再留出专注时段。'
    : '所选日期没有待完成的到期任务，可以为长期目标留出一段时间。';
}

function syncProfile() {
  document.getElementById('username').textContent = activeAccount
    ? activeAccount.name
    : '登录 / 注册';
  document.getElementById('profile-avatar').textContent = activeAccount
    ? Array.from(activeAccount.name)[0]
    : '访';
}

function openPersonal() {
  if (!activeAccount) return login();
  page = 'personal';
  render();
}

const originalRender = render;

render = function () {
  syncProfile();
  if (page === 'personal') {
    document.querySelectorAll('[data-page]').forEach((b) => b.classList.remove('active'));
    return personal();
  }
  if (page === 'report' && !activeAccount) {
    page = 'plan';
    originalRender();
    return login();
  }
  originalRender();
};

function personal() {
  document.getElementById('content').innerHTML =
    head(
      '我的个人空间',
      '让计划、证据与个人偏好，在这里汇合。',
      '<button class="secondary" onclick="logout()">退出登录</button>',
    ) +
    `<div class="rec-layout"><section class="panel rec-form"><div class="panel-title">个人资料</div><p class="subtitle">${esc(activeAccount.email)}</p><form onsubmit="saveProfile(event)"><div class="form-group"><label for="p-name">昵称</label><input id="p-name" maxlength="24" required value="${esc(activeAccount.name)}"></div><div class="form-group"><label for="p-motto">个人格言</label><textarea id="p-motto" maxlength="100" placeholder="写下想对自己说的话；留空则展示每日寄语">${esc(activeAccount.motto || '')}</textarea></div><button class="primary">保存个人设置</button></form></section><section class="panel rec-form"><div class="panel-title">能力与成长</div><p class="subtitle">查看六维能力画像，管理和确认成长证据。</p><div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><div class="stat-top">我的任务</div><div class="stat-num">${tasks.length}</div></div><div class="stat"><div class="stat-top">已接受证据</div><div class="stat-num">${evidence.filter((e) => e.status === '已接受').length}</div></div></div><button class="primary" onclick="page='report';render()">查看能力报告 →</button><div class="notice">本地演示账号：未验证邮箱，数据仅保存在此浏览器；不支持跨设备同步或真实多人服务。请勿使用常用密码或存放敏感资料。</div></section></div>`;
}

function persistAccount() {
  try {
    let accounts = readJSON(LOCAL_PREFIX + 'accounts', []);
    let i = accounts.findIndex((a) => a.id === activeAccount.id);
    if (i < 0) throw Error('账号不存在');
    accounts[i] = activeAccount;
    localStorage.setItem(LOCAL_PREFIX + 'accounts', JSON.stringify(accounts));
    localAccounts = accounts;
    return true;
  } catch {
    toast('个人设置保存失败，请检查浏览器存储');
    return false;
  }
}

function saveProfile(e) {
  e.preventDefault();
  let name = val('p-name').trim();
  if (!name) return toast('请填写昵称');
  activeAccount = { ...activeAccount, name, motto: val('p-motto').trim() };
  if (persistAccount()) {
    render();
    toast('个人设置已保存，首页格言已更新');
  }
}

function login(mode = 'login') {
  modal(
    `<div class="modal-head"><h2>${mode === 'register' ? '创建本地演示账号' : '登录本地演示账号'}</h2><button onclick="closeModal()" aria-label="关闭">✕</button></div><div class="notice">仅用于本机交互体验，不发送验证邮件。账号和数据保存在此浏览器，请使用演示邮箱和独立测试密码。真实邮箱注册需要认证后端、邮件服务和数据库。</div><div class="tabs"><button class="${mode === 'login' ? 'active' : ''}" onclick="login('login')">登录</button><button class="${mode === 'register' ? 'active' : ''}" onclick="login('register')">注册</button></div><form onsubmit="authenticate(event,'${mode}')">${mode === 'register' ? '<div class="form-group"><label for="auth-name">昵称</label><input id="auth-name" maxlength="24" autocomplete="nickname" required></div>' : ''}<div class="form-group"><label for="auth-email">邮箱</label><input id="auth-email" type="email" maxlength="254" autocomplete="username" required placeholder="demo@example.com"></div><div class="form-group"><label for="auth-password">测试密码（至少 8 位）</label><input id="auth-password" type="password" minlength="8" maxlength="128" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" required></div>${mode === 'register' ? '<div class="form-group"><label for="auth-confirm">确认测试密码</label><input id="auth-confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div>' : ''}<p id="auth-error" role="alert" style="color:#b45d48"></p><button id="auth-submit" class="primary" style="width:100%">${mode === 'register' ? '注册并进入个人空间' : '登录'}</button></form><p class="tiny">新注册账号为空白空间；访客示例不会自动导入。清除浏览器数据将丢失本机账号。此版本无密码找回服务。</p>`,
  );
}

async function passwordHash(password, salt) {
  const bytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytes, iterations: 210000, hash: 'SHA-256' },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function authenticate(e, mode) {
  e.preventDefault();
  if (authRequestPending) return;
  authRequestPending = true;
  const button = document.getElementById('auth-submit'),
    error = document.getElementById('auth-error');
  button.disabled = true;
  error.textContent = '';
  try {
    if (!crypto?.subtle)
      throw Error('当前浏览器不支持本地密码校验，请使用现代浏览器或 localhost 打开。');
    const email = val('auth-email').trim().toLowerCase(),
      password = val('auth-password');
    if (!email || password.length < 8) throw Error('请填写有效邮箱和至少 8 位测试密码');
    localAccounts = readJSON(LOCAL_PREFIX + 'accounts', []);
    let account = localAccounts.find((a) => a.email === email);
    if (mode === 'register') {
      if (account) throw Error('该邮箱已在此浏览器注册，请登录');
      if (password !== val('auth-confirm')) throw Error('两次密码不一致');
      let name = val('auth-name').trim();
      if (!name) throw Error('请填写昵称');
      let salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      account = {
        id: crypto.randomUUID(),
        email,
        name,
        motto: '',
        salt,
        hash: await passwordHash(password, salt),
      };
      localAccounts = readJSON(LOCAL_PREFIX + 'accounts', []);
      if (localAccounts.some((a) => a.email === email)) throw Error('该邮箱已注册，请登录');
      localAccounts.push(account);
      localStorage.setItem(LOCAL_PREFIX + 'accounts', JSON.stringify(localAccounts));
    } else {
      if (!account || (await passwordHash(password, account.salt)) !== account.hash)
        throw Error('邮箱或测试密码不正确');
    }
    if (!button.isConnected) return;
    save();
    sessionStorage.setItem(LOCAL_PREFIX + 'session', account.id);
    activeAccount = account;
    loadAccount();
    page = 'plan';
    await enterAuthenticatedBoard();
    toast(mode === 'register' ? '本地账号已创建' : '已登录本地账号');
  } catch (err) {
    if (error.isConnected) error.textContent = err.message || '操作失败，请检查浏览器存储';
  } finally {
    authRequestPending = false;
    if (button.isConnected) button.disabled = false;
  }
}

function loadAccount() {
  tasks = readJSON(dataKey('tasks'), activeAccount ? [] : structuredClone(seed));
  evidence = readJSON(dataKey('evidence'), []);
  confirmed = activeAccount ? [0, 0, 0, 0, 0, 0] : [4, 6, 3, 2, 5, 4];
  recSteps = [];
  recTarget = '';
  parsed = [];
  date = today;
  timelineCenter = today;
  timelineMode = 'week';
  demoPreview = false;
}

function logout() {
  save();
  try {
    sessionStorage.removeItem(LOCAL_PREFIX + 'session');
  } catch {}
  activeAccount = null;
  loadAccount();
  page = 'plan';
  render();
  toast('已退出，回到访客示例');
}

function showHelp() {
  modal(
    '<div class="modal-head"><h2>产品介绍</h2><button aria-label="关闭产品介绍" onclick="closeModal()">✕</button></div><p>StudyPilot 是你的学习与时间管理助手，帮助你明确目标、安排任务，并在实践中持续调整。</p><p><strong>安排日常</strong><br>管理任务与日程，通过日历和四象限理清时间与优先级。</p><p><strong>一起制定计划</strong><br>和 AI 聊聊目标、困难与可用时间，获取分析和近期任务建议，确认后加入日程；也可以继续对话，调整安排。</p><p><strong>看见自己的成长</strong><br>记录学习成果与成长证据，在个人空间查看能力报告，为后续学习提供参考。</p><button class="primary" onclick="closeModal()">知道了</button>',
  );
}
