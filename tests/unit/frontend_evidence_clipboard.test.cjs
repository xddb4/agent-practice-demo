const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSource } = require('./frontend-source.cjs');

function setup() {
  const handlers = {};
  const input = { files: [{ name: 'original.pdf' }], dispatchEvent(event) { this.event = event; } };
  const elements = { 'e-file': input, 'e-paste-status': {}, 'e-privacy-status': { textContent: '旧检查结果' } };
  const state = {
    visible: true, alertOpen: false,
    document: {
      querySelector(selector) {
        if (selector === '.study-alert[open]') return state.alertOpen;
        return state.visible ? input : null;
      },
      getElementById: (id) => elements[id],
      addEventListener: (name, callback) => { handlers[name] = callback; },
    },
    DataTransfer: class {
      constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; }
    },
    File: class { constructor(parts, name, options) { this.name = name; this.type = options.type; this.size = parts[0].size; } },
    Event: class { constructor(type) { this.type = type; } },
    showStudyAlert: (message) => { state.alert = message; },
  };
  vm.createContext(state);
  vm.runInContext(readSource('features/evidence/evidence-clipboard.js'), state);
  function paste(files, options = {}) {
    const event = {
      clipboardData: { files, items: options.items || [], getData: () => options.text || '' },
      target: { closest: () => options.editable || false },
      defaultPrevented: options.prevented || false,
      preventDefault() { this.defaultPrevented = true; },
    };
    handlers.paste(event);
    return event;
  }
  return { state, input, elements, paste };
}

test('证据窗口内粘贴文件到真实附件输入框，不自动上传', () => {
  const { input, elements, paste } = setup();
  const file = { name: 'work.pdf', size: 100, type: 'application/pdf' };
  const event = paste([file]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(input.files[0], file);
  assert.equal(input.event.type, 'change');
  assert.equal(elements['e-privacy-status'].textContent, '');
  assert.ok(elements['e-paste-status'].textContent.includes('尚未上传'));
});

test('粘贴截图可从items读取，无文件名时生成正确扩展名', () => {
  const { input, paste } = setup();
  paste([], { items: [{ kind: 'file', getAsFile: () => ({ name: '', type: 'image/png', size: 42 }) }] });
  assert.equal(input.files[0].name, '粘贴的作品截图.png');
  assert.equal(input.files[0].type, 'image/png');
});

test('clipboard.files和items同时提供同一文件不会被当作两个附件', () => {
  const { state, input, paste } = setup();
  const file = { name: 'work.txt', size: 1 };
  paste([file], { items: [{ kind: 'file', getAsFile: () => file }] });
  assert.equal(state.alert, undefined);
  assert.equal(input.files.length, 1);
});

test('超限、不支持或多个附件均不覆盖已选择文件', () => {
  for (const files of [[{ name: 'work.pdf', size: 10 * 1024 * 1024 + 1 }],
    [{ name: 'work.exe', size: 1 }], [{ name: 'a.txt', size: 1 }, { name: 'b.txt', size: 1 }]]) {
    const { state, input, paste } = setup();
    paste(files);
    assert.equal(input.files[0].name, 'original.pdf');
    assert.ok(state.alert);
  }
});

test('普通文字粘贴不拦截，富文本同时携带图片时保留输入框的文字粘贴', () => {
  for (const files of [[], [{ name: 'image.png', type: 'image/png', size: 1 }]]) {
    const { input, paste } = setup();
    const event = paste(files, { text: '论文阅读记录', editable: true });
    assert.equal(event.defaultPrevented, false);
    assert.equal(input.files[0].name, 'original.pdf');
  }
});

test('证据窗口外、隐私确认弹窗内和已处理的粘贴事件均不抢占剪贴板', () => {
  for (const mode of ['outside', 'privacy', 'handled']) {
    const { state, input, paste } = setup();
    state.visible = mode !== 'outside';
    state.alertOpen = mode === 'privacy';
    paste([{ name: 'work.pdf', size: 1 }], { prevented: mode === 'handled' });
    assert.equal(input.files[0].name, 'original.pdf');
  }
});

test('浏览器不支持文件赋值时给出选择文件的替代方式', () => {
  const { state, paste } = setup();
  state.DataTransfer = class { constructor() { throw Error('Unsupported'); } };
  paste([{ name: 'work.pdf', size: 1 }]);
  assert.ok(state.alert.includes('选择文件'));
});

test('点击提交后使用粘贴文件走原上传和隐私确认流程', async () => {
  const { state, paste } = setup();
  const file = { name: 'work.pdf', size: 123 };
  state.val = () => '阅读记录';
  state.FormData = class { append(_key, value) { state.uploadedFile = value; } };
  state.fetch = async () => ({ ok: true, json: async () => ({
    id: 'pasted-file', name: 'work.pdf', text: '脱敏正文', privacy: { redacted: true },
  }) });
  state.reviewAttachmentPrivacy = async () => { state.reviewed = true; return true; };
  state.toast = () => {};
  state.askAgent = (...args) => { state.request = args; };
  vm.runInContext(readSource('features/evidence/evidence-submit.js'), state);
  paste([file]);
  assert.equal(state.uploadedFile, undefined);
  assert.equal(state.request, undefined);
  await state.submitEvidence({ preventDefault() {} });
  assert.equal(state.uploadedFile, file);
  assert.equal(state.reviewed, true);
  assert.equal(state.request[0], 'evidence');
  assert.deepEqual(Array.from(state.request[3]), ['pasted-file']);
});
