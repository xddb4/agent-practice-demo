# 前端规范化重构交付报告

日期：2026-11-14。所有路径相对 github 仓库根目录。

## 1. 重构结果与完整目录结构

本轮完成源码组织、入口注册、样式/主题、请求与状态分离、格式、构建与验证工具的渐进整理。原 UI、页面标记、业务数据转换和通信协议保持不变。React 外壳和 iframe 继续保留；没有声称完成全量 React 迁移。

源码基线为 `800f11a34b85e4e8bde90e05da6f90aecff4282f`。修改前已记录计划，原前端及测试备份位于仓库外 `../frontend-refactor-baseline-20261114/`。没有修改 code/backend、code/core_engine 源码或 compose 数据卷配置。

以下为完整前端源码与配置树；省略 node_modules、dist 和 public 根生成文件，public/assets 为保留的原始素材：

```text
code/frontend/
├─ public/
│  └─ assets/
│     ├─ dialog-floral-soft.svg
│     ├─ dialog-floral.jpg
│     ├─ floral-background.jpg
│     ├─ floral-scene.jpg
│     ├─ frosted-glass.jpg
│     ├─ gallery-floral-1.svg
│     ├─ gallery-floral-2.svg
│     ├─ gallery-floral-3.svg
│     ├─ gallery-floral-4.svg
│     ├─ ticket-blue-gold.jpg
│     └─ workspace-glass.svg
├─ src/
│  ├─ api/
│  │  ├─ client.js
│  │  └─ dialogue-client.js
│  ├─ app/
│  │  ├─ AgentApp.jsx
│  │  ├─ assets.mjs
│  │  ├─ bootstrap.js
│  │  ├─ page-renderer.js
│  │  ├─ restore-session.js
│  │  ├─ router.js
│  │  └─ workspace.html
│  ├─ components/
│  │  ├─ quadrants/
│  │  │  └─ spheres.js
│  │  ├─ report/
│  │  │  └─ report-scroll.js
│  │  ├─ tasks/
│  │  │  ├─ completion-ticket.js
│  │  │  ├─ date-gallery.js
│  │  │  ├─ star-border.js
│  │  │  ├─ task-description.js
│  │  │  ├─ task-views.js
│  │  │  └─ timeline-view.js
│  │  └─ ui/
│  │     ├─ notifications.js
│  │     ├─ primitives.js
│  │     └─ surfaces.js
│  ├─ effects/
│  │  ├─ gooey-navigation.js
│  │  └─ grid-distortion.js
│  ├─ features/
│  │  ├─ agent/
│  │  │  ├─ agent-bridge.js
│  │  │  └─ candidate-review.js
│  │  ├─ auth/
│  │  │  └─ session.js
│  │  ├─ calendar/
│  │  │  └─ calendar.js
│  │  ├─ courses/
│  │  │  ├─ course-clipboard.js
│  │  │  ├─ course-import.js
│  │  │  ├─ course-recognition.js
│  │  │  └─ course-review.js
│  │  ├─ evidence/
│  │  │  ├─ evidence-inbox.js
│  │  │  └─ evidence-submit.js
│  │  ├─ plans/
│  │  │  ├─ plan-history.js
│  │  │  └─ recommendation-adapter.js
│  │  └─ tasks/
│  │     ├─ completion-legacy.js
│  │     ├─ task-actions.js
│  │     ├─ task-adapters.js
│  │     ├─ task-delete.js
│  │     ├─ task-drag.js
│  │     ├─ task-editor.js
│  │     ├─ task-import.js
│  │     └─ task-selectors.js
│  ├─ layouts/
│  │  ├─ editorial-effects.js
│  │  ├─ plan-scene.js
│  │  ├─ top-navigation.js
│  │  └─ workspace-navigation.js
│  ├─ pages/
│  │  ├─ landing/
│  │  │  ├─ landing-page.js
│  │  │  └─ login-motion.js
│  │  ├─ personal/
│  │  │  ├─ model-settings.js
│  │  │  └─ personal-page.js
│  │  ├─ plan/
│  │  │  └─ plan-page.js
│  │  ├─ quadrants/
│  │  │  ├─ quadrant-page.js
│  │  │  └─ suggestions-legacy.js
│  │  ├─ recommendations/
│  │  │  ├─ plan-dialogue.js
│  │  │  └─ recommendation-legacy.js
│  │  └─ report/
│  │     ├─ report-legacy.js
│  │     └─ report-page.js
│  ├─ state/
│  │  ├─ local-storage.js
│  │  ├─ persistence.js
│  │  ├─ planning-view.js
│  │  └─ workspace-state.js
│  ├─ styles/
│  │  ├─ components/
│  │  │  ├─ action-effects.css
│  │  │  ├─ completion-ticket.css
│  │  │  ├─ gooey-navigation.css
│  │  │  ├─ spheres.css
│  │  │  ├─ surfaces.css
│  │  │  ├─ task-delete.css
│  │  │  ├─ task-drag.css
│  │  │  └─ ticket-legacy.css
│  │  ├─ layouts/
│  │  │  ├─ editorial.css
│  │  │  ├─ header.css
│  │  │  └─ workspace-palette.css
│  │  ├─ pages/
│  │  │  ├─ calendar-import.css
│  │  │  ├─ date-gallery.css
│  │  │  ├─ day-popup.css
│  │  │  ├─ landing-distortion.css
│  │  │  ├─ landing.css
│  │  │  ├─ plan-scene.css
│  │  │  ├─ report-scroll.css
│  │  │  └─ timeline.css
│  │  ├─ base.css
│  │  ├─ readability.css
│  │  ├─ shell.css
│  │  ├─ theme.css
│  │  └─ workspace.css
│  ├─ types/
│  │  └─ domain.d.ts
│  └─ utils/
│     └─ date-time.js
├─ tools/
│  ├─ build-workspace.mjs
│  └─ source-contract.mjs
├─ .gitignore
├─ .prettierignore
├─ .prettierrc.json
├─ build.mjs
├─ index.html
├─ package-lock.json
├─ package.json
├─ README.md
└─ vite.config.mjs
```

主要分工：app 是启动、页面登记、资源顺序和骨架；pages 是页面显示；layouts 是跨页面布局与滚动行为；components 是公共/业务 UI；features 是任务、证据、课表、方案等操作；api 是请求；state 是兼容状态与保存；utils 是纯日期工具；effects 是原动效引擎；styles 是按用途分层的样式；types 保留原类型说明。tools 是构建和保真检查。

## 2. 文件修改、迁移与保留清单

### 2.1 直接迁移的原文件

迁移前后映射如下。旧位置从工作树移除，代码在新位置保留，没有删除对应功能；同一内容在 Git 中仍可追溯。

| 原路径 | 新路径 | 调整原因 |
|---|---|---|
| `code/frontend/src/components/features.js` | `code/frontend/src/features/tasks/task-adapters.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/notifications.js` | `code/frontend/src/components/ui/notifications.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/review.js` | `code/frontend/src/features/agent/candidate-review.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/pages/plans.js` | `code/frontend/src/features/plans/plan-history.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/clipboard.js` | `code/frontend/src/features/courses/course-clipboard.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/task_views.js` | `code/frontend/src/components/tasks/task-views.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/pages/model_settings.js` | `code/frontend/src/pages/personal/model-settings.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/pages/quadrant_view.js` | `code/frontend/src/pages/quadrants/quadrant-page.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/pages/evidence_inbox.js` | `code/frontend/src/features/evidence/evidence-inbox.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/course_review.js` | `code/frontend/src/features/courses/course-review.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/navigation.js` | `code/frontend/src/layouts/workspace-navigation.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/spheres.js` | `code/frontend/src/components/quadrants/spheres.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/surfaces.js` | `code/frontend/src/components/ui/surfaces.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/report_scroll.js` | `code/frontend/src/components/report/report-scroll.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/completion_ticket.js` | `code/frontend/src/components/tasks/completion-ticket.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/components/plan_scene.js` | `code/frontend/src/layouts/plan-scene.js` | 迁移并格式化，保留原行为 |
| `code/frontend/src/pages/AgentApp.jsx` | `code/frontend/src/app/AgentApp.jsx` | 迁移并格式化，保留原行为 |
| `code/frontend/src/progress.css` | `code/frontend/src/styles/shell.css` | 迁移并格式化，保留原行为 |
| `code/frontend/src/styles/spheres.css` | `code/frontend/src/styles/components/spheres.css` | 迁移并格式化，保留原行为 |
| `code/frontend/src/styles/surfaces.css` | `code/frontend/src/styles/components/surfaces.css` | 迁移并格式化，保留原行为 |
| `code/frontend/src/styles/report_scroll.css` | `code/frontend/src/styles/pages/report-scroll.css` | 迁移并格式化，保留原行为 |
| `code/frontend/src/styles/completion_ticket.css` | `code/frontend/src/styles/components/completion-ticket.css` | 迁移并格式化，保留原行为 |
| `code/frontend/src/styles/plan_scene.css` | `code/frontend/src/styles/pages/plan-scene.css` | 迁移并格式化，保留原行为 |
| `code/frontend/src/styles/readability.css` | `code/frontend/src/styles/readability.css` | 保留路径，格式化并复用主题变量 |
| `code/frontend/src/styles/ui.css` | `code/frontend/src/styles/workspace.css` | 迁移并格式化，保留原行为 |

原 features.js 后续又拆出任务执行说明、证据附件提交和课表识别，最终顺序见资源清单。原 task_views.js 又拆出时间轴显示与任务筛选规则。以上旧路径到新路径是主要入口映射，不意味着每个原文件永远只对应一个新文件。

### 2.2 大 HTML 的拆分

原 `src/pages/StudyPilot.html` 的静态页面成为 `src/app/workspace.html`；内联样式成为下表的主题、基础、页面及组件样式；两个 WebGL 引擎成为 `effects/grid-distortion.js`、`effects/gooey-navigation.js`；本地键和账号辅助成为 `state/local-storage.js`。原主要工作台按以下顺序拆分，构建时仍合并成同一个普通脚本以保持作用域及声明提升：

| 顺序 | 工作台源文件 |
|---|---|
| 1 | `code/frontend/src/state/workspace-state.js` |
| 2 | `code/frontend/src/components/ui/primitives.js` |
| 3 | `code/frontend/src/features/tasks/task-actions.js` |
| 4 | `code/frontend/src/app/page-renderer.js` |
| 5 | `code/frontend/src/features/calendar/calendar.js` |
| 6 | `code/frontend/src/features/courses/course-import.js` |
| 7 | `code/frontend/src/features/tasks/task-import.js` |
| 8 | `code/frontend/src/pages/report/report-legacy.js` |
| 9 | `code/frontend/src/pages/recommendations/recommendation-legacy.js` |
| 10 | `code/frontend/src/pages/personal/personal-page.js` |
| 11 | `code/frontend/src/state/planning-view.js` |
| 12 | `code/frontend/src/utils/date-time.js` |
| 13 | `code/frontend/src/pages/plan/plan-page.js` |
| 14 | `code/frontend/src/features/tasks/task-editor.js` |
| 15 | `code/frontend/src/features/tasks/task-drag.js` |
| 16 | `code/frontend/src/features/tasks/completion-legacy.js` |
| 17 | `code/frontend/src/features/tasks/task-delete.js` |
| 18 | `code/frontend/src/pages/landing/landing-page.js` |
| 19 | `code/frontend/src/layouts/top-navigation.js` |
| 20 | `code/frontend/src/components/tasks/date-gallery.js` |
| 21 | `code/frontend/src/pages/landing/login-motion.js` |
| 22 | `code/frontend/src/layouts/editorial-effects.js` |
| 23 | `code/frontend/src/components/tasks/star-border.js` |
| 24 | `code/frontend/src/pages/quadrants/suggestions-legacy.js` |
| 25 | `code/frontend/src/app/bootstrap.js` |

### 2.3 接口与状态拆分

原 bridge.js 保留公共 URL，但由以下源文件按原顺序组成：

- `code/frontend/src/api/client.js`
- `code/frontend/src/state/persistence.js`
- `code/frontend/src/features/auth/session.js`
- `code/frontend/src/features/agent/agent-bridge.js`
- `code/frontend/src/pages/report/report-page.js`
- `code/frontend/src/features/plans/recommendation-adapter.js`
- `code/frontend/src/app/restore-session.js`

原 plan_dialogue.js 中的真实 JSON/SSE 请求移到 `src/api/dialogue-client.js`，UI 留在 `src/pages/recommendations/plan-dialogue.js`；合并产物仍使用原 URL。没有用模拟数据代替模型、搜索或后端。

### 2.4 新增与修改的基础文件

| 文件 | 用途与原因 |
|---|---|
| src/app/assets.mjs | 集中登记全部运行脚本、顺序和样式；新增普通源码必须登记 |
| src/app/router.js | 集中登记页面，延迟调用最终实现，统一静态导航按钮绑定 |
| src/app/bootstrap.js | 将原首屏显示和导航/键盘/可见性初始化明确分离 |
| src/styles/theme.css | 合并最终有效的根变量；共用字体、文字色、圆角与间距，不改变取值 |
| tools/build-workspace.mjs | 替代构建期业务字符串改写，保留公共资源路径及内容版本参数 |
| build.mjs | 保留原 CLI 入口，转调新构建器 |
| vite.config.mjs | 开发时生成/监听工作台，并代理真实 /api 请求到原后端 |
| package.json / package-lock.json | npm 安装、测试、格式检查、构建和预览入口；锁定安装结果 |
| .prettierrc.json / .prettierignore | 统一排版，HTML 采用保守空白处理以保护现有显示 |
| .gitignore（前端及仓库） | 排除依赖、产物、临时验收文件，保留原始素材 |
| Dockerfile | 前端阶段改为按锁文件 npm ci；Python 阶段和接口不变 |
| tests/run-frontend.mjs | 从前端目录或仓库根目录运行同一套测试 |
| tests/unit/frontend-source.cjs | 按语法节点读取函数和资源片段，避免测试依赖压缩排版 |
| tests/unit/frontend_architecture.test.cjs | 页面登记、资源覆盖、构建和原版等价性检查 |
| tests/fixtures/frontend-contract-v1.json / tools/source-contract.mjs | 原版结构与素材摘要；检测重构是否改变原代码、样式或页面 |
| .github/workflows/frontend.yml | 新增 npm 安装、格式、测试和构建的 CI 配置 |
| README.md / code/frontend/README.md / 本文及开发指南 | 更新实际入口与后续开发流程 |

原 13 个 frontend_*.test.cjs 仅更新迁移后的读取路径和易碎的源码提取方式，原 57 项行为断言保留。新增 4 项架构检查后合计 61 项。

旧 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 已在完整备份后移除，原因是原容器实际使用 npm，原 pnpm 锁与新增依赖无法同时作为唯一安装依据。现统一 npm 与 package-lock，不再维护两套锁。

### 2.5 样式层顺序

保持 1287 条原有效规则的顺序与值；原始 :root 值合并到 theme，引用相同字体、圆角和间距的位置使用变量。历史覆盖与 !important 没有盲删。

以下源路径相对 code/frontend：

| 顺序 | 源文件 | 生成 URL |
|---|---|---|
| 1 | `src/styles/theme.css` | `/theme.css` |
| 2 | `src/styles/base.css` | `/base.css` |
| 3 | `src/styles/pages/calendar-import.css` | `/pages-calendar-import.css` |
| 4 | `src/styles/pages/timeline.css` | `/pages-timeline.css` |
| 5 | `src/styles/components/task-drag.css` | `/components-task-drag.css` |
| 6 | `src/styles/components/ticket-legacy.css` | `/components-ticket-legacy.css` |
| 7 | `src/styles/components/task-delete.css` | `/components-task-delete.css` |
| 8 | `src/styles/pages/landing.css` | `/pages-landing.css` |
| 9 | `src/styles/components/gooey-navigation.css` | `/components-gooey-navigation.css` |
| 10 | `src/styles/layouts/header.css` | `/layouts-header.css` |
| 11 | `src/styles/pages/date-gallery.css` | `/pages-date-gallery.css` |
| 12 | `src/styles/layouts/workspace-palette.css` | `/layouts-workspace-palette.css` |
| 13 | `src/styles/layouts/editorial.css` | `/layouts-editorial.css` |
| 14 | `src/styles/pages/landing-distortion.css` | `/pages-landing-distortion.css` |
| 15 | `src/styles/components/action-effects.css` | `/components-action-effects.css` |
| 16 | `src/styles/pages/day-popup.css` | `/pages-day-popup.css` |
| 17 | `src/styles/workspace.css` | `/ui.css` |
| 18 | `src/styles/components/spheres.css` | `/spheres.css` |
| 19 | `src/styles/components/surfaces.css` | `/surfaces.css` |
| 20 | `src/styles/pages/report-scroll.css` | `/report_scroll.css` |
| 21 | `src/styles/components/completion-ticket.css` | `/completion_ticket.css` |
| 22 | `src/styles/pages/plan-scene.css` | `/plan_scene.css` |
| 23 | `src/styles/readability.css` | `/readability.css` |

React 外框单独 import styles/shell.css。素材 11 个文件保持字节一致。shader/票据/花卉等艺术配色继续归本模块，避免改变现有设计。

## 3. 架构变化与兼容边界

重构前：一个 HTML 混合骨架、样式、动效和业务，build.mjs 替换其中的业务字符串，多处页面分发依赖全局函数覆盖。

重构后：骨架与样式分开；业务和显示按职责分目录；资源与样式顺序在一个清单登记；页面名与分发集中在 router；原字符串转换结果已落实进源码，构建器不再通过匹配 UI 文案来改变功能；开发模式可以直接运行并访问真实 API。

真正改变的业务分发点只有：基础 render 将选择页面交给 router；原导航按钮绑定交给 router.bindNavigation。原转场、焦点、浮动按钮、报告滚动、票据等生命周期包装仍保留。

仍使用共享 tasks/evidence/page 等变量，仍有兼容包装，仍以原快照协议保存。普通源码片段不等于独立 ES 模块，更不等于全部 React 组件。保留这些边界是为了先完成可验证的整理，不进行高风险的全量重写。

## 4. UI 修改入口与后续开发

- 全局主题、主配色、共用字体、间距和圆角：`code/frontend/src/styles/theme.css`。
- 基础标签、按钮、卡片和表单：`styles/base.css`；当前视觉覆盖检查 `layouts/editorial.css`、`workspace.css` 和 `readability.css`。
- 页面静态结构：`src/app/workspace.html`。日计划：`pages/plan/plan-page.js` + `layouts/plan-scene.js`；四象限：`pages/quadrants/quadrant-page.js`；推荐：`pages/recommendations/plan-dialogue.js`；报告：`pages/report/report-page.js`；个人空间：`pages/personal/personal-page.js`。
- 通用 UI：`components/ui/`；任务卡：`components/tasks/task-views.js`；筛选排序：`features/tasks/task-selectors.js`；导航：`layouts/top-navigation.js` + `layouts/workspace-navigation.js` + `effects/gooey-navigation.js`。
- 新页面：pages 新文件 → assets 登记 → router 登记 → 骨架加 data-page → 注册样式 → 测试。
- 新组件：通用展示放 components，操作和规则放 features；按资源清单安排依赖。不要直接编辑 public 根生成文件或 dist。

详细的逐页面入口、学习顺序、安装与新增示例见 [前端开发指南](FRONTEND_GUIDE.md)。

## 5. 实际验证结果

### 自动验证

- 原 57 项前端测试全部通过；新增 4 项后共 61 项通过。
- 22 个原运行脚本（含原 4 个内联脚本）按解析后的结构比较，保留实际业务与动效；页面分发的两处有意改动另有功能测试。
- 原页面标签、属性与文字结构一致；React 外框除样式导入路径和格式外保持一致。
- 1287 条 CSS 规则在展开主题变量及规范化数字/引号后，选择器、值、important、媒体查询及顺序一致；这不等于像素级截图差分。
- 11 个原图片/SVG 素材摘要一致。
- 所有普通脚本均登记，独立脚本和合并产物语法通过；构建器从任意工作目录生成的资源和版本链接检查通过。
- Windows 上依赖安装及生产构建成功。第一次 npm ci 因开发服务器占用 Rollup 原生文件失败，关闭该服务器后重装成功。
- Docker/Linux 的 npm ci、Vite 构建、Compose 启动成功；8000 首页 200，API health 为 ok，web/db 健康。原 PostgreSQL 和附件卷保持使用。
- 新增工具依赖 PostCSS 的审计告警已在同主版本内修复至 8.5.33；最后一次 npm audit 为 0 项已知漏洞。正式 prototype.html 引用的 46 个 JS/CSS 资源均检查返回 200。
- 已配置 CI，但本次未在远程 GitHub 执行；不能把配置存在当成远程检查已通过。

### 浏览器实际检查

使用旧运行页面作外观基线，另以 5173 开发页面检查入口与 API 代理；写入验收在独立 8001 容器、临时 SQLite、独立测试账号进行，不写入用户主数据库。

实际检查了：欢迎页/登录弹窗；登录恢复；每日计划首屏；新增任务；刷新保留；详情与编辑回填；编辑保存；四象限数量和分类同步；键盘完成票据；完成后待办减少；个人空间；六维报告和横向维度切换；证据接受、已处理记录、修改后回到待确认；推荐工作台；未配置模型的真实错误提示；模型配置读取弹窗；返回导航；滚动场景、任务画廊、回到今天、日历及 ICS 按钮；课表导入、内置示例图片预览和识别按钮状态。检查了 390px 窄屏下已有适配，并恢复默认视口。

检查中未发现新增的 JavaScript 运行错误。一次课表标签的自动定位点击未产生切换，按实际截图坐标点击后正常打开；没有为绕过它修改业务代码。

本地验收日志和计划/四象限截图位于 `code/frontend/.verification/`，该目录不提交 Git。临时测试容器已停止并自动移除；原数据库与附件卷保留。工作期间另外出现的 compose.yaml 注释及 .idea/ 目录属于工作区其他改动，未覆盖或删除。

### 未验证及历史限制

- 未使用真实模型密钥，没有把真实推荐、搜索、视觉识别或长对话成功链路宣称为实测通过。缺少可用测试配置；真实请求与取消逻辑保持原代码，由单元测试覆盖部分边界。
- 未穷举所有鼠标拖动路径、长列表性能、浏览器组合、ICS 文件时区和跨端并发；CSS/脚本等价与现有单测不能替代这些完整 E2E。
- 历史方案真实模型生成后的全链路、附件真实服务识别、完整恢复/并发压力没有新增验收结论。
- 已知回收站适配、异步保存、并发覆盖和后端模型连接测试等原问题未在本轮偷偷修复，也没有删除相关入口。功能保留不等于原缺陷已消失。

## 6. 开发与恢复建议

以后修改 UI 先定位页面/样式层，保护 id/name/data-* 属性；修改业务先定位 features、state、api，不把保存协议改动混进排版调整。运行 npm test、format:check 和 build，再检查桌面/窄屏、键盘、滚动、失败提示和刷新。

保真摘要属于本次迁移的快照，后续有意改变功能或设计时必须先检查差异和相应行为测试，再记录并更新契约；不要机械修改摘要让测试变绿。

原代码可从备份和基线提交恢复。后续若需要回退，先保存新工作，只恢复本轮涉及文件，同时恢复旧 Docker 前端安装配置和测试路径，避免半新半旧。数据库与附件没有迁移，不需要删除数据卷。
