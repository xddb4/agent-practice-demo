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
      head(
        '看见成长，也看见依据。',
        '仅使用已接受证据；数量不代表能力等级。',
        '<button class="primary" onclick="addEvidence()">＋ 添加成长证据</button>',
      ) +
      '<p class="tiny">报告生成：' +
      esc(new Date(r.generated_at).toLocaleString()) +
      '</p>' +
      (r.execution_reference
        ? '<section class="panel execution-reference"><h3>执行节奏参考</h3><p>已完成 ' +
          r.execution_reference.completed_flexible_tasks +
          ' 项灵活任务，其中 ' +
          r.execution_reference.known_elapsed_tasks +
          ' 项有完整历时记录。</p><p class="tiny">' +
          esc(r.execution_reference.limitations) +
          '</p><p>待重新安排的过期任务：' +
          (r.execution_reference.expired_reference?.total || 0) +
          ' 项</p><p class="tiny">过期不代表能力不足，可先检查时间预算、任务难度和依赖条件。</p>' +
          (r.execution_reference.expired_reference?.adjustment_advice || [])
            .map((text) => '<p>' + esc(text) + '</p>')
            .join('') +
          '<button class="secondary" onclick="showDeletedTasks(\'expired\')">查看与调整过期任务</button></section>'
        : '') +
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
