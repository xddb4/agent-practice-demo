# StudyPilot 前端

使用 Node.js 22，运行 `npm ci`，再运行 `npm run dev`。完整应用后端仍通过仓库根目录的启动脚本运行。

- `src/app/assets.mjs`：脚本、样式及执行顺序的唯一资源清单。
- `src/app/workspace.html`：工作台静态骨架。
- `src/app/router.js`：页面登记；`bootstrap.js` 负责初始导航和显示。
- `src/pages/`：页面；`features/`：业务操作；`components/`：公共或业务 UI。
- `src/state/`：保留现有共享状态与保存队列；`api/`：请求与流式传输。
- `src/styles/theme.css`：全局设计变量；其他样式保持原设计和层叠顺序。
- `src/effects/`：保留的独立 WebGL 动效。

`public/` 根目录的 JS/CSS、prototype.html 和 `dist/` 是生成物；请修改 src。`public/assets/` 是需要提交的原始图片素材。

运行 `npm test`、`npm run format:check`、`npm run build` 检查修改。

完整操作说明和逐页面修改入口见 [前端开发指南](../../docs/software/FRONTEND_GUIDE.md)，目录树、文件清单和验收边界见 [重构交付报告](../../docs/software/FRONTEND_REFACTOR_REPORT.md)。
