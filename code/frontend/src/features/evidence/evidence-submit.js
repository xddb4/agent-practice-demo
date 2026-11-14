submitEvidence = async function (e) {
  e.preventDefault();
  try {
    const file = document.getElementById('e-file').files[0];
    let text = val('e-body');
    if (file) {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch('/api/files', { method: 'POST', body: form });
      const data = await r.json();
      if (!r.ok) throw Error(data.detail);
      text += '\n附件：' + data.name + '\n来源路径：' + data.url + '\n' + data.text;
    }
    askAgent('evidence', val('e-title') + '\n来源：' + val('e-source') + '\n' + text);
  } catch (e) {
    toast(e.message);
  }
};
