// Workspace source fragment: assembled in app/assets.mjs order.
// Shared scope is retained to preserve existing inline events and function hoisting.
const labels = ['重要且紧急', '重要不紧急', '不重要但紧急', '不重要不紧急'];

const abilities = [
  '问题发现与研究设计',
  '计算与系统思维',
  '实验验证与数据素养',
  '批判性与独立思考',
  '信息素养与学术规范',
  '表达协作与反思',
];

const today = new Date().toLocaleDateString('sv-SE');

let date = today,
  page = 'plan',
  importTab = 'text',
  parsed = [],
  filter = -1;

const seed = [
  {
    id: 1,
    title: '数据结构 · 二叉树与遍历',
    date: today,
    start: '08:00',
    end: '09:40',
    location: '教学楼 A-302',
    repeat: '每周六',
    q: 1,
    done: true,
  },
  {
    id: 2,
    title: '数学建模小组讨论',
    date: today,
    start: '14:00',
    end: '15:30',
    location: '图书馆研讨室 203',
    repeat: '不重复',
    q: 0,
    done: false,
  },
  {
    id: 3,
    title: '提交机器学习实验报告',
    date: today,
    ddl: today,
    duration: 90,
    suggest: '10:00 – 11:30',
    ability: 2,
    standard: '完成模型对比、结果分析并提交 PDF',
    q: 0,
    done: false,
  },
  {
    id: 4,
    title: '阅读文献，梳理研究问题',
    date: today,
    ddl: '2026-10-27',
    duration: 60,
    suggest: '16:00 – 17:00',
    ability: 0,
    standard: '整理 3 个研究问题及对应文献依据',
    q: 1,
    done: false,
  },
  {
    id: 5,
    title: '填写学院活动报名表',
    date: today,
    ddl: today,
    duration: 10,
    suggest: '午饭后',
    ability: 5,
    standard: '核对信息并提交报名表',
    q: 2,
    done: false,
  },
  {
    id: 6,
    title: '整理本周学习笔记',
    date: today,
    ddl: '2026-10-30',
    duration: 30,
    suggest: '晚间自由时段',
    ability: 5,
    standard: '补全本周笔记与一段学习反思',
    q: 3,
    done: true,
  },
];

let tasks = readJSON(dataKey('tasks'), localDefault(structuredClone(seed)));

let evidence = readJSON(
  dataKey('evidence'),
  localDefault([
    {
      id: 1,
      title: '机器学习实验：对照实验与误差分析',
      desc: '阶段作品 · 实验报告摘要　→　实验验证与数据素养',
      dim: 2,
      status: '待确认',
      body: '使用一致的数据划分完成三个模型的对照实验，记录误差并讨论局限。',
    },
    {
      id: 2,
      title: '文献检索记录与引用清单',
      desc: '学习记录 · 文献阅读　→　信息素养与学术规范',
      dim: 4,
      status: '待观察',
      body: '整理检索关键词与引用来源，尚需核对引用是否完整。',
    },
  ]),
);

let confirmed = activeAccount ? [0, 0, 0, 0, 0, 0] : [4, 6, 3, 2, 5, 4];

function save() {
  try {
    localStorage.setItem(dataKey('tasks'), JSON.stringify(tasks));
    localStorage.setItem(dataKey('evidence'), JSON.stringify(evidence));
    return true;
  } catch {
    toast('浏览器存储不可用或空间已满，当前更改未保存');
    return false;
  }
}
