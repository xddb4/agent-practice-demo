function askAgent(route, text, image = '') {
  if (!activeAccount) return login();
  parent.postMessage({ type: 'agent', payload: { route, text, image } }, location.origin);
}

parseText = function () {
  if (!val('raw').trim()) return toast('请先输入通知');
  askAgent('schedule', val('raw'));
};

generateRec = function (e) {
  e.preventDefault();
  askAgent(
    'recommend',
    JSON.stringify({
      目标: val('r-title'),
      截止日期: val('r-ddl'),
      每周小时: val('r-hours'),
      基础与约束: val('r-focus'),
    }),
  );
};

submitEvidence = async function (e) {
  e.preventDefault();
  const file = document.getElementById('e-file').files[0];
  if (file) return toast('附件正文分析尚未接入，请先粘贴作品正文；文件不会假装已保存');
  askAgent('evidence', val('e-title') + '\n来源：' + val('e-source') + '\n' + val('e-body'));
};

recognizeCourseDemo = function () {
  const input = document.querySelector('#modal-root input[type=file]'),
    file = input?.files[0];
  if (!file) return toast('请先上传PNG/JPEG课表图片');
  if (file.size > 10 * 1024 * 1024) return toast('图片不能超过10MB');
  const reader = new FileReader();
  reader.onload = () =>
    askAgent(
      'schedule',
      '识别此课表，保留星期、节次、教学周与重复规则；实际日期不明确时不得猜测。',
      reader.result,
    );
  reader.readAsDataURL(file);
};

function mapItem(x, i) {
  let start = x.start,
    end = x.end;
  let day = start?.slice(0, 10) || x.date || date;
  return {
    id: Date.now() + i,
    title: x.title,
    date: day,
    start: start?.includes('T') ? start.slice(11, 16) : start || '',
    end: end?.includes('T') ? end.slice(11, 16) : end || '',
    ddl: x.deadline?.slice(0, 10) || '',
    location: x.location || '',
    q: x.important ? (x.urgent ? 0 : 1) : x.urgent ? 2 : 3,
    duration: x.estimated_minutes || null,
    standard: x.completion_criteria || '',
    source: x.source || '',
    repeat: '不重复',
    done: false,
  };
}

window.addEventListener('message', (e) => {
  if (e.source !== parent || e.origin !== location.origin || e.data.type !== 'agent-result') return;
  const r = e.data.result;
  if (typeof handleAgentResult === 'function') return handleAgentResult(r);
});
