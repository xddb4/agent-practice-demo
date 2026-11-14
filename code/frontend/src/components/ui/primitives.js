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

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

function modal(html) {
  document.getElementById('modal-root').innerHTML =
    '<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><section role="dialog" aria-modal="true" class="modal">' +
    html +
    '</section></div>';
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
