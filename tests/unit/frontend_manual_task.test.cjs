const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSource, namedFunction } = require('./frontend-source.cjs');

test('手动新增沿用文字识别的 schedule 路由，先核对、不直接保存', () => {
  const fields = {'f-title':'复习递归','f-description':'画出调用树','f-type':'flex','f-date':'2026-11-23','f-q':'1','f-ddl':'2026-11-25','f-duration':'30','f-suggest':'','f-ability':'-1'};
  let request;
  const state = {val:id=>fields[id],askAgent:(...args)=>request=args,toast(){},commitParsed(){throw Error('不应直接保存')}};
  vm.createContext(state);
  vm.runInContext(namedFunction(readSource('features/tasks/task-import.js'),'manualSubmit'),state);
  state.manualSubmit({preventDefault(){}});
  assert.equal(request[0],'schedule');
  const task=JSON.parse(request[1].split('任务：')[1]);
  assert.equal(task.title,'复习递归');assert.equal(task.date,'2026-11-23');
  assert.equal(task.duration,30);assert.equal(task.q,1);
  assert.equal(task.description,'画出调用树');
  assert.match(request[1],/建议完成时间与能力关联/);
});

test('切换象限更新表单值、椭圆标记并仅触发一次分类动作', () => {
  const hidden={value:'0'},summary={innerHTML:''};
  const picker={open:true,querySelector:selector=>selector==='input'?hidden:summary};
  const state={pill:q=>'<span class="pill p'+q+'"></span>'};
  vm.createContext(state);vm.runInContext(namedFunction(readSource('components/ui/primitives.js'),'pickQuadrant'),state);
  let calls=0;
  state.pickQuadrant({closest:()=>picker},2,q=>{assert.equal(q,2);calls++});
  assert.equal(hidden.value,'2');assert.match(summary.innerHTML,/p2/);assert.equal(picker.open,false);assert.equal(calls,1);
});
