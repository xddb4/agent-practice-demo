// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
function report() {
  let accepted = evidence.filter((e) => e.status === '已接受');
  document.getElementById('content').innerHTML =
    head(
      '看见成长，也看见依据。',
      '能力不是一个简单的分数。每次更新，都需要可追溯、经你确认的证据。',
      '<button class="primary" onclick="addEvidence()">＋　添加成长证据</button>',
    ) +
    '<div class="notice" style="margin-bottom:22px">本地规则演示：访客画像含示例数据，新账号从零条证据开始。仅已接受的证据参与等级展示；这不是正式能力测评。</div><div class="report-grid">' +
    abilities
      .map((a, i) => {
        let n = confirmed[i] + accepted.filter((e) => e.dim === i).length;
        let level = n >= 6 ? '稳步发展' : n >= 4 ? '逐渐形成' : '探索阶段';
        return (
          '<section class="panel ability"><h3>' +
          a +
          '</h3><div class="level">' +
          level +
          ' <span style="font-size:12px;color:#8ba17e">' +
          (accepted.some((e) => e.dim === i) ? '↗ 新证据已纳入' : '→ 稳定') +
          '</span></div><p>置信度：' +
          (n >= 6 ? '中等' : '偏低') +
          '　·　已确认依据 ' +
          n +
          ' 条</p><div class="progress-bar"><i style="width:' +
          Math.min(n * 11, 85) +
          '%"></i></div><p>主要证据：' +
          esc(
            accepted.find((e) => e.dim === i)?.title ||
              [
                '研究问题清单与开题草稿',
                '代码实现记录与系统流程图',
                '实验日志与模型对照结果',
                '论文局限分析与复盘记录',
                '引用清单与检索记录',
                '小组汇报与个人周反思',
              ][i],
          ) +
          '</p><p>下一步：' +
          [
            '把研究问题转化为可验证的假设',
            '给代码补充模块图与设计解释',
            '补充重复实验和误差来源说明',
            '为结论列出一个替代解释',
            '核查引用出处与论证对应关系',
            '记录一次反馈及后续调整',
          ][i] +
          '</p></section>'
        );
      })
      .join('') +
    '</div><section class="panel evidence"><div class="panel-title">证据收件箱 <small>由你决定，什么能代表你的成长</small></div>' +
    evidence
      .map(
        (e) =>
          '<div class="evidence-row"><div class="avatar" style="font-size:15px">▤</div><div class="grow"><h4>' +
          esc(e.title) +
          '　<span class="pill">' +
          e.status +
          '</span></h4><p>' +
          esc(e.desc) +
          '</p><p style="margin-top:5px">' +
          esc(e.body) +
          '</p></div>' +
          (e.status === '已接受' || e.status === '已拒绝'
            ? '<button class="tiny" onclick="evidenceState(' +
              e.id +
              ",'待确认')\">重新审核</button>"
            : '<button class="primary" onclick="evidenceState(' +
              e.id +
              ',\'已接受\')">接受</button><button class="secondary" onclick="editEvidence(' +
              e.id +
              ')">修改</button><button class="tiny" onclick="evidenceState(' +
              e.id +
              ',\'已拒绝\')">拒绝</button><button class="tiny" onclick="evidenceState(' +
              e.id +
              ",'待观察')\">待观察</button>") +
          '</div>',
      )
      .join('') +
    '</section>';
}

function evidenceState(id, status) {
  evidence.find((e) => e.id === id).status = status;
  save();
  report();
  toast(
    status === '已接受' ? '证据已确认，能力报告已更新' : '已标记为' + status + '，不纳入正式报告',
  );
}

function addEvidence() {
  modal(
    '<div class="modal-head"><h2>记录一份成长依据</h2><button onclick="closeModal()">✕</button></div><p class="desc">上传阶段作品、粘贴论文结果、行为记录、个人自述或外部反馈。</p><form onsubmit="submitEvidence(event)"><div class="form-group"><label>证据标题</label><input id="e-title" required placeholder="例如：第一次完成对照实验"></div><div class="form-grid"><div class="form-group"><label>来源类型</label><select id="e-source"><option>阶段作品</option><option>论文结果</option><option>行为记录</option><option>用户自述</option><option>外部反馈</option></select></div><div class="form-group"><label>关联能力</label><select id="e-dim">' +
      abilities.map((a, i) => '<option value="' + i + '">' + a + '</option>').join('') +
      '</select></div></div><div class="form-group"><label>具体内容与依据</label><textarea id="e-body" required placeholder="做了什么？有什么结果？哪些材料能够支持？"></textarea></div><div class="form-group"><label>作品附件（不超过10MB）</label><input type="file" id="e-file" accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp" aria-describedby="e-paste-status"></div><p id="e-paste-status" class="tiny" role="status">可按 Ctrl+V 粘贴一个文件或截图，也可点击选择文件。截图仅作为附件保存，请将关键文字补充到上方正文。</p><p class="tiny">PDF、TXT、Markdown 正文中的邮箱、手机号会在分析前隐藏；图片中的联系方式请先遮盖。原文件仅当前账号可访问。</p><p id="e-privacy-status" class="tiny" role="status"></p><div class="notice">提交后生成候选证据，等待你接受、修改、拒绝或标记待观察。</div><div class="modal-footer"><button class="primary">生成候选证据</button></div></form>',
  );
}

function submitEvidence(e) {
  e.preventDefault();
  evidence.unshift({
    id: Date.now(),
    title: val('e-title'),
    desc:
      val('e-source') +
      ' → ' +
      abilities[+val('e-dim')] +
      (document.getElementById('e-file').files[0]
        ? ' · 附件：' + document.getElementById('e-file').files[0].name
        : ''),
    body: val('e-body'),
    dim: +val('e-dim'),
    status: '待确认',
  });
  save();
  closeModal();
  report();
  toast('候选证据已生成，尚未更新能力报告');
}

function editEvidence(id) {
  let e = evidence.find((x) => x.id === id);
  modal(
    '<div class="modal-head"><h2>修改候选证据</h2><button onclick="closeModal()">✕</button></div><p class="desc">修改后回到待确认状态，由你决定是否接受。</p><input id="edit-title" value="' +
      esc(e.title) +
      '"><textarea id="edit-body" style="margin-top:15px">' +
      esc(e.body) +
      '</textarea><div class="modal-footer"><button class="primary" onclick="let e=evidence.find(x=>x.id===' +
      id +
      ");e.title=val('edit-title');e.body=val('edit-body');e.status='待确认';save();closeModal();report()\">保存修改</button></div>",
  );
}
