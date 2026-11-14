// 密钥仅通过同源接口发送到后端，不写入 localStorage 或 URL。
const modelPresets={
 deepseek:{url:'https://api.deepseek.com',model:'deepseek-chat',vision:''},
 qwen:{url:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus',vision:'qwen-vl-plus'},
 openai:{url:'https://api.openai.com/v1',model:'gpt-4.1-mini',vision:'gpt-4.1-mini'},
 custom:{url:'',model:'',vision:''}
};
const personalWithModelSettings=personal;
personal=function(){personalWithModelSettings();const logoutButton=document.querySelector('#content button[onclick="logout()"]');if(logoutButton){const button=document.createElement('button');button.className='secondary';button.textContent='模型 API 设置';button.style.marginRight='12px';button.onclick=openModelSettings;logoutButton.before(button)}};

async function modelSettingsRequest(method='GET',body,path=''){
 const response=await fetch('/api/model-settings'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(!response.ok)throw Error(result.detail?.reason||result.detail?.message||(typeof result.detail==='string'?result.detail:'配置字段无效，请核对 HTTPS 地址与模型名称'));
 return result;
}
async function openModelSettings(){
 if(!activeAccount)return login();
 if(document.getElementById('model-settings-dialog'))return;
 const owner=activeAccount.id;
 const dialog=document.createElement('dialog');dialog.id='model-settings-dialog';dialog.className='model-settings-dialog';
 dialog.innerHTML='<form><div class="panel-title">模型 API 设置</div><p class="tiny">配置仅供当前账号使用。密钥加密保存在本机后端，不会回显。调用费用由服务商按你的账户计费。</p><p id="model-config-status" role="status">正在读取配置…</p><div class="form-group"><label for="model-provider">服务商</label><select id="model-provider"><option value="deepseek">DeepSeek</option><option value="qwen">通义千问 Qwen</option><option value="openai">OpenAI</option><option value="custom">其他 OpenAI 兼容接口</option></select></div><div class="form-group"><label for="model-url">API 地址（HTTPS）</label><input id="model-url" type="url" required></div><div class="form-group"><label for="model-name">文本模型（可修改名称）</label><input id="model-name" required maxlength="150" list="model-suggestions"><datalist id="model-suggestions"></datalist></div><div class="form-group"><label for="model-key">API 密钥</label><input id="model-key" type="password" autocomplete="new-password" maxlength="4096" placeholder="输入 API Key"></div><div class="form-group"><label><input id="model-vision-enabled" type="checkbox" style="width:auto">启用图片识别（需服务商支持）</label><label for="model-vision">视觉模型名称</label><input id="model-vision" maxlength="150" placeholder="留空则使用文本模型"></div><p id="model-config-message" role="status" aria-live="polite"></p><div class="model-settings-actions"><button class="primary" type="submit">保存配置</button><button class="secondary" id="model-test" type="button">保存并测试连接</button><button class="secondary" id="model-delete" type="button">移除配置</button><button class="secondary" id="model-close" type="button">关闭</button></div></form>';
 document.body.append(dialog);dialog.showModal();
 const field=id=>dialog.querySelector('#model-'+id);
 dialog.addEventListener('close',()=>dialog.remove());field('close').onclick=()=>dialog.close();
 let busy=false,ready=false;
 function suggestions(){const names={deepseek:['deepseek-chat','deepseek-reasoner','deepseek-flash'],qwen:['qwen-plus','qwen-turbo','qwen-max'],openai:['gpt-4.1-mini','gpt-4.1'],custom:[]};field('suggestions').replaceChildren(...names[field('provider').value].map(name=>{const option=document.createElement('option');option.value=name;return option}))}
 field('provider').onchange=()=>{const preset=modelPresets[field('provider').value];field('url').value=preset.url;field('name').value=preset.model;field('vision').value=preset.vision;field('vision-enabled').checked=!!preset.vision;field('key').value='';suggestions()};
 function lock(value){busy=value;dialog.querySelectorAll('button,input,select').forEach(el=>{if(el.id!=='model-close')el.disabled=value})}
 async function saveConfig(test){
  if(busy||!ready||!dialog.querySelector('form').reportValidity())return;
  lock(true);field('config-message').textContent=test?'正在保存并测试连接…':'正在保存…';
  try{
   const result=await modelSettingsRequest('PUT',{provider:field('provider').value,base_url:field('url').value,model:field('name').value,api_key:field('key').value,vision_model:field('vision').value,supports_vision:field('vision-enabled').checked});
   field('key').value='';field('key').placeholder='已保存密钥；留空保留原密钥';field('config-status').textContent='已配置：'+result.provider+' / '+result.model;
   field('config-message').textContent=test?(await modelSettingsRequest('POST',{},'/test')).message:'配置已保存，下次使用 Agent 生效。请关闭面板后重新发起操作。';
  }catch(error){field('config-message').textContent=error.message}finally{lock(false)}
 }
 dialog.querySelector('form').onsubmit=event=>{event.preventDefault();saveConfig(false)};field('test').onclick=()=>saveConfig(true);
 field('delete').onclick=async()=>{if(busy||!ready)return;if(!await confirmStudyAction('移除后，使用 Agent 需要重新填写 API 配置。已有任务和方案会保留。','移除模型配置？'))return;lock(true);try{await modelSettingsRequest('DELETE');field('key').value='';field('key').placeholder='输入 API Key';field('config-status').textContent='尚未配置模型 API';field('config-message').textContent='配置已移除。'}catch(error){field('config-message').textContent=error.message}finally{lock(false)}};
 lock(true);
 try{const settings=await modelSettingsRequest();if(activeAccount?.id!==owner){dialog.close();return}if(!dialog.isConnected)return;field('provider').value=settings.provider;field('url').value=settings.base_url;field('name').value=settings.model;field('vision').value=settings.vision_model;field('vision-enabled').checked=settings.supports_vision;field('key').placeholder=settings.configured?'已保存密钥；留空保留原密钥':'输入 API Key';field('config-status').textContent=settings.configured?'已配置：'+settings.provider+' / '+settings.model:'请先配置模型 API，再使用 Agent。';suggestions();ready=true}catch(error){field('config-status').textContent=error.message}finally{lock(false)}
}
window.addEventListener('message',event=>{if(event.source===parent&&event.origin===location.origin&&event.data.type==='open-model-settings')openModelSettings()});
const logoutWithModelSettings=logout;logout=async function(){document.getElementById('model-settings-dialog')?.close();return logoutWithModelSettings()};
