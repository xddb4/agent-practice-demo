const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSource, namedFunction } = require('./frontend-source.cjs');

function harness(detail, ok = false) {
  const state = {
    document: { getElementById: () => ({ files: [{ name: 'sample.pdf' }] }) },
    val: (id) => ({ 'e-body': '阅读记录', 'e-title': '论文阅读', 'e-source': '阶段作品' })[id],
    FormData: class { append() {} },
    fetch: async () => ({ ok, json: async () => detail }),
    toast: (text) => { state.message = text; },
    askAgent: (...args) => { state.request = args; },
    showStudyAlert: (message, title) => { state.alert = { message, title }; },
    confirmStudyAction: async () => true,
  };
  vm.createContext(state);
  vm.runInContext(namedFunction(readSource('api/client.js'), 'apiErrorMessage'), state);
  vm.runInContext(namedFunction(readSource('api/client.js'), 'attachmentPrivacyMessage'), state);
  vm.runInContext(namedFunction(readSource('api/client.js'), 'reviewAttachmentPrivacy'), state);
  vm.runInContext(readSource('features/evidence/evidence-submit.js'), state);
  return state;
}

test('附件安全拒绝展示具体说明和处理方法，不把错误对象转成字符串', async () => {
  const state = harness({ detail: { code: 'safety_refusal', title: '个人敏感信息请求已拒绝',
    reply: '附件包含不支持处理的个人敏感信息。', action: '请遮盖敏感号码后重新上传。' } });
  await state.submitEvidence({ preventDefault() {} });
  assert.ok(state.alert.message.includes('附件包含不支持处理的个人敏感信息。'));
  assert.ok(state.alert.message.includes('请遮盖敏感号码后重新上传。'));
  assert.equal(state.alert.title, '附件需要修改');
  assert.equal(state.request, undefined);
  assert.ok(!state.alert.message.includes('[object Object]'));
});

test('字符串错误保留原提示，未知对象与校验列表使用可读兜底而不泄露输入', async () => {
  for (const detail of ['PDF无法解析，请粘贴正文或上传有效PDF',
    { input: 'private-input', unknown: 'private-error' }, [{ input: 'private-input' }], null]) {
    const state = harness({ detail });
    await state.submitEvidence({ preventDefault() {} });
    assert.equal(state.message, typeof detail === 'string' ? detail : '附件上传失败，请检查文件格式和大小后重试');
    assert.equal(state.request, undefined);
    assert.ok(!state.message.includes('private-'));
  }
});

test('附件上传成功后才把提取正文交给证据 Agent', async () => {
  const state = harness({ name: 'sample.pdf', url: '/api/files/example', text: '论文摘录' }, true);
  await state.submitEvidence({ preventDefault() {} });
  assert.equal(state.message, undefined);
  assert.equal(state.request[0], 'evidence');
  assert.ok(state.request[1].includes('阅读记录'));
  assert.ok(state.request[1].includes('论文摘录'));
});

test('脱敏完成后提示用户，证据 Agent 只接收脱敏正文', async () => {
  const message = '已隐藏附件中的邮箱或手机号，分析仅使用脱敏正文。';
  const state = harness({ name: 'sample.pdf', url: '/api/files/example',
    text: '论文摘录 [邮箱已隐藏]', privacy: { redacted: true, message } }, true);
  await state.submitEvidence({ preventDefault() {} });
  assert.equal(state.message, message);
  assert.equal(state.request[0], 'evidence');
  assert.ok(state.request[1].includes('[邮箱已隐藏]'));
});

test('拒绝弹窗展示类型和页行定位，不显示敏感值', async () => {
  const state = harness({ detail: { code: 'safety_refusal', reply: '检测到身份证号。',
    action: '请遮盖后重新上传。', findings: [{ label: '身份证号', source: 'pdf', page: 2, line: 5 }],
    finding_count: 1 } });
  await state.submitEvidence({ preventDefault() {} });
  assert.ok(state.alert.message.includes('提取正文第2页第5行：身份证号'));
  assert.ok(state.alert.message.includes('内容已隐藏'));
  assert.equal(state.request, undefined);
});

test('脱敏确认前不调用 Agent，取消后可留在原表单修改文件', async () => {
  const state = harness({ name: 'sample.pdf', text: '脱敏正文', privacy: {
    redacted: true, message: '已隐藏邮箱。', findings: [{ label: '邮箱', source: 'pdf', page: 1, line: 9 }],
    limitations: ['图片中的信息请先遮盖。'] } }, true);
  let resolve;
  state.confirmStudyAction = (message) => {
    state.confirmMessage = message;
    return new Promise((done) => { resolve = done; });
  };
  const submission = state.submitEvidence({ preventDefault() {} });
  await new Promise((done) => setImmediate(done));
  assert.equal(state.request, undefined);
  assert.ok(state.confirmMessage.includes('第1页第9行：邮箱'));
  assert.ok(state.confirmMessage.includes('图片中的信息请先遮盖'));
  resolve(false);
  await submission;
  assert.equal(state.request, undefined);
});
