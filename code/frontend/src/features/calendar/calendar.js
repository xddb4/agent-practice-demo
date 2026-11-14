// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let calendarYear = 2026,
  calendarMonth = 9;

function hasTaskOn(key) {
  return tasks.some(
    (t) =>
      t.date === key ||
      ((t.repeat === '每周' || t.repeat === '每周六') &&
        t.date < key &&
        new Date(t.date).getDay() === new Date(key).getDay()),
  );
}

function calendar(view = date) {
  let d = new Date(view + 'T12:00:00');
  calendarYear = d.getFullYear();
  calendarMonth = d.getMonth();
  drawCalendar();
}

function calendarShift(delta) {
  let d = new Date(calendarYear, calendarMonth + delta, 1, 12);
  if (d.getFullYear() < 1900 || d.getFullYear() > 2200) return;
  calendarYear = d.getFullYear();
  calendarMonth = d.getMonth();
  drawCalendar();
}

function calendarPickYear(value) {
  let y = Number(value);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) {
    toast('请选择 1900 至 2200 年');
    drawCalendar();
    return;
  }
  calendarYear = y;
  drawCalendar();
}

function calendarToday() {
  centerToday();
  calendar(today);
}

function drawCalendar() {
  let year = calendarYear,
    month = calendarMonth,
    first = new Date(year, month, 1).getDay();
  modal(
    '<div class="modal-head"><h2>' +
      year +
      ' 年 ' +
      (month + 1) +
      ' 月</h2><button onclick="closeModal()" aria-label="关闭日历">✕</button></div><p class="desc">切换月份或直接选择年月，点击日期查看当天日程。</p><div class="calendar-controls"><button class="secondary" aria-label="上个月" onclick="calendarShift(-1)" ' +
      (year === 1900 && month === 0 ? 'disabled' : '') +
      '>‹</button><label><span class="tiny">年份</span><select id="calendar-year" aria-label="选择年份" onchange="calendarPickYear(this.value)">' +
      Array.from(
        { length: 301 },
        (_, i) =>
          '<option value="' +
          (1900 + i) +
          '" ' +
          (year === 1900 + i ? 'selected' : '') +
          '>' +
          (1900 + i) +
          ' 年</option>',
      ).join('') +
      '</select></label><label><span class="tiny">月份</span><select aria-label="选择月份" onchange="calendarMonth=+this.value;drawCalendar()">' +
      Array.from(
        { length: 12 },
        (_, i) =>
          '<option value="' +
          i +
          '" ' +
          (i === month ? 'selected' : '') +
          '>' +
          (i + 1) +
          ' 月</option>',
      ).join('') +
      '</select></label><button class="secondary" aria-label="下个月" onclick="calendarShift(1)" ' +
      (year === 2200 && month === 11 ? 'disabled' : '') +
      '>›</button><button class="secondary" onclick="calendarToday()">回到今天</button></div><div class="calendar">' +
      ['日', '一', '二', '三', '四', '五', '六']
        .map((x) => '<span style="text-align:center" class="tiny">' + x + '</span>')
        .join('') +
      Array.from({ length: first }, () => '<span></span>').join('') +
      Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => {
        let key =
          year + '-' + String(month + 1).padStart(2, '0') + '-' + String(i + 1).padStart(2, '0');
        let has = hasTaskOn(key);
        return (
          '<button aria-label="' +
          key +
          (key === today ? ' 今天' : '') +
          (has ? ' 有日程' : '') +
          '" aria-pressed="' +
          (key === date) +
          '" class="' +
          (key === date ? 'selected ' : '') +
          (key === today ? 'calendar-today' : '') +
          '" onclick="timelineCenter=\'' +
          key +
          "';selectTimelineDate('" +
          key +
          '\')">' +
          (i + 1) +
          '<span class="calendar-dot" style="visibility:' +
          (has ? 'visible' : 'hidden') +
          '">•</span></button>'
        );
      }).join('') +
      '</div><p class="tiny" style="margin-top:14px">圆点表示有日程 · 绿色边框表示今天 · 实色背景表示选中日期</p><div class="modal-footer"><button class="secondary" onclick="icsImport()">导入 .ics</button><button class="primary" onclick="exportICS()">导出日历 .ics</button></div>',
  );
}

function exportICS() {
  let v =
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//StudyPilot//Planner//ZH\r\nCALSCALE:GREGORIAN\r\n';
  tasks.forEach((t) => {
    let d = t.date.replaceAll('-', '');
    v +=
      'BEGIN:VEVENT\r\nUID:shixu-' +
      t.id +
      '@planner\r\nDTSTAMP:20261024T000000Z\r\n' +
      (t.start
        ? 'DTSTART;TZID=Asia/Shanghai:' +
          d +
          'T' +
          t.start.replace(':', '') +
          '00\r\nDTEND;TZID=Asia/Shanghai:' +
          d +
          'T' +
          t.end.replace(':', '') +
          '00\r\n'
        : 'DTSTART;VALUE=DATE:' + d + '\r\n') +
      'SUMMARY:' +
      t.title.replace(/[,;\\]/g, ' ') +
      '\r\n' +
      (t.location ? 'LOCATION:' + t.location + '\r\n' : '') +
      (t.repeat === '每周六' || t.repeat === '每周' ? 'RRULE:FREQ=WEEKLY\r\n' : '') +
      'END:VEVENT\r\n';
  });
  v += 'END:VCALENDAR\r\n';
  let u = URL.createObjectURL(new Blob([v], { type: 'text/calendar;charset=utf-8' }));
  let a = document.createElement('a');
  a.href = u;
  a.download = 'StudyPilot日程.ics';
  a.click();
  URL.revokeObjectURL(u);
  toast('已导出，可导入系统日历');
}

function icsImport() {
  let f = document.createElement('input');
  f.type = 'file';
  f.accept = '.ics';
  f.onchange = async () => {
    let txt = await f.files[0].text();
    parsed = [];
    for (let b of txt.split('BEGIN:VEVENT').slice(1)) {
      let get = (k) =>
        (b.match(new RegExp('(?:^|\\n)' + k + '(?:;[^:]+)?:([^\\r\\n]+)')) || [])[1] || '';
      let s = get('DTSTART'),
        e = get('DTEND'),
        title = get('SUMMARY');
      if (!title || !/^\d{8}/.test(s)) continue;
      let dt = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
      parsed.push({
        id: Date.now() + parsed.length,
        title,
        date: dt,
        q: 1,
        done: false,
        ...(s.includes('T')
          ? {
              start: s.slice(9, 11) + ':' + s.slice(11, 13),
              end: e ? e.slice(9, 11) + ':' + e.slice(11, 13) : '23:59',
              location: get('LOCATION'),
              repeat: get('RRULE').includes('WEEKLY') ? '每周' : '不重复',
            }
          : { ddl: dt, duration: 30, suggest: '自行安排', ability: 5, standard: '完成日历事项' }),
      });
    }
    if (!parsed.length) return toast('未识别到有效日历事件');
    previewParsed('日历文件识别完成；请核对时间与时区。');
  };
  f.click();
}
