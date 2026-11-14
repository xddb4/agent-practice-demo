// Keep closing transitions tied to the exact dialog, so a newly opened one is never removed.
(() => {
  const closeImmediately = closeModal;
  closeModal = function () {
    const backdrop = document.querySelector('#modal-root > .modal-backdrop');
    if (!backdrop || backdrop.querySelector('.landing-auth-dialog') || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      closeImmediately();
      return;
    }
    if (backdrop.classList.contains('is-surface-closing')) return;
    backdrop.classList.add('is-surface-closing');
    setTimeout(() => {
      if (document.querySelector('#modal-root > .modal-backdrop') === backdrop) closeImmediately();
    }, 280);
  };
})();
