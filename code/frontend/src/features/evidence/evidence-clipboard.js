function evidenceClipboardFiles(event) {
  const files = Array.from(event.clipboardData?.files || []);
  if (files.length) return files;
  return Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function pasteEvidenceAttachment(event) {
  const input = document.querySelector('#modal-root #e-file');
  if (!input || event.defaultPrevented || document.querySelector('.study-alert[open]')) return;
  const files = evidenceClipboardFiles(event);
  if (!files.length) return;
  // Keep normal text paste in title/body fields, including rich clipboard data.
  if (
    event.clipboardData?.getData('text/plain') &&
    event.target?.closest('textarea,input:not([type="file"]),[contenteditable="true"]')
  )
    return;
  event.preventDefault();
  if (files.length !== 1) return showStudyAlert('每次只能粘贴一个作品附件，请分开选择。');
  let file = files[0];
  const imageExtensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if (!file.name && imageExtensions[file.type])
    file = new File([file], '粘贴的作品截图.' + imageExtensions[file.type], { type: file.type });
  if (!/\.(pdf|txt|md|png|jpe?g|webp)$/i.test(file.name))
    return showStudyAlert('支持粘贴 PDF、TXT、Markdown、PNG、JPEG、WebP 附件。');
  if (file.size > 10 * 1024 * 1024) return showStudyAlert('作品附件不得超过10MB。');
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const privacy = document.getElementById('e-privacy-status');
    if (privacy) privacy.textContent = '';
    const status = document.getElementById('e-paste-status');
    if (status) status.textContent = '已粘贴附件，尚未上传。提交时将检查附件内容。';
  } catch {
    showStudyAlert('浏览器未能接收剪贴板文件，请使用“选择文件”添加附件。');
  }
}

document.addEventListener('paste', pasteEvidenceAttachment);
