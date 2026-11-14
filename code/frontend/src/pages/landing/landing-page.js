// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let landingDistortionCleanup = null,
  landingDistortionPending = false,
  landingLeaveTimer = 0,
  landingMotionPaused = false;

function stopLandingDistortion() {
  if (landingDistortionCleanup) {
    landingDistortionCleanup();
    landingDistortionCleanup = null;
  }
  document.getElementById('landing-page').classList.remove('distortion-ready');
}

function startLandingDistortion() {
  if (landingDistortionCleanup || landingDistortionPending || landingMotionPaused) return;
  landingDistortionPending = true;
  requestAnimationFrame(() => {
    landingDistortionPending = false;
    let landing = document.getElementById('landing-page');
    if (activeAccount || landing.hidden || landingMotionPaused || document.hidden) return;
    let source = document.querySelector('.landing-art');
    if (!source) return;
    try {
      landingDistortionCleanup =
        window.mountStudyGridDistortion?.(
          document.getElementById('landing-distortion'),
          document.getElementById('landing-distortion-canvas'),
          {
            imageSrc: source.getAttribute('src'),
            rotation: 90,
            imagePosition: [0.5, 0.5],
            grid: 84,
            radius: 0.077,
            rippleScale: 0.7,
            strength: 0.24,
            relaxation: 0.95,
            mode: 'push',
            softness: 1,
            chroma: 0,
            idle: 0,
            clickRipple: true,
            intro: false,
            onReady: () => {
              if (!activeAccount && !landingMotionPaused) landing.classList.add('distortion-ready');
            },
            onError: () => landing.classList.remove('distortion-ready'),
          },
        ) || null;
    } catch {
      stopLandingDistortion();
    }
  });
}

function showLandingPage() {
  clearTimeout(landingLeaveTimer);
  let root = document.getElementById('landing-page');
  root.hidden = false;
  root.classList.remove('is-leaving');
  document.body.classList.add('auth-landing');
  let fab = document.getElementById('task-fab');
  if (fab) fab.hidden = true;
  startLandingDistortion();
}

function leaveLandingPage() {
  let root = document.getElementById('landing-page');
  if (root.hidden || root.classList.contains('is-leaving')) return;
  document.body.classList.remove('auth-landing');
  root.classList.add('is-leaving');
  let app = document.querySelector('.app');
  app?.classList.add('board-enter');
  clearTimeout(landingLeaveTimer);
  landingLeaveTimer = setTimeout(
    () => {
      root.hidden = true;
      root.classList.remove('auth-opening');
      stopLandingDistortion();
      app?.classList.remove('board-enter');
    },
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 900,
  );
}

function toggleLandingMotion() {
  landingMotionPaused = !landingMotionPaused;
  let root = document.getElementById('landing-page'),
    button = document.getElementById('landing-motion');
  root.classList.toggle('motion-paused', landingMotionPaused);
  button.textContent = landingMotionPaused ? '▷' : 'Ⅱ';
  button.setAttribute('aria-pressed', String(landingMotionPaused));
  button.setAttribute('aria-label', landingMotionPaused ? '继续背景动效' : '暂停背景动效');
  if (landingMotionPaused) stopLandingDistortion();
  else startLandingDistortion();
}

function openLandingLogin() {
  document.getElementById('landing-page').classList.add('auth-opening');
  document.getElementById('landing-login-orb').setAttribute('aria-expanded', 'true');
  login();
}

const closeBeforeLanding = closeModal;

closeModal = function () {
  closeBeforeLanding();
  document.getElementById('landing-page').classList.remove('auth-opening');
  document.getElementById('landing-page').inert = false;
  document.getElementById('landing-login-orb').setAttribute('aria-expanded', 'false');
  if (!activeAccount) document.getElementById('landing-login-orb').focus({ preventScroll: true });
};

login = function (mode = 'login') {
  modal(
    `<p class="auth-kicker">YOUR SPACE TO GROW</p><div class="modal-head"><h2>${mode === 'register' ? '从这里，开始成长。' : '欢迎回来。'}</h2><button onclick="closeModal()" aria-label="关闭登录面板">✕</button></div><div class="tabs"><button class="${mode === 'login' ? 'active' : ''}" onclick="login('login')">登录</button><button class="${mode === 'register' ? 'active' : ''}" onclick="login('register')">注册</button></div><form onsubmit="authenticate(event,'${mode}')">${mode === 'register' ? '<div class="form-group auth-floating-field"><label for="auth-name">怎么称呼你</label><input id="auth-name" maxlength="24" autocomplete="nickname" placeholder=" " required></div>' : ''}<div class="form-group auth-floating-field"><label for="auth-email">邮箱</label><input id="auth-email" type="email" maxlength="254" autocomplete="username" required placeholder=" "></div><div class="form-group auth-floating-field"><label for="auth-password">${mode === 'register' ? '设置测试密码' : '测试密码'}</label><input id="auth-password" type="password" minlength="8" maxlength="128" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" placeholder=" " required></div>${mode === 'register' ? '<div class="form-group auth-floating-field"><label for="auth-confirm">确认测试密码</label><input id="auth-confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder=" " required></div>' : ''}<p id="auth-error" class="auth-error" role="alert"></p><button id="auth-submit" class="auth-submit">${mode === 'register' ? '创建账号，开启计划' : '进入工作台'}</button></form>`,
  );
  let dialog = document.querySelector('#modal-root .modal');
  document.getElementById('landing-page').inert = true;
  dialog.classList.add('landing-auth-dialog');
  dialog.setAttribute('aria-label', mode === 'register' ? '注册账号' : '登录账号');
  document.getElementById(mode === 'register' ? 'auth-name' : 'auth-email').focus();
};

const renderBeforeLanding = render;

render = function () {
  if (!activeAccount) {
    showLandingPage();
    return;
  }
  leaveLandingPage();
  renderBeforeLanding();
};

const logoutBeforeLanding = logout;

logout = function () {
  cancelShredAnimation();
  cleanTaskDrag();
  closeModal();
  logoutBeforeLanding();
};

window.addEventListener('pagehide', stopLandingDistortion);
