const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');

function setup(){
 const root={children:[],replaceChildren(...nodes){for(const node of this.children)node.isConnected=false;this.children=nodes;for(const node of nodes)node.isConnected=true}};
 function field(id,type='text'){return {id,type,value:'',checked:false,tagName:'INPUT',scrollTop:0,scrollLeft:0,getAttribute:()=>null}}
 const makeNode=()=>({
  fields:[field('title'),field('selected','checkbox')],forms:[{dataset:{}}],heading:{innerHTML:'新增任务'},scroll:{scrollTop:0,scrollLeft:0,tagName:'DIV'},handlers:{},classList:{remove(){}},
  querySelector(selector){return selector==='.modal-head h2'?this.heading:null},
  querySelectorAll(selector){return selector==='form'?this.forms:selector==='input,textarea,select'?this.fields:[...this.fields,this.scroll]},
  addEventListener(type,handler){this.handlers[type]=handler},
 });
 const state={activeAccount:{id:'owner'},document:{getElementById:()=>root,createElement:makeNode},requestAnimationFrame:callback=>callback()};
 vm.createContext(state);vm.runInContext(readFileSync('code/frontend/src/components/ui/primitives.js','utf8'),state);
 return {state,root};
}

test('鼠标移出不关闭，点击窗口外关闭，重新打开保留输入选择与滚动',()=>{
 const {state,root}=setup();
 const first=state.modal('<input>');first.fields[0].value='未提交的草稿';first.fields[1].checked=true;first.scroll.scrollTop=123;
 assert.equal(first.handlers.pointerleave,undefined);
 first.handlers.pointerdown({target:first.fields[0]});first.handlers.click({target:first,detail:1});
 assert.equal(root.children[0],first,'从窗口内拖动到外部不误关');
 first.handlers.pointerdown({target:first});first.handlers.click({target:first,detail:1});
 assert.equal(root.children.length,0);
 const restored=state.modal('<input>');
 assert.equal(restored.fields[0].value,'未提交的草稿');assert.equal(restored.fields[1].checked,true);assert.equal(restored.scroll.scrollTop,123);
});

test('对话窗口恢复同一节点，保留事件和附件；账号和刷新隔离草稿',()=>{
 const {state}=setup();const dialogue=state.modal('<form>',{key:'chat',retainNode:true});
 dialogue.files=['image.png'];let count=0;dialogue.handlers.send=()=>count++;
 state.closeModal();assert.equal(state.resumeModal('chat'),true);dialogue.handlers.send();assert.equal(count,1);assert.deepEqual(dialogue.files,['image.png']);
 state.closeModal();state.activeAccount={id:'other'};assert.equal(state.resumeModal('chat'),false);
 assert.equal(setup().state.resumeModal('chat'),false,'刷新后是全新内存状态');
});

test('登录模式切换复用原弹窗，不重新挂载或绑定事件，并保留各模式草稿',()=>{
 const {state,root}=setup();
 const first=state.modal('login');first.fields[0].value='登录草稿';
 const dialog={parentElement:first,set innerHTML(html){first.fields.forEach(field=>field.value='');first.heading.innerHTML=html}};
 first.addEventListener=()=>{throw Error('不应重复绑定遮罩事件')};
 const replace=root.replaceChildren.bind(root);let mounts=0;
 root.replaceChildren=(...nodes)=>{mounts++;replace(...nodes)};
 assert.equal(state.modal('register',{reuseDialog:dialog}),first);
 first.fields[0].value='注册草稿';
 state.modal('login',{reuseDialog:dialog});assert.equal(first.fields[0].value,'登录草稿');
 state.modal('register',{reuseDialog:dialog});assert.equal(first.fields[0].value,'注册草稿');
 assert.equal(mounts,0);assert.equal(root.children[0],first);
 state.closeModal();assert.equal(root.children.length,0);
 const reopened=state.modal('register');assert.notEqual(reopened,first);
 assert.equal(reopened.fields[0].value,'注册草稿');assert.equal(mounts,2);
});

test('成功提交后清理表单草稿，重新打开不会带回已提交内容',()=>{
 const {state}=setup();const first=state.modal('<input>',{key:'edit'});first.fields[0].value='已保存内容';
 state.discardModalDraft();state.closeModal();
 assert.equal(state.modal('<input>',{key:'edit'}).fields[0].value,'');
});

test('恢复编辑窗口时保留原任务标识，不误变成新增任务',()=>{
 const {state}=setup();const edit=state.modal('<form>',{key:'task-edit:7'});
 edit.forms[0].dataset.editId='7';edit.heading.innerHTML='编辑任务';edit.fields[0].value='修改中的原任务';
 state.closeModal();state.resumeModal('task-edit:7');
 const restored=state.modal('<form>',{key:'task-edit:7'});
 assert.equal(restored.forms[0].dataset.editId,'7');assert.equal(restored.heading.innerHTML,'编辑任务');assert.equal(restored.fields[0].value,'修改中的原任务');
});

test('本次页面内推荐入口恢复原对话，显式新建和新文档使用新入口',()=>{
 const source=readFileSync('code/frontend/src/pages/recommendations/plan-dialogue.js','utf8');
 const state={Map,activeAccount:{id:'owner'},crypto:{randomUUID:()=> 'fresh-id'},uiSymbol:()=>'<svg></svg>'};
 vm.createContext(state);vm.runInContext(source,state);
 state.monitorDialogueActivity=()=>{};
 let resumed;state.resumeModal=key=>{resumed=key;return true};
 const workspace=state.dialogueWorkspaceState();workspace.last='plan:one';workspace.sessions.set('plan:one',{key:'dialogue:plan:one'});
 state.openPlanDialogue();assert.equal(resumed,'dialogue:plan:one');
 state.modal=()=>{throw new Error('new-window')};
 assert.throws(()=>state.openPlanDialogue(null,null,{newConversation:true}),/new-window/);
 assert.equal(workspace.last,'new:fresh-id');
 const fresh={Map,activeAccount:{id:'owner'}};vm.createContext(fresh);vm.runInContext(source,fresh);
 assert.equal(fresh.dialogueWorkspaceState().last,null);
});

test('动效包装层转发窗口状态选项并保留返回值',()=>{
 const source=readFileSync('code/frontend/src/layouts/editorial-effects.js','utf8');
 const fragment=source.slice(source.indexOf('const modalBeforeEditorial'),source.indexOf('const renderBeforeEditorial'));
 const options={key:'chat',retainNode:true},node={};let received;
 const state={modal:(html,value)=>{received=value;return node},decorateEditorialButtons(){},document:{getElementById(){return {}}}};
 vm.createContext(state);vm.runInContext(fragment,state);
 assert.equal(state.modal('content',options),node);assert.equal(received,options);
});
