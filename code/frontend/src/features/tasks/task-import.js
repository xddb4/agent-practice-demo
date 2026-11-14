// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function openImport(tab = 'text') {
  importTab = tab;
  modal(
    '<div class="modal-head"><h2>让安排，从这里开始</h2><button onclick="closeModal()">✕</button></div><p class="desc">文字通知、课程安排或一件小事，都可以成为有序的计划。</p>' +
      importTabs(tab) +
      (tab === 'text'
        ? '<div class="form-group"><label>粘贴通知或课程安排</label><textarea id="raw" style="min-height:160px" placeholder="例如：10月24日14:00-15:30，图书馆203开展数学建模小组讨论。每行一条安排。"></textarea></div><button class="tiny" onclick="document.getElementById(\'raw\').value=\'10月24日14:00-15:30，图书馆203开展数学建模小组讨论\\n10月25日前提交比赛报名表\'">填入示例文本 ↗</button><div class="modal-footer"><button class="primary" onclick="parseText()">识别并预览 →</button></div>'
        : '<form onsubmit="manualSubmit(event)"><div class="form-group"><label>任务名称</label><input id="f-title" required placeholder="你准备完成什么？"></div><div class="form-grid"><div class="form-group"><label>任务类型</label><select id="f-type" onchange="document.getElementById(\'fixed-fields\').classList.toggle(\'hidden\',this.value!==\'fixed\');document.getElementById(\'flex-fields\').classList.toggle(\'hidden\',this.value===\'fixed\')"><option value="flex">灵活待办</option><option value="fixed">固定时间安排</option></select></div><div class="form-group"><label>计划日期</label><input type="date" id="f-date" value="' +
          date +
          '" required></div></div><div id="fixed-fields" class="hidden"><div class="form-grid"><div class="form-group"><label>开始时间</label><input type="time" id="f-start" value="14:00"></div><div class="form-group"><label>结束时间</label><input type="time" id="f-end" value="15:00"></div><div class="form-group"><label>地点</label><input id="f-location" placeholder="教室 / 线上会议"></div><div class="form-group"><label>重复规则</label><select id="f-repeat"><option>不重复</option><option>每周</option></select></div></div></div><div id="flex-fields"><div class="form-grid"><div class="form-group"><label>DDL</label><input id="f-ddl" type="date" value="' +
          date +
          '"></div><div class="form-group"><label>预计时长（分钟）</label><input id="f-duration" type="number" min="1" value="60"></div><div class="form-group"><label>建议时间</label><input id="f-suggest" placeholder="例如 16:00 – 17:00"></div><div class="form-group"><label>能力关联</label><select id="f-ability">' +
          abilities.map((x, i) => '<option value="' + i + '">' + x + '</option>').join('') +
          '</select></div></div></div><div class="form-group"><label>四象限分类（可自行调整）</label><select id="f-q">' +
          labels.map((x, i) => '<option value="' + i + '">' + x + '</option>').join('') +
          '</select></div><div class="modal-footer"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary" type="submit">添加到计划</button></div></form>'),
  );
}

function val(id) {
  return document.getElementById(id).value;
}

function manualSubmit(e) {
  e.preventDefault();
  let fixed = val('f-type') === 'fixed';
  if (fixed && val('f-start') >= val('f-end')) return toast('结束时间需晚于开始时间');
  let t = {
    id: Date.now(),
    title: val('f-title'),
    date: val('f-date'),
    q: +val('f-q'),
    done: false,
    ...(fixed
      ? {
          start: val('f-start'),
          end: val('f-end'),
          location: val('f-location'),
          repeat: val('f-repeat'),
        }
      : {
          ddl: val('f-ddl') || val('f-date'),
          duration: +val('f-duration') || 60,
          suggest: val('f-suggest') || '自行安排',
          ability: +val('f-ability'),
          standard: '' || '完成任务并检查结果',
        }),
  };
  parsed = [t];
  commitParsed();
}

function parseText() {
  let raw = val('raw').trim();
  if (!raw) return toast('先输入一段通知或安排');
  parsed = raw
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      let m = line.match(/(\d{1,2})月(\d{1,2})日/),
        dt = m ? '2026-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : date;
      let time = line.match(/(\d{1,2}:\d{2})\s*[-—至]\s*(\d{1,2}:\d{2})/);
      let q = /提交|截止|报名/.test(line) ? (/重要|论文|实验|比赛/.test(line) ? 0 : 2) : 1;
      let title = line
        .replace(/\d{1,2}月\d{1,2}日[前]?/, '')
        .replace(/\d{1,2}:\d{2}\s*[-—至]\s*\d{1,2}:\d{2}/, '')
        .replace(/^[，,\s]+/, '');
      return {
        id: Date.now() + i,
        title,
        date: dt,
        q,
        done: false,
        ...(time
          ? {
              start: time[1].padStart(5, '0'),
              end: time[2].padStart(5, '0'),
              location: '待核对',
              repeat: '不重复',
            }
          : {
              ddl: dt,
              duration: 60,
              suggest: '自行安排',
              ability: 0,
              standard: '完成通知中的要求',
            }),
      };
    });
  previewParsed('演示识别完成。预计时长、分类和地点均需人工核对。');
}

function previewParsed(msg) {
  modal(
    '<div class="modal-head"><h2>核对识别结果</h2><button onclick="closeModal()">✕</button></div><div class="notice">' +
      msg +
      '</div>' +
      parsed
        .map(
          (t, i) =>
            '<div class="preview-item"><input aria-label="任务名称" value="' +
            esc(t.title) +
            '" onchange="parsed[' +
            i +
            '].title=this.value"><div class="form-grid" style="margin-top:8px"><input aria-label="计划日期" type="date" value="' +
            t.date +
            '" onchange="parsed[' +
            i +
            '].date=this.value;if(!parsed[' +
            i +
            '].start)parsed[' +
            i +
            '].ddl=this.value"><select aria-label="分类" onchange="parsed[' +
            i +
            '].q=+this.value">' +
            labels
              .map(
                (l, j) =>
                  '<option value="' +
                  j +
                  '" ' +
                  (t.q === j ? 'selected' : '') +
                  '>' +
                  l +
                  '</option>',
              )
              .join('') +
            '</select></div><p class="tiny">' +
            (t.start
              ? t.start + ' – ' + t.end + '　地点：' + esc(t.location)
              : '预计 ' + t.duration + ' 分钟') +
            '</p></div>',
        )
        .join('') +
      '<div class="modal-footer"><button class="secondary" onclick="openImport()">返回编辑</button><button class="primary" onclick="commitParsed()">确认加入 ' +
      parsed.length +
      ' 项日程</button></div>',
  );
}

function conflictsFor(t, list) {
  return list.filter(
    (x) =>
      x.start &&
      t.start &&
      x.start < t.end &&
      t.start < x.end &&
      (x.date === t.date ||
        ((x.repeat === '每周' || x.repeat === '每周六') &&
          x.date <= t.date &&
          new Date(x.date).getDay() === new Date(t.date).getDay())),
  );
}

function commitParsed() {
  let conflict = [];
  let seen = [...tasks];
  for (let t of parsed) {
    let c = conflictsFor(t, seen);
    if (c.length) conflict.push(...c);
    seen.push(t);
  }
  if (conflict.length) {
    modal(
      '<div class="modal-head"><h2>这个时段有些拥挤</h2><button onclick="closeModal()">✕</button></div><div class="notice">检测到固定任务时间重叠，请决定如何保留安排。</div>' +
        parsed
          .map(
            (t) =>
              '<div class="preview-item">新安排：' +
              esc(t.title) +
              '　' +
              (t.start || '') +
              ' – ' +
              (t.end || '') +
              '</div>',
          )
          .join('') +
        conflict
          .map(
            (t) =>
              '<div class="preview-item">已有安排：' +
              esc(t.title) +
              '　' +
              t.start +
              ' – ' +
              t.end +
              '</div>',
          )
          .join('') +
        '<div class="modal-footer"><button class="secondary" onclick="closeModal();toast(\'已保留原有安排\')">仅保留原任务</button><button class="secondary" onclick="resolveConflict(\'replace\')">以新任务替换</button><button class="primary" onclick="resolveConflict(\'both\')">均保留</button></div>',
    );
    return;
  }
  finishAdd();
}

function resolveConflict(mode) {
  if (mode === 'replace') {
    tasks = tasks.filter((x) => !parsed.some((t) => conflictsFor(t, [x]).length));
    let accepted = [];
    for (let t of parsed) {
      accepted = accepted.filter((x) => !conflictsFor(t, [x]).length);
      accepted.push(t);
    }
    parsed = accepted;
  }
  finishAdd();
}

function finishAdd() {
  let count = parsed.length;
  tasks.push(...parsed);
  save();
  date = parsed[0]?.date || date;
  timelineCenter = date;
  timelineMode = 'day';
  page = 'plan';
  render();
  closeModal();
  toast('已加入 ' + count + ' 项日程，四象限已同步');
}
