function showStudyAlert(message,title='请检查填写内容'){
 const previous=document.activeElement;
 document.querySelector('.study-alert')?.close();
 const dialog=document.createElement('dialog');dialog.className='study-alert';dialog.setAttribute('aria-labelledby','study-alert-title');dialog.setAttribute('aria-describedby','study-alert-message');
 dialog.innerHTML='<h2 id="study-alert-title"></h2><p id="study-alert-message"></p><form method="dialog"><button autofocus>知道了</button></form>';
 dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=String(message);
 dialog.addEventListener('close',()=>{dialog.remove();if(previous?.isConnected)previous.focus()},{once:true});
 document.body.appendChild(dialog);dialog.showModal();
}
const toastBeforeAlerts=toast;
function confirmStudyAction(message,title='确认清理记录？'){
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='study-alert';dialog.setAttribute('aria-label',title);
  dialog.innerHTML='<h2></h2><p></p><form method="dialog" style="display:flex;gap:12px;justify-content:flex-end"><button value="cancel" autofocus>取消</button><button value="confirm">确认</button></form>';
  dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=message;
  dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='confirm';dialog.remove();if(previous?.isConnected)previous.focus();resolve(accepted)},{once:true});
  document.body.appendChild(dialog);dialog.showModal();
 });
}
toast=function(message){
 if(/结束时间|起止时间|开始时间|请补齐|请补全|请补充|不能为空|日期无效|时间无效/.test(String(message)))return showStudyAlert(message);
 return toastBeforeAlerts(message);
};
