const originalRecommend = recommend;

recommend = function () {
  originalRecommend();
  const notice = document.querySelector('#content .notice');
  if (notice) notice.textContent = '生成方案后，可以逐项选择、修改，再加入计划。';
  const p = document.querySelector('.rec-form .preview-item');
  if (p)
    p.innerHTML =
      '<b>参考已确认能力证据与已有日程</b><p class="tiny">没有证据时根据自述生成初步方案，并注明依据有限。</p>';
};
