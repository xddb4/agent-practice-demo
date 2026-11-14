const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync('code/frontend/src/api/dialogue-client.js','utf8')+'\n'+readFileSync('code/frontend/src/pages/recommendations/plan-dialogue.js','utf8');
function setup(response){
 const state={fetch:async()=>response,TextDecoder,Uint8Array,esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')};
 vm.createContext(state);vm.runInContext(source,state);return state;
}
test('断流后查询同一后台任务，不重新发送模型请求',async()=>{
 const events=[],calls=[];const state=setup();
 state.fetch=async(path,options)=>{
  calls.push([path,options?.method]);
  if(path.endsWith('/stream'))throw new TypeError('connection lost');
  return {ok:true,json:async()=>({status:'completed',reply:'后台已完成',result:{id:'saved-plan'}})};
 };
 const result=await state.dialogueStreamRequest('agent',{request_id:'same-request'},undefined,event=>events.push(event));
 assert.equal(result.id,'saved-plan');
 assert.deepEqual(calls,[['/api/agent/stream','POST'],['/api/agent-jobs/same-request',undefined]]);
 assert.equal(events[0].text,'后台已完成');
});

test('后端重启导致后台任务中断时，显示明确原因而非无限等待',async()=>{
 const state=setup({ok:true,json:async()=>({status:'interrupted',error:{code:'worker_restarted',reason:'后端服务已重启'}})});
 await assert.rejects(state.waitForDialogueJob('request',undefined,()=>{}),error=>error.code==='worker_restarted');
});
test('流式读取跨字节的中文和心跳，收到完成事件才返回方案',async()=>{
 const bytes=new TextEncoder().encode(': heartbeat\n\ndata: {"type":"reply","text":"你好"}\n\ndata: {"type":"complete","result":{"id":"plan"}}\n\n');
 const events=[];let offset=0;
 const state=setup({ok:true,headers:{get:()=> 'text/event-stream'},body:{getReader:()=>({read:async()=>offset<bytes.length?{value:bytes.slice(offset,offset+=3),done:false}:{done:true},cancel:async()=>{},releaseLock(){}})}});
 const result=await state.dialogueStreamRequest('plans/id/dialogue',{},undefined,event=>events.push(event));
 assert.equal(events[0].text,'你好');assert.equal(result.id,'plan');
});
test('流式连接提前结束时拒绝返回半成品方案',async()=>{
 const bytes=new TextEncoder().encode('data: {"type":"reply","text":"尚未完成"}\n\n');let read=false;
 const state=setup({ok:true,headers:{get:()=> 'text/event-stream'},body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{value:bytes,done:false}),cancel:async()=>{},releaseLock(){}})}});
 await assert.rejects(state.dialogueStreamRequest('plans/id/dialogue',{},undefined,()=>{}),error=>error.code==='stream_interrupted');
});
test('已有长回复按完整句子分段，文字内容保持完整',()=>{
 const state=setup();
 const text=('本周先集中处理长对话中的连读，使用诊断卷A的原文定位漏听，再进行复听验证。').repeat(8);
 const html=state.dialogueReplyHTML(text);
 assert.ok((html.match(/<p>/g)||[]).length>1);
 assert.equal(html.replace(/<[^>]+>/g,''),text);
});
test('回复可显示分点内容，模型文字中的HTML只作为文本显示',()=>{
 const state=setup();
 const html=state.dialogueReplyHTML('1. 先做诊断\n2. 对照原文\n\n<img src=x onerror=alert(1)>');
 assert.ok(html.includes('<ul>')&&html.includes('<li>先做诊断</li>'));
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
});
test('对话保留分类原因与字段问题，失败消息安全展示解决建议',async()=>{
 const detail={code:'invalid_output',title:'方案调整结果校验失败',reason:'模型返回结构不合要求',problems:['调整列表超过上限','<private>'],action:'请重试',request_id:'trace123'};
 const state=setup({ok:false,json:async()=>({detail})});
 let error;try{await state.dialogueRequest('plans/id/dialogue',{})}catch(caught){error=caught}
 assert.equal(error.diagnostic,detail);
 const html=state.dialogueErrorHTML(error);
 for(const text of ['方案调整结果校验失败','调整列表超过上限','请重试','trace123'])assert.ok(html.includes(text));
 assert.ok(html.includes('&lt;private>'));assert.ok(!html.includes('<private>'));
});
test('旧字符串错误仍然可展示且不会被当成结构化诊断',async()=>{
 const state=setup({ok:false,json:async()=>({detail:'相关日程已有更新，请重新发送'})});
 await assert.rejects(state.dialogueRequest('plans/id/dialogue',{}),error=>state.dialogueErrorHTML(error).includes('相关日程已有更新'));
});
test('浏览器断线不会误报模型失败，也不会保证请求没有执行',async()=>{
 const state=setup();state.fetch=async()=>{throw new TypeError('Failed to fetch')};
 await assert.rejects(state.dialogueRequest('plans/id/dialogue',{}),error=>{
  assert.equal(error.code,'backend_connection');
  const html=state.dialogueErrorHTML(error);
  assert.ok(html.includes('请求结果待核对'));assert.ok(!html.includes('本次未保存回复'));
  return true;
 });
});
