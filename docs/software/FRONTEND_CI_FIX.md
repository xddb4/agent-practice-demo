# 前端 CI 跨系统换行修复

## 原因

首次 [GitHub 前端检查](https://github.com/xddb4/agent-practice-demo/actions/runs/43575823829) 失败。按 GitHub 的 Linux/LF 检出方式，在独立 Node.js 22 容器中复现：安装和格式检查通过，61 项测试中 60 项通过，素材保真测试失败于 `gallery-floral-1.svg`。

原测试把 Windows 工作区 SVG 的原始字节摘要写入基线。Git 在不同系统检出文本时可能使用 CRLF 或 LF；SVG 的绘图内容相同，但换行字节不同，因此出现误报。这是新增保真检查的跨平台缺陷，不是页面素材被重画或应用无法启动。

## 修改

- `code/frontend/tools/source-contract.mjs`：新增 assetContract，仅将 SVG 的 CRLF 统一为 LF 后计算摘要；JPG/PNG 等二进制素材仍逐字节检查。
- `tests/fixtures/frontend-contract-v1.json`：仅更新 4 个受换行影响的 SVG 摘要，来源为原始基线提交 `800f11a` 的素材，不是把当前任意内容重新当成正确答案。
- `tests/unit/frontend_architecture.test.cjs`：使用新素材检查，增加回归测试，确认 SVG 的换行差异可接受，但真实 SVG 内容变化和二进制字节变化仍会被检出。
- `.gitattributes`：统一前端文本检出为 LF，与 Prettier 一致；图片明确保持二进制处理。

没有修改应用 UI、业务逻辑、API 或数据库，也没有跳过任何失败检查。

## 验证

- Windows：62 项前端测试通过，格式检查和生产构建通过。
- Linux/Node.js 22：使用提交源码的 LF 归档叠加上述修复，npm ci、格式检查、62 项测试、生产构建通过。
- GitHub 上的结果仍需提交并推送本地修复后确认。重新运行旧提交不会包含这些修改。

截图中的 Node.js 20 提示来自 checkout/setup-node 动作运行环境，是单独的弃用警告；本次实际失败是测试退出码 1，不能把该警告当作根因。
