// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let recTarget = '',
  recSteps = [];

function recommend() {
  document.getElementById('content').innerHTML =
    head(
      '让远一点的目标，有近一点的起点。',
      '结合能力记录与可用时间，把长期准备拆成可以行动的小步骤。',
    ) +
    '<div class="rec-layout"><section class="panel rec-form"><div class="panel-title">你正在准备什么？</div><p class="subtitle">比赛、论文、考核，或任何想认真完成的目标。</p><form onsubmit="generateRec(event)"><div class="form-group"><label>长期准备型任务</label><input id="r-title" value="' +
    esc(recTarget || '准备大学生数学建模竞赛') +
    '" required></div><div class="form-grid"><div class="form-group"><label>目标截止日期</label><input id="r-ddl" type="date" value="2026-11-20" min="2026-10-25" required></div><div class="form-group"><label>每周可投入（小时）</label><input id="r-hours" type="number" min="1" max="80" value="6" required></div></div><div class="form-group"><label>想补足或优先关注的方面</label><textarea id="r-focus" placeholder="例如：实验设计经验不够，希望先熟悉建模验证流程。"></textarea></div><div class="preview-item" style="background:#f5f8f2"><b style="font-size:11px">✧ 参考你的能力画像</b><p class="tiny">计算与系统思维：稳步发展<br>实验验证与数据素养：' +
    (confirmed[2] + evidence.filter((e) => e.status === '已接受' && e.dim === 2).length >= 4
      ? '逐渐形成'
      : '探索阶段') +
    '<br>优先增加验证与结果解释的练习。</p></div><div class="notice">联网检索与智能方案生成在本原型中为演示；未实际调用 web search，不展示虚构来源。</div><button class="primary" style="width:100%;margin-top:10px">生成准备方案　→</button></form></section><section class="panel rec-form" id="rec-result">' +
    (recSteps.length
      ? recHTML()
      : '<div style="text-align:center;padding:70px 25px"><div style="font-size:50px;color:#9fb39b">✧</div><h3 style="font-size:16px;font-weight:500">大目标，可以从一小步开始</h3><p class="subtitle">输入目标后，查看可选择、可调整的阶段安排。</p></div>') +
    '</section></div>';
}

function generateRec(e) {
  e.preventDefault();
  recTarget = val('r-title');
  let ddl = val('r-ddl'),
    h = +val('r-hours'),
    focus = val('r-focus');
  let start = new Date(today + 'T12:00:00'),
    end = new Date(ddl + 'T12:00:00');
  let span = Math.max(1, Math.floor((end - start) / 86400000));
  let title = recTarget.replace(/^准备/, '');
  recSteps = [
    {
      title: '明确「' + title + '」的目标与要求',
      desc: '梳理提交要求、评价标准与现有资源，形成一页任务清单。',
      dim: 0,
    },
    {
      title: '完成基础练习与资料整理',
      desc: '选择一个代表性小任务实践，记录检索来源与方法选择。',
      dim: 1,
    },
    {
      title: '进行验证并解释结果',
      desc:
        (focus ? '围绕「' + focus + '」安排练习；' : '') +
        '设计对照，记录误差与局限，形成结果说明。',
      dim: 2,
    },
    {
      title: '整理成果并开展一次复盘',
      desc: '核对完成标准，收集一次同伴反馈，补齐最终材料。',
      dim: 5,
    },
  ].map((s, i) => {
    let d = new Date(start);
    d.setDate(d.getDate() + Math.max(1, Math.floor((span * (i + 1)) / 4)));
    return {
      ...s,
      date: d.toISOString().slice(0, 10),
      duration: Math.min(180, Math.max(30, Math.round((h * 60) / 4))),
    };
  });
  document.getElementById('rec-result').innerHTML = recHTML();
  toast('演示方案已生成，可勾选采纳');
}

function recHTML() {
  return (
    '<div class="panel-title">为你拆解的四个阶段 <span class="pill">示例方案</span></div><p class="subtitle">建议依据：能力画像中的验证经验相对较少，增加对照与复盘环节。</p>' +
    recSteps
      .map(
        (s, i) =>
          '<div class="rec-step"><div class="step-num">0' +
          (i + 1) +
          '</div><div style="flex:1"><h3>' +
          esc(s.title) +
          '</h3><p>' +
          esc(s.desc) +
          '</p><p style="margin-top:8px;color:#789271">' +
          s.date +
          '　·　' +
          s.duration +
          ' 分钟</p></div><input style="width:16px;flex-shrink:0" type="checkbox" aria-label="采纳阶段' +
          (i + 1) +
          '" id="r-check-' +
          i +
          '" checked></div>',
      )
      .join('') +
    '<div class="modal-footer"><button class="secondary" onclick="recSteps=[];recommend()">暂不采纳</button><button class="primary" onclick="adoptRec()">采纳所选并加入日程</button></div>'
  );
}

function adoptRec() {
  let chosen = recSteps.filter((s, i) => document.getElementById('r-check-' + i).checked);
  if (!chosen.length) return toast('请至少选择一个阶段');
  tasks.push(
    ...chosen.map((s, i) => ({
      id: Date.now() + i,
      title: s.title,
      date: s.date,
      ddl: s.date,
      duration: s.duration,
      suggest: '自行安排',
      ability: s.dim,
      standard: s.desc,
      q: 1,
      done: false,
    })),
  );
  save();
  recSteps = [];
  date = chosen[0].date;
  timelineCenter = date;
  timelineMode = 'day';
  page = 'plan';
  render();
  toast('已采纳 ' + chosen.length + ' 个阶段并加入计划');
}
