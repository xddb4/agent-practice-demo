authenticate = async function (e, mode) {
  e.preventDefault();
  const button = document.getElementById('auth-submit');
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (mode === 'register' && val('auth-password') !== val('auth-confirm'))
      throw Error('两次密码不一致');
    activeAccount = await api('auth/' + mode, {
      email: val('auth-email'),
      password: val('auth-password'),
      name: mode === 'register' ? val('auth-name') : '同学',
    });
    const state = await api('state');
    tasks = state.tasks;
    evidence = state.evidence;
    confirmed = [0, 0, 0, 0, 0, 0];
    demoPreview = false;
    page = 'plan';
    await enterAuthenticatedBoard();
    toast('已连接个人数据库');
  } catch (e) {
    document.getElementById('auth-error').textContent = e.message;
  } finally {
    button.disabled = false;
  }
};

logout = async function () {
  try {
    await saveQueue;
    await api('logout', {});
    if (typeof modalDrafts !== 'undefined') modalDrafts.clear();
    if (typeof dialogueWorkspaceState === 'function') dialogueWorkspaceState.accounts?.clear();
    activeAccount = null;
    tasks = [];
    evidence = [];
    page = 'plan';
    render();
  } catch (e) {
    toast(e.message);
  }
};

persistAccount = function () {
  api('profile', { name: activeAccount.name, motto: activeAccount.motto }, 'PATCH').catch((e) =>
    toast(e.message),
  );
  return true;
};

const basePersonal = personal;

personal = function () {
  basePersonal();
  const n = document.querySelector('#content .notice');
  if (n) n.textContent = '数据存储于本地后端数据库，仅当前登录用户可访问。';
};
