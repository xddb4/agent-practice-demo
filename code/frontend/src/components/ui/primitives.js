// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// Inline SVG follows the project's existing icon style; geometry is centered in one square.
function uiSymbol(name) {
  const paths = {
    plus: 'M12 5v14M5 12h14',
    previous: 'm15.5 5-7 7 7 7',
    next: 'm8.5 5 7 7-7 7',
    left: 'M20 12H4m7-7-7 7 7 7',
    right: 'M4 12h16m-7-7 7 7-7 7',
    info: 'M12 11v6m0-10v.01',
  };
  return (
    '<svg class="ui-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' +
    paths[name] +
    '"/></svg>'
  );
}

function informationHTML(id, title, content) {
  return (
    '<button type="button" class="information-button" popovertarget="' +
    id +
    '" aria-label="' +
    esc(title) +
    '" aria-expanded="false" onclick="requestAnimationFrame(()=>positionInformation(this))">' +
    uiSymbol('info') +
    '</button><section class="information-panel" id="' +
    id +
    '" popover="auto" aria-labelledby="' +
    id +
    '-title" ontoggle="this.previousElementSibling.setAttribute(\'aria-expanded\',String(event.newState===\'open\'))"><h2 id="' +
    id +
    '-title">' +
    esc(title) +
    '</h2>' +
    content +
    '</section>'
  );
}

function positionInformation(button) {
  const panel = document.getElementById(button.getAttribute('popovertarget'));
  if (!panel?.matches(':popover-open')) return;
  const anchor = button.getBoundingClientRect();
  panel.style.left =
    Math.max(16, Math.min(anchor.left, innerWidth - panel.offsetWidth - 16)) + 'px';
  panel.style.top =
    Math.max(16, Math.min(anchor.bottom + 8, innerHeight - panel.offsetHeight - 16)) + 'px';
}

function shredDropHTML() {
  return '<div class="shred-drop" id="shred-drop" role="region" aria-label="拖到这里，松手删除任务"><svg class="shred-trash-icon" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 11h14l-1 13H8zM12 15v5m4-5v5"/><path class="shred-trash-lid" d="m5 8 15-4m-10 2-1-3 5-1 1 3"/></svg></div>';
}

function toast(s) {
  document.getElementById('toast-root').innerHTML = '<div class="toast">' + esc(s) + '</div>';
  setTimeout(() => (document.getElementById('toast-root').innerHTML = ''), 3000);
}

// Drafts live only in this document: refresh starts a fresh workspace, never a cross-account draft.
const modalDrafts = new Map();
let currentModalDraft = null;
function modalDraftKey(key) {
  return (
    (typeof activeAccount !== 'undefined' ? activeAccount?.id || 'guest' : 'guest') + ':' + key
  );
}
function modalHTMLKey(html) {
  let hash = 2166136261;
  for (let i = 0; i < html.length; i++) hash = Math.imul(hash ^ html.charCodeAt(i), 16777619);
  return 'html:' + (hash >>> 0).toString(16);
}
function rememberModal(reason = 'replace') {
  const entry = currentModalDraft;
  if (!entry || entry.discard) return;
  entry.onHide?.(reason);
  if (!entry.retainNode) {
    entry.forms = Array.from(entry.node.querySelectorAll('form')).map((form) => ({
      ...form.dataset,
    }));
    entry.heading = entry.node.querySelector('.modal-head h2')?.innerHTML;
    entry.fields = Array.from(entry.node.querySelectorAll('input,textarea,select')).map(
      (field, index) => ({
        key: field.id || field.name || field.getAttribute('aria-label') || 'field:' + index,
        value: field.value,
        checked: field.checked,
        file: field.type === 'file' ? field : null,
      }),
    );
    entry.scroll = Array.from(entry.node.querySelectorAll('*')).map((node) => ({
      top: node.scrollTop,
      left: node.scrollLeft,
      open: node.tagName === 'DETAILS' ? node.open : undefined,
    }));
  }
  modalDrafts.set(entry.key, entry);
  if (modalDrafts.size > 24) {
    const oldest = [...modalDrafts].find(([, draft]) => !draft.retainNode);
    if (oldest) modalDrafts.delete(oldest[0]);
  }
}
function discardModalDraft(key) {
  if (key) modalDrafts.delete(modalDraftKey(key));
  else if (currentModalDraft) {
    currentModalDraft.discard = true;
    modalDrafts.delete(currentModalDraft.key);
  }
}
function closeModal() {
  rememberModal('close');
  document.getElementById('modal-root').replaceChildren();
  currentModalDraft = null;
}
function mountModalDraft(entry) {
  rememberModal();
  const root = document.getElementById('modal-root');
  entry.node.classList.remove('is-surface-closing');
  root.replaceChildren(entry.node);
  currentModalDraft = entry;
  if (entry.retainNode) modalDrafts.set(entry.key, entry);
  entry.onShow?.();
  return entry.node;
}
function resumeModal(key) {
  const entry = modalDrafts.get(modalDraftKey(key));
  if (!entry || entry.discard) return false;
  if (entry.retainNode) {
    mountModalDraft(entry);
    return true;
  }
  modal(entry.html, { key: entry.localKey });
  return true;
}
function modal(html, options = {}) {
  rememberModal();
  const localKey = options.key || modalHTMLKey(html),
    key = modalDraftKey(localKey);
  const saved = options.fresh ? null : modalDrafts.get(key);
  // Mode switches may replace content without remounting the dialog or its animation.
  const existingDialog = options.reuseDialog;
  const backdrop = existingDialog?.parentElement || document.createElement('div');
  if (existingDialog) existingDialog.innerHTML = html;
  else {
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<section role="dialog" aria-modal="true" class="modal">' + html + '</section>';
    let outside = false;
    backdrop.addEventListener('pointerdown', (event) => {
      outside = event.target === backdrop;
    });
    backdrop.addEventListener('pointercancel', () => {
      outside = false;
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && (outside || event.detail === 0)) closeModal();
      outside = false;
    });
  }
  const entry = {
    html,
    localKey,
    key,
    node: backdrop,
    retainNode: options.retainNode,
    onHide: options.onHide,
    onShow: options.onShow,
  };
  if (saved && !options.retainNode) {
    backdrop
      .querySelectorAll('form')
      .forEach((form, index) => Object.assign(form.dataset, saved.forms?.[index] || {}));
    const heading = backdrop.querySelector('.modal-head h2');
    if (heading && saved.heading !== undefined) heading.innerHTML = saved.heading;
    backdrop.querySelectorAll('input,textarea,select').forEach((field, index) => {
      const fieldKey =
        field.id || field.name || field.getAttribute('aria-label') || 'field:' + index;
      const value = saved.fields?.find((item) => item.key === fieldKey);
      if (!value) return;
      if (value.file) field.replaceWith(value.file);
      else {
        field.value = value.value;
        field.checked = value.checked;
      }
    });
    backdrop.querySelectorAll('*').forEach((node, index) => {
      const value = saved.scroll?.[index];
      if (!value) return;
      node.scrollTop = value.top;
      node.scrollLeft = value.left;
      if (value.open !== undefined) node.open = value.open;
    });
  }
  currentModalDraft = null;
  let mounted;
  if (existingDialog) {
    currentModalDraft = entry;
    mounted = backdrop;
  } else mounted = mountModalDraft(entry);
  if (saved?.scroll)
    requestAnimationFrame(() => {
      if (!mounted.isConnected) return;
      mounted.querySelectorAll('*').forEach((node, index) => {
        const value = saved.scroll[index];
        if (value) {
          node.scrollTop = value.top;
          node.scrollLeft = value.left;
        }
      });
    });
  return mounted;
}

function head(title, sub, action = '') {
  return (
    '<div class="heading"><div><h1>' +
    title +
    '</h1><div class="subtitle">' +
    sub +
    '</div></div><div style="display:flex;gap:10px">' +
    action +
    '</div></div>'
  );
}

function pill(q) {
  return '<span class="pill p' + q + '">' + labels[q] + '</span>';
}

function qSelect(t) {
  return quadrantPicker(
    t.q,
    'changeQ(' + t.id + ',value)',
    '',
    '修改 ' + t.title + ' 的四象限分类',
  );
}

function quadrantPicker(q = 1, action = '', inputId = '', label = '四象限分类') {
  return (
    '<details class="quadrant-picker" ontoggle="positionQuadrantOptions(this)"><summary aria-label="' +
    esc(label) +
    '">' +
    pill(q) +
    '</summary><input type="hidden" ' +
    (inputId ? 'id="' + esc(inputId) + '" ' : '') +
    'value="' +
    q +
    '">' +
    '<div class="quadrant-options" popover="auto" ontoggle="if(event.newState===\'closed\')this.closest(\'details\').open=false" aria-label="选择四象限">' +
    labels
      .map(
        (text, value) =>
          '<button type="button" aria-label="' +
          esc(text) +
          '" onclick="pickQuadrant(this,' +
          value +
          ',(value)=>{' +
          action +
          '})">' +
          pill(value) +
          '</button>',
      )
      .join('') +
    '</div></details>'
  );
}

function positionQuadrantOptions(picker) {
  const menu = picker.querySelector('.quadrant-options');
  if (!menu.showPopover) return;
  if (!picker.open) {
    if (menu.matches(':popover-open')) menu.hidePopover();
    return;
  }
  menu.showPopover();
  const anchor = picker.querySelector('summary').getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(anchor.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top =
    (anchor.bottom + menu.offsetHeight + 8 < innerHeight
      ? anchor.bottom + 6
      : Math.max(8, anchor.top - menu.offsetHeight - 6)) + 'px';
}

function pickQuadrant(button, value, onChange) {
  const picker = button.closest('.quadrant-picker');
  picker.querySelector('input').value = String(value);
  picker.querySelector('summary').innerHTML = pill(value);
  picker.open = false;
  onChange(value);
}
