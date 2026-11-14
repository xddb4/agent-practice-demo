const detailWithoutInstructions = detail;

detail = function (id) {
  detailWithoutInstructions(id);
  const task = tasks.find((item) => item.id === id),
    footer = document.querySelector('#modal-root .modal-footer');
  if (task?.description && footer) {
    const section = document.createElement('section');
    section.className = 'preview-item';
    const label = document.createElement('b');
    label.textContent = '执行说明';
    const text = document.createElement('p');
    text.textContent = task.description;
    text.style.whiteSpace = 'pre-wrap';
    section.append(label, text);
    footer.before(section);
  }
};
