const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
test('时间校验通过模态弹窗显示，关闭后返回表单，成功消息保留轻提示',()=>{
 let dialog,focused=false;const messages=[];
 const previous={isConnected:true,focus(){focused=true}};
 const document={activeElement:previous,querySelector:()=>dialog?.removed?null:dialog,body:{appendChild:node=>dialog=node}};
 // 关闭事件单独保存，避免与dialog.close方法同名。
 document.createElement=()=>{const children={'h2':{},'p':{}};return {setAttribute(){},querySelector:tag=>children[tag],addEventListener(type,callback){this['on'+type]=callback},showModal(){this.open=true},remove(){this.removed=true},close(){this.open=false;this.onclose?.()},children}};
 const state={document,toast:message=>messages.push(message)};vm.createContext(state);vm.runInContext(readFileSync('frontend/public/notifications.js','utf8'),state);
 state.toast('结束时间需晚于开始时间');assert.equal(dialog.open,true);assert.equal(dialog.className,'study-alert');assert.equal(dialog.children.p.textContent,'结束时间需晚于开始时间');assert.equal(messages.length,0);
 dialog.close();assert.equal(focused,true);
 state.toast('已保存任务');assert.deepEqual(messages,['已保存任务']);
});
