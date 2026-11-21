submitEvidence = async function (e) {
  e.preventDefault();
  try {
    const file = document.getElementById('e-file').files[0];
    const text = val('e-body');
    const materialIds = [];
    if (file) {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/files', { method: 'POST', body: form });
      const data = await r.json();
      if (!r.ok && data.detail?.code === 'safety_refusal') {
        showStudyAlert(attachmentPrivacyMessage(data.detail), '附件需要修改');
        return;
      }
      if (!r.ok)
        throw Error(apiErrorMessage(data.detail, '附件上传失败，请检查文件格式和大小后重试'));
      const privacyStatus = document.getElementById('e-privacy-status');
      if (privacyStatus) privacyStatus.textContent = data.privacy?.message || '';
      if (!(await reviewAttachmentPrivacy(data.privacy, data.name))) return;
      if (data.privacy?.redacted) toast(data.privacy.message);
      if (data.text?.trim()) materialIds.push(data.id);
    }
    askAgent(
      'evidence',
      val('e-title') + '\n来源：' + val('e-source') + '\n' + text,
      '',
      materialIds,
    );
  } catch (e) {
    toast(e.message);
  }
};
