# 前端开发与 UI 修改指南

本文路径以仓库根目录为起点。完整文件树、迁移清单、验证结果见 [重构交付报告](FRONTEND_REFACTOR_REPORT.md)。

## 1. 现在的前端怎样运行

```text
index.html
  → src/app/AgentApp.jsx（React 外框）
  → iframe /prototype.html
      → src/app/workspace.html 的页面骨架
      → src/app/assets.mjs 登记的 CSS、动效、状态和工作台脚本
      → src/app/bootstrap.js 绑定导航并显示初始页
      → 会话恢复读取真实 API，重新显示个人工作台
```

`tools/build-workspace.mjs` 按清单把源文件组装到 `public/`，Vite 再生成 `dist/`。后端仍通过原来的 `/`、`/prototype.html`、`/api/*` 提供服务。

本轮是保留体验的渐进整理，**没有把整个工作台改成 React**。普通 `.js` 文件仍共享原有变量和函数；工作台片段合并为一个普通脚本，保持函数声明提升与执行时机。React 只管理外框的一部分请求状态。请勿直接给这些普通脚本添加 import/export，它们与 `.jsx`、`.mjs` 模块的运行方式不同。

## 2. 如何运行与验证

完整应用仍使用仓库根目录的 `Start-StudyPilot.cmd` 或 `start.ps1`，Docker 数据卷和项目名称不变。

前端开发使用 Node.js 22 或更新的兼容版本，在 PowerShell 中执行：

```powershell
Set-Location -LiteralPath 'E:\STUDY!\软件创新实践\github\code\frontend'
npm.cmd ci
npm.cmd run dev
```

打开终端输出的开发地址，默认 `http://127.0.0.1:5173/`。开发服务器会生成工作台、监听普通源码变化并刷新页面，`/api` 转发到已启动的 `http://127.0.0.1:8000` 后端。后端没有启动时，页面资源能加载，但登录和业务请求无法成功。修改资源清单后若没有自动重启，手动重启开发服务器。

```powershell
npm.cmd test
npm.cmd run format:check
npm.cmd run build
```

`npm.cmd run preview` 可检查构建后的前端，默认端口 4173，API 同样代理到 8000。5173/4173 是开发与预览入口，正式使用仍是 8000。

依赖统一由 `package-lock.json` 管理，Docker 也执行 npm ci。原 pnpm 锁和空工作区配置已备份后移除，避免使用两套不一致的安装结果。Windows 重新执行 npm ci 前，先关闭本项目开发服务器，避免 Rollup 原生文件被占用。

## 3. UI 修改入口

以下文件均位于 `code/frontend/` 下：

| 需要修改 | 打开的源文件 |
|---|---|
| 全局颜色、背景、公共字体、圆角、间距 | `src/styles/theme.css` |
| 基础标签、通用按钮/卡片/表单初始样式 | `src/styles/base.css` |
| 当前玻璃工作台、对话等扩展样式 | `src/styles/workspace.css` |
| 最终文字颜色、可读性覆盖 | `src/styles/readability.css` |
| 公共玻璃材质、弹窗背景 | `src/styles/components/surfaces.css` |
| 导航外观 | `src/styles/layouts/header.css`、`workspace-palette.css`、`src/styles/components/gooey-navigation.css` |
| 统一标题、按钮和卡片的后续排版层 | `src/styles/layouts/editorial.css` |
| 页面静态骨架、顶部导航节点、欢迎页标签 | `src/app/workspace.html` |
| 计划页布局与今日任务首屏 | `src/pages/plan/plan-page.js`、`src/layouts/plan-scene.js`、`src/styles/pages/plan-scene.css` |
| 日期画廊 | `src/components/tasks/date-gallery.js`、`src/styles/pages/date-gallery.css` |
| 固定时间轴、灵活任务卡和排序 | `src/components/tasks/timeline-view.js`、`task-views.js`、`src/features/tasks/task-selectors.js`、`src/styles/pages/timeline.css` |
| 四象限最终页面 | `src/pages/quadrants/quadrant-page.js`、`src/components/quadrants/spheres.js`、`src/styles/components/spheres.css` |
| 推荐对话工作台 | `src/pages/recommendations/plan-dialogue.js`；样式检索 workspace/surfaces/readability 中的 dialogue-* |
| 用户核对候选的表单 | `src/features/agent/candidate-review.js`；样式检索 review-* |
| 能力报告正文 | `src/pages/report/report-page.js` |
| 报告横向阅读 | `src/components/report/report-scroll.js`、`src/styles/pages/report-scroll.css` |
| 证据收件箱 | `src/features/evidence/evidence-inbox.js` |
| 个人空间和资料 | `src/pages/personal/personal-page.js` |
| 模型设置弹窗 | `src/pages/personal/model-settings.js` |
| 历史方案、归档、参考、压缩/清理 | `src/features/plans/plan-history.js` |
| 课表上传、识别、核对 | `src/features/courses/course-import.js`、`course-recognition.js`、`course-clipboard.js`、`course-review.js` |
| 通用弹窗/提示 | `src/components/ui/primitives.js`、`notifications.js`、`surfaces.js` |
| 完成票据 | `src/components/tasks/completion-ticket.js`、`src/styles/components/completion-ticket.css` |
| 拖动、删除、撤销 | `src/features/tasks/task-drag.js`、`task-delete.js` |
| 欢迎页与登录动效 | `src/pages/landing/landing-page.js`、`login-motion.js`、`src/effects/grid-distortion.js` |
| WebGL 导航动效 | `src/effects/gooey-navigation.js` |
| React 外框、等待/错误提示 | `src/app/AgentApp.jsx`、`src/styles/shell.css` |

全局主题并不意味着所有艺术配色都应变成同一个颜色。花卉图片、四象限、票据、shader 和局部渐变仍在各自模块中，保持原有设计；React 外框是另一个文档，不会自动继承 iframe 的主题变量。局部颜色需要沿表中模块检查，不能仅改 `--green` 就假定所有画面会一起变化。

## 4. 为什么保留多层样式

原页面经历过多轮视觉迭代，后面的规则会覆盖前面的规则。直接合并同名选择器、移除 !important 或重排媒体查询，可能改变桌面/窄屏/悬停状态。

本轮将它们按用途拆成文件，保留原顺序，由 `src/app/assets.mjs` 的 `styles` 集中登记。主要顺序为：

```text
主题 → 基础 → 日历/时间轴 → 任务交互/旧票据 → 登录
→ 导航/头部/画廊 → 既有调色和编辑式布局 → 行为效果/当天弹窗
→ 工作台扩展 → 四象限/材质/报告/票据/计划首屏 → 最终可读性
```

这不是新设计系统，也不是所有历史覆盖已消失。相同的圆角、间距及字体值已通过变量复用；其余有视觉意义的覆盖被明确保留。修改某个样式时应搜索该选择器的所有定义，再决定改基础层还是最终覆盖层。不要继续随意在最后一个文件追加补丁。

## 5. 页面、共享状态和接口的关系

- `src/app/router.js`：页面名称与渲染入口的集中登记。回调在实际使用时获取最后生效的页面函数。
- `src/app/page-renderer.js`：基础显示逻辑与保留的早期页面实现，核心分发交给 router。
- `src/app/bootstrap.js`：绑定导航、Escape、页面可见性事件并初次 render。
- `src/state/workspace-state.js`：原 tasks/evidence/page/date 等共享数据；保留样例与访客分支，正式数据仍来自后端。
- `src/state/planning-view.js`：时间轴显示模式、中心日期和案例显示状态；`src/utils/date-time.js` 提供共用日期换算。
- `src/state/local-storage.js`：原浏览器本地键与辅助方法。
- `src/state/persistence.js`：原 saveQueue 与快照保存。**没有改成新的保存协议，也没有修复所有异步保存可靠性问题。**
- `src/api/client.js`：原普通 JSON 请求函数。
- `src/api/dialogue-client.js`：原对话 JSON/SSE 请求、中文分片读取、错误诊断和中断处理。
- `src/features/auth/session.js`：原服务端登录、退出、个人资料保存适配。
- `src/features/agent/agent-bridge.js`：工作台与 React 外框的原 postMessage 通信。
- `src/app/restore-session.js`：读取 /api/me 和 /api/state 恢复个人工作台。

`render/closeModal/report` 等仍有生命周期包装：欢迎页过渡、顶部导航、浮动按钮、报告滚动、完成票据依赖这些包装。它们已分到对应模块，但没有为了“看起来干净”删除。新增行为时，优先在明确模块中处理，避免再新增无说明的同名覆盖。

## 6. 新增页面

1. 在 `src/pages/<功能>/` 新建 kebab-case 文件，例如 `settings-page.js`，定义页面渲染函数。
2. 在 `src/app/assets.mjs` 的 bundles 登记文件，再在 extensions 中安排加载位置。需要旧共享变量的文件应在 workspace.js 之后；需要被包装的基础声明应留在对应工作台片段顺序中。
3. 在 `src/app/router.js` 的 pages 中添加延迟回调，例如 `['settings', () => settingsPage()]`。也可在扩展加载时调用 `StudyPilotRouter.register('settings', settingsPage)`，名称不能重复。
4. 在 workspace.html 实际导航中添加 `data-page="settings"`，点击事件由统一导航绑定处理。
5. 添加必要的页面 CSS，并在 assets.mjs 的 styles 登记；复制文件本身不会使浏览器加载它。
6. 检查顶部导航动效的项目数量边界、未登录处理、页面离开时的 observer/动画清理和浮动按钮可见性。
7. 执行测试、构建，再检查切换、刷新、键盘和窄屏。当前页面选择仍不写入 URL，刷新恢复计划页，不会凭空获得浏览器前进/后退或深链接。

如果新增独立 React 组件，应放在 app 或合适的组件目录并由 React 外框 import。普通工作台脚本不会自动渲染 JSX 文件，不要让 React 和旧脚本同时改同一块 DOM。

## 7. 新增组件和业务功能

公共纯界面放 `src/components/ui/`，任务等专用展示放 `components/tasks/`，业务规则和操作放 `features/<功能>/`，页面只负责组合。保持参数明确，避免每个新函数都直接修改共享数组。

现有候选的 `agent_run_id/proposal_index`、表单的 id/name、`data-task-id/data-drop-q/data-gallery-date` 和页面中的 `#content/#modal-root` 都是功能契约。改布局时保留它们，必要时搜索所有引用后一起修改。不要把仅改变样式的工作与保存协议重写混在一次修改里。

读取核心代码的顺序建议：

```text
app/assets.mjs → app/workspace.html → app/bootstrap.js → app/router.js
→ pages/plan/plan-page.js → components/tasks/task-views.js
→ state/persistence.js → api/client.js
→ features/agent/candidate-review.js → api/dialogue-client.js
```

## 8. 测试与恢复

62 项前端测试包括原有 57 项和 5 项架构/保真检查。保真检查使用 `tests/fixtures/frontend-contract-v1.json`，对比原版的业务语法结构、页面标记、1287 条 CSS 规则顺序与实际值、React 外框和 11 个素材文件。SVG 只忽略 Windows/Linux 的 CRLF/LF 换行差异，二进制图片仍逐字节比较；具体修复见 [CI 换行说明](FRONTEND_CI_FIX.md)。它不是像素级截图测试，也不能替代真实模型验收。

本轮以后主动变更功能或设计时，保真快照可能合理失败。先检查差异和对应行为测试，不要为了通过测试直接替换摘要；有意改变的契约应在评审后更新并记录理由。源码读取助手已避免依赖空格和压缩排版。

备份位于工作区的 `frontend-refactor-baseline-20261114/`（与 github 同级），包含原 frontend、原前端测试所在 unit 目录、基线提交号，以及原版生成产物。没有备份用户密钥或数据库。Git 也保留基线提交。回退时先保存后续工作，仅恢复本轮对应文件；不要使用会删除其他工作区改动的全仓库硬重置。

已知历史问题仍单列保留：快照并发覆盖、部分操作没有等待保存、回收站适配缺口、后端模型连接测试的相对导入、搜索配置作用域等。这次没有擅改后端或掩盖问题。
