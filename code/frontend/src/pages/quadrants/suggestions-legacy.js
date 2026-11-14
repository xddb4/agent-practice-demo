// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
let selectedQuadrant = null,
  quadrantOwner = null;

function quadrantRecommendations(q) {
  const pending = tasks
    .filter((t) => t.q === q && !t.done)
    .sort((a, b) => (a.ddl || a.date).localeCompare(b.ddl || b.date));
  const scores = abilities.map(
    (_, i) =>
      (confirmed[i] || 0) + evidence.filter((e) => e.status === '已接受' && e.dim === i).length,
  );
  const dim = scores.indexOf(Math.min(...scores));
  const first = pending[0];
  const seeds = [
    [
      ['拆解最紧急任务的交付清单', '先列出必须提交的三项成果，完成最小可交付版本。', 20],
      ['检查成果并提交', '核对要求、文件和截止时间，预留提交缓冲。', 15],
    ],
    [
      ['为长期目标安排一次专项练习', '选择一个薄弱环节完成练习，留下过程和结果记录。', 45],
      ['阅读并整理一份参考资料', '记录来源、关键结论和一个可验证的问题。', 30],
    ],
    [
      ['集中处理一批简短事务', '将必须及时回复或提交的事务合并处理。', 15],
      ['确认可协作或委托的事项', '明确负责人、截止时间和交付要求。', 10],
    ],
    [
      ['整理待办并移除低价值事项', '检查保留理由，为重要目标腾出时间。', 10],
      ['安排一次短暂休息', '离开屏幕活动片刻，再决定下一步。', 10],
    ],
  ];
  return seeds[q].map(([title, standard, duration], i) => ({
    title: first && i === 0 ? first.title + ' · ' + title : title,
    standard,
    duration,
    ability: first?.ability ?? dim,
    q,
    date: today,
    ddl: first?.ddl && first.ddl >= today ? first.ddl : today,
    suggest: '自行安排',
    done: false,
    reason: first
      ? '结合「' + first.title + '」及当前象限的行动方式'
      : '结合当前象限与能力记录较少的维度：' + abilities[dim],
  }));
}

function chooseQuadrant(q) {
  if (!Number.isInteger(q) || q < 0 || q > 3) return;
  selectedQuadrant = q;
  render();
  requestAnimationFrame(() =>
    document.getElementById('quadrant-recommend-title')?.focus({ preventScroll: true }),
  );
}

function clearQuadrantSelection() {
  selectedQuadrant = null;
  render();
}

function quadrantRecommendationHTML(q) {
  let proposals = quadrantRecommendations(q);
  return (
    '<aside class="quadrant-recommendations" aria-label="当前象限的个性化推荐"><div class="modal-head"><div><span class="gallery-kicker">YOUR NEXT STEP</span><h2 id="quadrant-recommend-title" tabindex="-1">推荐任务</h2></div><button onclick="clearQuadrantSelection()" aria-label="关闭推荐面板">✕</button></div><p class="subtitle">' +
    labels[q] +
    ' · 根据任务与本地能力记录提供规则建议</p>' +
    proposals
      .map(
        (r, i) =>
          '<article class="suggestion-card"><span class="gallery-kicker">0' +
          (i + 1) +
          ' · ' +
          r.duration +
          ' 分钟</span><h3>' +
          esc(r.title) +
          '</h3><p>' +
          esc(r.standard) +
          '</p><p class="suggestion-reason">' +
          esc(r.reason) +
          '</p><button class="secondary" onclick="adoptQuadrantRecommendation(' +
          q +
          ',' +
          i +
          ')">＋ 加入此象限</button></article>',
      )
      .join('') +
    '<details class="quadrant-goal"><summary>拆解一个长期目标</summary><p class="tiny">本地模板方案，可编辑后采纳。</p><form onsubmit="generateRec(event)"><label>目标<input id="r-title" required placeholder="例如：准备期末考试" value="' +
    esc(recTarget || '') +
    '"></label><label>截止日期<input id="r-ddl" type="date" min="' +
    today +
    '" required></label><label>每周可投入（小时）<input id="r-hours" type="number" min="1" max="80" value="6" required></label><label>重点方向<textarea id="r-focus" placeholder="希望优先练习什么？"></textarea></label><button class="secondary">生成阶段安排</button></form><div id="rec-result">' +
    (recSteps.length ? recHTML() : '') +
    '</div></details></aside>'
  );
}

function adoptQuadrantRecommendation(q, i) {
  if (!activeAccount) return;
  let proposal = quadrantRecommendations(q)[i];
  if (!proposal) return;
  let { reason, ...task } = proposal;
  if (tasks.some((t) => t.q === q && !t.done && t.title === task.title))
    return toast('此推荐任务已在当前象限');
  let id = Math.max(Date.now(), ...tasks.map((t) => Number(t.id) || 0)) + 1;
  tasks.push({ ...task, id });
  if (!save()) {
    tasks.pop();
    return;
  }
  render();
  toast('推荐任务已加入' + labels[q]);
}

matrix = function () {
  let q = selectedQuadrant;
  document.getElementById('content').innerHTML =
    head('把精力，<br>放在值得的事上。', '点击一个象限，查看具体任务与适合下一步的推荐。') +
    '<div class="division-workspace ' +
    (q !== null ? 'has-recommendations' : '') +
    '"><section class="editorial-quadrants">' +
    quadHTML() +
    '</section>' +
    (q !== null ? quadrantRecommendationHTML(q) : '') +
    '</div>';
  document.querySelectorAll('[data-drop-q]').forEach((el) => {
    let key = Number(el.dataset.dropQ);
    el.classList.toggle('quadrant-selected', q === key);
    let label = el.querySelector('.q-label');
    if (label) {
      label.setAttribute('role', 'button');
      label.tabIndex = 0;
      label.setAttribute('aria-expanded', String(q === key));
      label.setAttribute('aria-label', labels[key] + '，查看任务与推荐');
      label.addEventListener('click', () => chooseQuadrant(key));
      label.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          chooseQuadrant(key);
        }
      });
    }
    el.addEventListener('click', (e) => {
      if (e.target.closest('button,select,input,a,.q-label')) return;
      if (Date.now() < dragClickUntil) return;
      chooseQuadrant(key);
    });
  });
};

recommend = function () {
  page = 'matrix';
  if (selectedQuadrant === null) selectedQuadrant = 1;
  render();
};

recHTML = (function (original) {
  return function () {
    return original().replace('recSteps=[];recommend()', 'recSteps=[];render()');
  };
})(recHTML);

adoptRec = function () {
  let chosen = recSteps.filter((_, i) => document.getElementById('r-check-' + i)?.checked);
  if (!chosen.length) return toast('请至少选择一个阶段');
  let before = tasks.length,
    id = Math.max(Date.now(), ...tasks.map((t) => Number(t.id) || 0)) + 1,
    q = selectedQuadrant ?? 1;
  tasks.push(
    ...chosen.map((step, i) => ({
      id: id + i,
      title: step.title,
      date: step.date,
      ddl: step.date,
      duration: step.duration,
      suggest: '自行安排',
      ability: step.dim,
      standard: step.desc,
      q,
      done: false,
    })),
  );
  if (!save()) {
    tasks.splice(before);
    return;
  }
  recSteps = [];
  render();
  toast('阶段任务已加入' + labels[q]);
};

const renderBeforeIntegratedViews = render;

render = function () {
  let popup = document.getElementById('day-popup-content'),
    sc = document.getElementById('day-scroll'),
    scroll = sc?.scrollTop;
  if (!activeAccount || quadrantOwner !== activeAccount.id) {
    selectedQuadrant = null;
    quadrantOwner = activeAccount?.id ?? null;
  }
  if (page === 'recommend') page = 'matrix';
  if (page !== 'plan' && popup) closeModal();
  renderBeforeIntegratedViews();
  if (page === 'plan' && popup && document.getElementById('day-popup-content')) {
    popup.innerHTML = dayFocusHTML();
    if (document.getElementById('day-scroll'))
      document.getElementById('day-scroll').scrollTop = scroll || 0;
  }
};
