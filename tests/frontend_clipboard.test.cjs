const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');
function setup(){
 const readers=[],nodes={'course-image-preview':{},'course-recognize':{disabled:true}};
 const state={courseImage:null,active:true,openImageImport(){},useDemoCourseImage(){},courseImagePreview:()=>state.courseImage.name,showStudyAlert:message=>state.alert=message,FileReader:class{constructor(){readers.push(this)}readAsDataURL(file){this.result='data:'+file.type+';base64,'+file.name}},document:{addEventListener:(name,handler)=>state[name]=handler,querySelector:()=>state.active?{}:null,getElementById:id=>nodes[id]}};
 vm.createContext(state);vm.runInContext(readFileSync('frontend/public/clipboard.js','utf8'),state);return {state,readers,nodes};
}
function imageEvent(name='screenshot.png',type='image/png'){
 const file={name,type,size:1024};return {clipboardData:{items:[{kind:'file',getAsFile:()=>file}]},preventDefault(){this.prevented=true}};
}
test('课表窗口可直接粘贴图片，预览成功后启用识别',()=>{
 const {state,readers,nodes}=setup(),event=imageEvent();state.paste(event);assert.equal(event.prevented,true);assert.equal(readers.length,1);readers[0].onload();assert.equal(state.courseImage.name,'screenshot.png');assert.equal(nodes['course-recognize'].disabled,false);
});
test('其他页面和纯文本粘贴不会被课表功能拦截',()=>{
 const {state,readers}=setup();state.active=false;const event=imageEvent();state.paste(event);assert.equal(event.prevented,undefined);assert.equal(readers.length,0);
 state.active=true;const text={clipboardData:{items:[]},preventDefault(){this.prevented=true}};state.paste(text);assert.equal(text.prevented,undefined);
});
test('粘贴不支持的图片类型给出提示，连续粘贴只使用最新图片',()=>{
 const {state,readers}=setup();state.paste(imageEvent('a.gif','image/gif'));assert.match(state.alert,/JPG/);assert.equal(readers.length,0);
 state.paste(imageEvent('old.png'));state.paste(imageEvent('new.png'));readers[1].onload();readers[0].onload();assert.equal(state.courseImage.name,'new.png');
});
