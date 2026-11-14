const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const vm = require('node:vm');
const { readSource } = require('./frontend-source.cjs');

const front = path.resolve('code/frontend');
const load = (relative) => import(pathToFileURL(path.join(front, relative)).href);

test('集中路由在调用时读取最终页面函数，保留默认页、个人登录入口与导航', () => {
  const calls = [];
  const button = { dataset: { page: 'matrix' } };
  const state = {
    page: 'plan',
    renderPlan: () => calls.push('plan'),
    matrix: () => calls.push('matrix'),
    report: () => calls.push('report'),
    personal: () => calls.push('personal'),
    recommend: () => calls.push('recommend'),
    openPersonal: () => calls.push('login-gate'),
    render: () => calls.push('render-lifecycle'),
    document: { querySelectorAll: () => [button] },
  };
  vm.createContext(state);
  vm.runInContext(readSource('app/router.js'), state);
  vm.runInContext("StudyPilotRouter.render('matrix');StudyPilotRouter.render('missing')", state);
  assert.deepEqual(calls, ['matrix', 'plan']);
  state.matrix = () => calls.push('final-matrix');
  vm.runInContext("StudyPilotRouter.render('matrix');StudyPilotRouter.navigate('personal');StudyPilotRouter.bindNavigation()", state);
  button.onclick();
  assert.deepEqual(calls.slice(2), ['final-matrix', 'login-gate', 'render-lifecycle']);
  assert.equal(state.page, 'matrix');
  vm.runInContext("StudyPilotRouter.register('extra',()=>report());StudyPilotRouter.render('extra')", state);
  assert.equal(calls.at(-1), 'report');
  assert.throws(() => vm.runInContext("StudyPilotRouter.register('plan',()=>{})", state));
});

test('资源清单涵盖全部普通脚本，无遗漏、重复与无效语法', async () => {
  const { bundles, extensions, styles } = await load('src/app/assets.mjs');
  const declared = new Set(Object.values(bundles).flat());
  const walk = (relative) => readdirSync(path.join(front, 'src', relative), { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? walk(path.join(relative, entry.name)) : [path.join(relative, entry.name).replaceAll('\\', '/')]);
  for (const source of walk('').filter((file) => file.endsWith('.js'))) {
    assert.ok(declared.has(source), `Not registered: ${source}`);
    new vm.Script(readSource(source), { filename: source });
  }
  for (const [name, sources] of Object.entries(bundles)) {
    assert.equal(new Set(sources).size, sources.length, name);
    new vm.Script(sources.map(readSource).join('\n;\n'), { filename: name });
  }
  for (const name of extensions) assert.ok(bundles[name], name);
  assert.equal(styles.at(-1)[0], 'readability.css');
  assert.equal(extensions.at(-1), 'plan_scene.js');
});

test('原版页面、全部业务与动效脚本、样式层叠和图片保持等价', async () => {
  const { bundles, styles } = await load('src/app/assets.mjs');
  const { scriptContract, styleContract, markupContract, shellContract, hash } = await load('tools/source-contract.mjs');
  const baseline = JSON.parse(readFileSync('tests/fixtures/frontend-contract-v1.json', 'utf8'));
  for (const [name, expected] of Object.entries(baseline.scripts)) {
    assert.equal(scriptContract(bundles[name].map(readSource).join('\n;\n'), name), expected, `Business code changed: ${name}`);
  }
  assert.equal(markupContract(readSource('app/workspace.html')), baseline.markup, 'Page markup changed');
  assert.equal(await styleContract(styles.map(([, source]) => readSource(source))), baseline.styles, 'CSS rules or cascade changed');
  assert.equal(await shellContract(readSource('app/AgentApp.jsx')), baseline.shell, 'React shell changed');
  assert.equal(await styleContract([readSource('styles/shell.css')]), baseline.shellStyles, 'React shell CSS changed');
  for (const [asset, expected] of Object.entries(baseline.assets)) {
    assert.equal(hash(readFileSync(path.join(front, 'public/assets', asset))), expected, asset);
  }
});

test('构建器可从任意工作目录生成全部资源、版本链接与正确加载顺序', async () => {
  const { generateWorkspace } = await load('tools/build-workspace.mjs');
  const { bundles, styles, extensions } = await load('src/app/assets.mjs');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'studypilot-frontend-test-'));
  try {
    const result = await generateWorkspace({ outDir: directory });
    const html = readFileSync(path.join(directory, 'prototype.html'), 'utf8');
    assert.doesNotMatch(html, /<!-- @(?:styles|script|extensions)/);
    for (const name of [...Object.keys(bundles), ...styles.map(([name]) => name)]) {
      assert.ok(result.files.includes(name), name);
      assert.ok(html.includes(`/${name}?v=`), `Not loaded: ${name}`);
    }
    const scripts = [...html.matchAll(/<script src="\/([^?"]+)\?v=[a-f0-9]{12}"><\/script>/g)].map((match) => match[1]);
    assert.deepEqual(scripts, ['grid-distortion.js', 'gooey-navigation.js', 'router.js', 'local-state.js', 'workspace.js', ...extensions]);
    const links = [...html.matchAll(/<link rel="stylesheet" href="\/([^?"]+)\?v=[a-f0-9]{12}">/g)].map((match) => match[1]);
    assert.deepEqual(links, styles.map(([name]) => name));
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('studypilot-frontend-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
