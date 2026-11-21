report = async function () {
  try {
    if (typeof saveQueue !== 'undefined') await saveQueue;
    const latest = await api('state');
    if (Array.isArray(latest?.evidence)) evidence = latest.evidence;
    if (Array.isArray(latest?.tasks)) tasks = latest.tasks;
    const r = await api('report');
    document.getElementById('content').innerHTML =
      head(
        '看见成长，也看见依据。',
        '仅使用已接受证据；数量不代表能力等级。',
        '<button class="primary" onclick="addEvidence()">＋ 添加成长证据</button>',
      ) +
      '<p class="tiny">报告生成：' +
      esc(new Date(r.generated_at).toLocaleString()) +
      '</p><div class="report-grid">' +
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
