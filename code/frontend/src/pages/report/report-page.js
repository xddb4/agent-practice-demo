function reportInformationHTML(r) {
  const reference = r.execution_reference;
  return informationHTML(
    'report-information',
    '能力报告说明',
    '<h3>形成依据</h3><p>仅使用已接受证据；数量不代表能力等级。每个能力维度的依据可在对应卡片中展开查看。</p><p>当前报告的置信度有限，趋势暂无可比历史；请结合具体过程、成果与反思理解报告。</p>' +
      (reference
        ? '<section class="execution-reference"><h3>执行节奏参考</h3><p>已完成 ' +
          reference.completed_flexible_tasks +
          ' 项灵活任务，其中 ' +
          reference.known_elapsed_tasks +
          ' 项有完整历时记录。</p><p>' +
          esc(reference.limitations) +
          '</p><p>待重新安排的过期任务：' +
          (reference.expired_reference?.total || 0) +
          ' 项</p><p>过期不代表能力不足，可先检查时间预算、任务难度和依赖条件。</p>' +
          (reference.expired_reference?.adjustment_advice || [])
            .map((text) => '<p>' + esc(text) + '</p>')
            .join('') +
          '<button class="secondary" onclick="this.closest(\'[popover]\').hidePopover();showDeletedTasks(\'expired\')">查看与调整过期任务</button></section>'
        : ''),
  );
}

report = async function () {
  try {
    if (typeof saveQueue !== 'undefined') await saveQueue;
    const latest = await api('state');
    if (Array.isArray(latest?.evidence)) evidence = latest.evidence;
    if (Array.isArray(latest?.tasks)) tasks = latest.tasks;
    if (Array.isArray(latest?.task_trash)) taskTrashRecords = latest.task_trash;
    expiredTaskRecords = latest.expired_tasks || [];
    const r = await api('report');
    document.getElementById('content').innerHTML =
      '<div class="heading report-heading"><div class="report-title-group"><h1>能力报告</h1>' +
      reportInformationHTML(r) +
      '</div><button class="primary" onclick="addEvidence()">＋ 添加成长证据</button></div>' +
      '<p class="tiny report-generated">报告生成：' +
      esc(new Date(r.generated_at).toLocaleString()) +
      '</p>' +
      '<div class="report-grid">' +
      r.dimensions
        .map(
          (d) =>
            '<section class="panel ability"><h3>' +
            esc(d.name) +
            '</h3><div class="level">' +
            esc(d.level) +
            '</div><p>置信度：' +
            esc(d.confidence) +
            ' · ' +
            d.evidence.length +
            ' 条依据</p><p>趋势：' +
            esc(d.trend) +
            '</p>' +
            d.evidence
              .map(
                (e) =>
                  '<details><summary>' +
                  esc(e.title) +
                  '</summary><p>' +
                  esc(e.body) +
                  '</p><p>' +
                  esc(e.desc) +
                  '</p></details>',
              )
              .join('') +
            '<p>下一步：' +
            esc(d.next) +
            '</p></section>',
        )
        .join('') +
      '</div>' +
      evidenceInboxHTML();
  } catch (e) {
    toast(e.message);
  }
};

evidenceState = async function (id, status) {
  evidence.find((x) => x.id === id).status = status;
  save();
  try {
    await saveQueue;
    report();
  } catch {}
};
