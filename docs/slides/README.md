# StudyPilot 答辩幻灯片

本目录存放 StudyPilot 小组项目的 Slidev 答辩幻灯片源码、图片与构建配置。

正文使用中文，页面主标题使用英文，架构与流程图使用 Mermaid。

## 汇报安排

- 产品与技术汇报：8 分钟
- 功能演示：2 分钟
- 评委问答：5 分钟

内容涵盖产品设计、系统实现、智能体任务编排、工具调用、记忆、护栏、知识协作、数据库与接口、质量检查及团队贡献。

## 目录结构

```text
docs/slides/
├── README.md              # 幻灯片说明
├── slides.md              # Slidev 入口与页面正文
├── package.json           # 依赖与构建命令
├── package-lock.json      # npm 依赖锁定文件
└── public/
    └── images/            # 截图及图片素材

.github/workflows/
└── deploy-slides.yml       # 自动构建、PDF 导出与发布配置
```

以上为目标结构，源码、素材与工作流将分步上传。

## 项目仓库结构

```text
agent-practice-demo/
├── code/
│   ├── frontend/          # 前端工作台
│   ├── backend/           # 后端接口、业务服务与数据访问
│   └── core_engine/       # 智能体工作流、工具、提示词与 Skill
├── docs/
│   ├── requirements/      # 需求与用户故事
│   ├── algorithm/         # 算法与智能体设计记录
│   ├── software/          # 软件设计、运行与验证文档
│   ├── mgmt/              # 项目管理资料
│   ├── retrospection/     # 复盘资料
│   └── slides/            # 本答辩幻灯片
└── tests/
    ├── unit/              # 单元测试
    └── integration/       # 集成测试
```

## 在线编辑方式

1. 在 GitHub 的 develop 分支编辑 `docs/slides/slides.md`。
2. 图片上传到 `docs/slides/public/images/`。
3. 在幻灯片中使用 `/images/文件名.png` 引用图片。
4. 提交修改后，由 GitHub Actions 构建与检查。
5. 在线地址、PDF 和构建产物入口在首次部署成功后补充。

GitHub 网页负责编辑源码，Actions 负责运行构建和导出任务，不需要在本地启动 Slidev。

## 构建与发布状态

当前正在迁移源码与配置，Actions 构建、PDF 导出和 GitHub Pages 发布尚待配置及验证。

工作流完成后，将明确触发分支、在线访问地址与产物下载方式。

不上传 `node_modules/`、本地构建产物、密钥或无关备份文件。

## 材料与引用说明

- 项目实现依据 develop 分支代码及设计文档。
- 截图保留对应检查结果，不将失败或跳过的步骤表述为通过。
- 历史联调记录与本次实测结果分别说明。
- 未实现能力及待补材料明确标注。
- 引用的论文、开源组件与代码来源在幻灯片参考页及相关页面备注中列出。

## 课程参考

- [项目汇报内容要求](https://github.com/bettermorn/ACMWDevHubPPT/blob/master/courseware/创新工程实践营项目汇报内容.md)
- [课程课件目录与 README 参考](https://github.com/bettermorn/ACMWDevHubPPT/tree/master/courseware)
- [课程 Actions 配置参考](https://github.com/bettermorn/ACMWDevHubPPT/tree/master/.github/workflows)
