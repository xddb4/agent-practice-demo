const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readSource,namedFunction}=require('./frontend-source.cjs');

test('报告说明保留接口统计、原始限制和调整入口，动态内容转义',()=>{
 const state={};vm.createContext(state);
 for(const name of ['esc','uiSymbol','informationHTML']) vm.runInContext(namedFunction(readSource('components/ui/primitives.js'),name),state);
 vm.runInContext(namedFunction(readSource('pages/report/report-page.js'),'reportInformationHTML'),state);
 const html=state.reportInformationHTML({execution_reference:{completed_flexible_tasks:3,known_elapsed_tasks:1,limitations:'<说明>',expired_reference:{total:2,adjustment_advice:['调整计划']}}});
 assert.match(html,/popovertarget="report-information"/);assert.match(html,/已完成 3 项灵活任务，其中 1 项有完整历时记录/);
 assert.match(html,/&lt;说明&gt;/);assert.match(html,/调整计划|查看与调整过期任务/);
});

test('信息面板在窄屏及靠近底部时放入视口，关闭后不重新定位',()=>{
 const panel={style:{},offsetWidth:288,offsetHeight:400,matches:()=>true};
 const state={innerWidth:320,innerHeight:844,document:{getElementById:()=>panel}};
 vm.createContext(state);vm.runInContext(namedFunction(readSource('components/ui/primitives.js'),'positionInformation'),state);
 const button={getAttribute:()=> 'note',getBoundingClientRect:()=>({left:280,bottom:800})};
 state.positionInformation(button);assert.equal(panel.style.left,'16px');assert.equal(panel.style.top,'428px');
 panel.matches=()=>false;panel.style={};state.positionInformation(button);assert.deepEqual(panel.style,{});
});
