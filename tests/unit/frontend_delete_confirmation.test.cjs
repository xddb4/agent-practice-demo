const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readSource,statementRange,namedFunction}=require('./frontend-source.cjs');

test('点击删除先确认，取消或确认期间任务变化时不删除',async()=>{
 let removed=0;
 const state={tasks:[{id:1,title:'课程',start:'08:00'}],removeTask(){removed++},dataKey:()=> 'owner',confirmStudyAction:async()=>false,toast(){}};
 vm.createContext(state);vm.runInContext(statementRange(readSource('features/tasks/task-delete.js'),'removeOriginalTask','animateConversationDeletion'),state);
 await state.removeTask(1);assert.equal(removed,0);
 state.confirmStudyAction=async()=>{state.tasks[0].title='新名称';return true};
 await state.removeTask(1);assert.equal(removed,0);
 state.confirmStudyAction=async()=>true;
 await state.removeTask(1);assert.equal(removed,1);
});

test('对话复用碎纸动效时只调用对话回调，不提交任务删除',()=>{
 const state={shredJob:null,tasks:[{id:1,title:'保留任务'}],dataKey:()=> 'owner',innerWidth:1200,innerHeight:800,window:{matchMedia:()=>({matches:true})},document:{getElementById:()=>null},commitShredDelete(){throw Error('不应删除任务')}};
 vm.createContext(state);vm.runInContext(namedFunction(readSource('features/tasks/task-delete.js'),'shredTask'),state);
 let calls=0;
 state.shredTask(null,{textContent:'聊天',getBoundingClientRect:()=>({height:70})},null,()=>calls++);
 assert.equal(calls,1);assert.equal(state.tasks.length,1);
});
