const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync('frontend/src/pages/AgentApp.jsx','utf8');
const start=source.indexOf('async function runAgent(');
const end=source.indexOf('\n useEffect(',start);
assert.ok(start>=0&&end>start,'找不到 Agent 请求函数');
const run=source.slice(start,end);
function fixture(configured){
 const calls=[],messages=[];
 const state={AbortController,activeRequest:{current:null},requestData:{current:null},location:{origin:'http://localhost'},frame:{current:{contentWindow:{postMessage:value=>messages.push(value)}}},setRequest(){},setError(){},setElapsed(){},setBusy(){},toDiagnostic:e=>e,
  cancel(){state.activeRequest.current?.abort();state.activeRequest.current=null},
  async fetch(path){calls.push(path);return {ok:true,json:async()=>path.endsWith('model-settings')?{configured}:{id:'candidate'}}}};
 vm.createContext(state);vm.runInContext(run,state);return {state,calls,messages};
}
test('未配置时打开设置面板，不发出 Agent 请求',async()=>{
 const {state,calls,messages}=fixture(false);
 await state.runAgent({payload:{text:'准备考试',route:'recommend'}});
 assert.deepEqual(calls,['/api/model-settings']);assert.equal(messages[0].type,'open-model-settings');
});
test('配置后先检查再生成，并传递结果给唯一的核对界面',async()=>{
 const {state,calls,messages}=fixture(true);
 await state.runAgent({payload:{text:'安排会议',route:'schedule'}});
 assert.deepEqual(calls,['/api/model-settings','/api/agent']);assert.equal(messages[0].type,'agent-result');
});
