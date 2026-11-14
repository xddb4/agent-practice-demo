// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let courseImage = null,
  courseRows = [],
  courseTerm = '2026-09-07';

function importTabs(active) {
  return (
    '<div class="tabs"><button onclick="openImport(\'text\')" class="' +
    (active === 'text' ? 'active' : '') +
    '">✧ 文字识别</button><button onclick="openImageImport()" class="' +
    (active === 'image' ? 'active' : '') +
    '">▧ 课表图片</button><button onclick="openImport(\'manual\')" class="' +
    (active === 'manual' ? 'active' : '') +
    '">＋ 手动添加</button><button onclick="icsImport()">▦ .ics 文件</button></div>'
  );
}

function openImageImport() {
  importTab = 'image';
  modal(
    '<div class="modal-head"><h2>把课表，变成有序的安排</h2><button aria-label="关闭课表导入" onclick="closeModal()">✕</button></div><p class="desc">上传清晰的课程表截图或照片，核对课程、周次和上课时间后再导入。</p>' +
      importTabs('image') +
      '<div class="image-steps"><b>01 上传课表</b><span>02 核对课程</span><span>03 确认导入</span></div><label class="image-drop" for="course-file"><span style="font-size:30px;color:#759578">▧</span><b>' +
      (courseImage ? '更换课表图片' : '上传图片，或按 Ctrl+V 粘贴截图') +
      '</b><span>支持 JPG / PNG / WebP，单张不超过 10 MB</span><input type="file" id="course-file" accept="image/jpeg,image/png,image/webp" onchange="readCourseImage(this)"></label><div id="course-image-preview">' +
      courseImagePreview() +
      '</div><div class="notice">点击识别后，图片将发送给当前配置的视觉模型。请核对课程、时间和教学周后再导入。</div><button class="tiny" onclick="useDemoCourseImage()">没有图片？使用示例课表 →</button><div class="modal-footer"><button class="secondary" onclick="closeModal()">取消</button><button class="primary" id="course-recognize" onclick="recognizeCourseDemo()" ' +
      (!courseImage ? 'disabled' : '') +
      '>识别并核对 →</button></div>',
  );
}

function courseImagePreview() {
  return courseImage
    ? '<div class="course-image-preview"><img src="' +
        courseImage.url +
        '" alt="待识别的课程表预览"><div class="tiny">' +
        esc(courseImage.name) +
        ' · 待识别图片预览</div></div>'
    : '';
}

function readCourseImage(input) {
  let file = input.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    input.value = '';
    toast('请上传 JPG、PNG 或 WebP 图片');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    input.value = '';
    toast('图片需小于 10 MB');
    return;
  }
  let reader = new FileReader();
  reader.onload = () => {
    courseImage = { name: file.name, url: reader.result };
    document.getElementById('course-image-preview').innerHTML = courseImagePreview();
    document.getElementById('course-recognize').disabled = false;
    toast('图片已准备好，可继续体验核对流程');
  };
  reader.onerror = () => toast('图片读取失败，请重新选择');
  reader.readAsDataURL(file);
}

function useDemoCourseImage() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360"><rect width="800" height="360" rx="14" fill="#f4f7f1"/><text x="32" y="48" fill="#3b6348" font-size="24" font-family="sans-serif">2026 秋季学期 · 示例课程表</text><g font-family="sans-serif" font-size="16" fill="#536d59"><text x="40" y="100">时间</text><text x="185" y="100">星期一</text><text x="370" y="100">星期三</text><text x="570" y="100">星期六</text><path d="M30 120H770 M30 220H770 M150 78V330 M340 78V330 M540 78V330" stroke="#d4dfd0"/><text x="36" y="158">08:00</text><text x="36" y="186">09:40</text><text x="175" y="158">高等数学</text><text x="175" y="188">A-201 · 1–16周</text><text x="561" y="158">数据结构</text><text x="561" y="188">A-302 · 1–16周</text><text x="36" y="263">14:00</text><text x="36" y="291">15:40</text><text x="365" y="263">大学英语</text><text x="365" y="293">B-105 · 1–16周</text></g><text x="32" y="343" fill="#93a18c" font-size="12" font-family="sans-serif">此图片仅用于演示识别与核对流程</text></svg>';
  courseImage = {
    name: '示例课表.svg（内置演示）',
    url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
  };
  openImageImport();
}

function recognizeCourseDemo() {
  if (!courseImage) return toast('请先选择课表图片');
  courseRows = [
    {
      title: '高等数学',
      day: 1,
      start: '08:00',
      end: '09:40',
      location: 'A-201',
      from: 1,
      to: 16,
      pattern: 'all',
      q: 1,
    },
    {
      title: '大学英语',
      day: 3,
      start: '14:00',
      end: '15:40',
      location: 'B-105',
      from: 1,
      to: 16,
      pattern: 'all',
      q: 1,
    },
    {
      title: '数据结构',
      day: 6,
      start: '08:00',
      end: '09:40',
      location: 'A-302',
      from: 1,
      to: 16,
      pattern: 'all',
      q: 1,
    },
  ];
  reviewCourseImage();
}

function courseField(i, key, v) {
  courseRows[i][key] = ['day', 'from', 'to', 'q'].includes(key) ? Number(v) : v;
}

function courseInput(i, key, label, type = 'text') {
  return (
    '<label>' +
    label +
    '<input aria-label="课程' +
    (i + 1) +
    ' ' +
    label +
    '" type="' +
    type +
    '" ' +
    (['from', 'to'].includes(key) ? 'min="1" max="40"' : '') +
    ' value="' +
    esc(courseRows[i][key]) +
    '" oninput="courseField(' +
    i +
    ",'" +
    key +
    '\',this.value)"></label>'
  );
}

function reviewCourseImage() {
  modal(
    '<div class="modal-head"><h2>先核对，再加入日程</h2><button aria-label="关闭课表核对" onclick="closeModal()">✕</button></div><p class="desc">' +
      esc(courseImage?.name || '课表图片') +
      '　·　逐项校正后确认导入</p><div class="image-steps"><span>01 上传课表</span><b>02 核对课程</b><span>03 确认导入</span></div><div class="notice">以下是视觉模型从当前图片提取的候选课程。请核对星期、周次和时间。若图片只标注节次，请按学校作息表补填具体时间。</div><div class="form-group"><label for="course-term">学期第一周周一（周次换算基准）</label><input id="course-term" aria-label="学期第一周周一" type="date" value="' +
      courseTerm +
      '" onchange="courseTerm=this.value"><div class="tiny">请按学校校历填写，用于把教学周换算为实际日期。</div></div>' +
      courseRows
        .map(
          (c, i) =>
            '<div class="course-review"><div class="course-row-head"><b>课程 ' +
            (i + 1) +
            '</b><button type="button" class="tiny" onclick="courseRows.splice(' +
            i +
            ',1);reviewCourseImage()">移除此课程</button></div><div class="form-grid">' +
            courseInput(i, 'title', '课程名称') +
            '<label>星期<select aria-label="课程' +
            (i + 1) +
            ' 星期" onchange="courseField(' +
            i +
            ",'day',this.value)\">" +
            ['一', '二', '三', '四', '五', '六', '日']
              .map(
                (x, d) =>
                  '<option value="' +
                  (d + 1) +
                  '" ' +
                  (c.day === d + 1 ? 'selected' : '') +
                  '>星期' +
                  x +
                  '</option>',
              )
              .join('') +
            '</select></label>' +
            courseInput(i, 'start', '开始时间', 'time') +
            courseInput(i, 'end', '结束时间', 'time') +
            courseInput(i, 'location', '地点') +
            '<label>重复规则<select aria-label="课程' +
            (i + 1) +
            ' 重复规则" onchange="courseField(' +
            i +
            ",'pattern',this.value)\">" +
            [
              ['all', '每周'],
              ['odd', '单周'],
              ['even', '双周'],
            ]
              .map(
                ([v, t]) =>
                  '<option value="' +
                  v +
                  '" ' +
                  (c.pattern === v ? 'selected' : '') +
                  '>' +
                  t +
                  '</option>',
              )
              .join('') +
            '</select></label>' +
            courseInput(i, 'from', '起始周', 'number') +
            courseInput(i, 'to', '结束周', 'number') +
            '<label style="grid-column:1/-1">四象限分类<select aria-label="课程' +
            (i + 1) +
            ' 四象限分类" onchange="courseField(' +
            i +
            ",'q',this.value)\">" +
            labels
              .map(
                (l, q) =>
                  '<option value="' +
                  q +
                  '" ' +
                  (c.q === q ? 'selected' : '') +
                  '>' +
                  l +
                  '</option>',
              )
              .join('') +
            '</select></label></div></div>',
        )
        .join('') +
      '<button class="secondary" onclick="courseRows.push({title:\'\',day:1,start:\'08:00\',end:\'09:40\',location:\'\',from:1,to:16,pattern:\'all\',q:1});reviewCourseImage()">＋ 补充漏识别课程</button><p class="tiny">按周次生成具体日期，仅在所选周次出现；导入前会检查与已有固定任务的时间冲突。</p><div class="modal-footer"><button class="secondary" onclick="openImageImport()">返回图片</button><button class="primary" onclick="importReviewedCourses()">确认 ' +
      courseRows.length +
      ' 门课程并检查冲突</button></div>',
    {
      key: 'course-review',
      retainNode: true,
      fresh: true,
      onHide: (reason) => {
        if (reason === 'close' && typeof courseDraftSaved !== 'undefined') courseDraftSaved = true;
      },
    },
  );
}

function importReviewedCourses() {
  let base = new Date(courseTerm + 'T12:00:00');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(courseTerm) || isNaN(base) || base.getDay() !== 1)
    return toast('请把学期起始日期设为第一周的周一');
  if (!courseRows.length) return toast('请至少保留一门课程');
  for (let c of courseRows) {
    if (!c.title.trim() || !c.start || !c.end || c.start >= c.end)
      return toast('请补全课程名称并检查开始、结束时间');
    if (
      !Number.isInteger(c.from) ||
      !Number.isInteger(c.to) ||
      c.from < 1 ||
      c.to > 40 ||
      c.to < c.from
    )
      return toast('周次需为 1–40 的整数，且结束周不早于起始周');
  }
  parsed = [];
  let stamp = Date.now();
  for (let c of courseRows) {
    for (let w = c.from; w <= c.to; w++) {
      if ((c.pattern === 'odd' && w % 2 === 0) || (c.pattern === 'even' && w % 2 !== 0)) continue;
      let d = new Date(base);
      d.setDate(d.getDate() + (w - 1) * 7 + c.day - 1);
      let key =
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0');
      parsed.push({
        id: stamp + parsed.length,
        title: c.title.trim(),
        date: key,
        start: c.start,
        end: c.end,
        location: c.location,
        repeat: '第 ' + w + ' 周 · ' + { all: '每周', odd: '单周', even: '双周' }[c.pattern],
        q: c.q,
        done: false,
        source: '课表图片核对录入',
      });
    }
  }
  if (!parsed.length) return toast('当前周次范围没有符合单双周规则的课程');
  parsed.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  commitParsed();
}
