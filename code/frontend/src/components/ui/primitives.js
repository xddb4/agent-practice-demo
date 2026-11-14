// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
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
  const backdrop = document.createElement('div');
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
  const mounted = mountModalDraft(entry);
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
  return (
    '<select aria-label="修改 ' +
    esc(t.title) +
    ' 的四象限分类" onchange="changeQ(' +
    t.id +
    ',this.value)">' +
    labels
      .map(
        (l, i) =>
          '<option value="' + i + '" ' + (t.q === i ? 'selected' : '') + '>' + l + '</option>',
      )
      .join('') +
    '</select>'
  );
}
