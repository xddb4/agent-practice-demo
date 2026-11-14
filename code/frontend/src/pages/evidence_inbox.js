let evidenceBusy=false;
function evidenceGroups(){return {pending:evidence.filter(e=>e.status==='待确认'),watch:evidence.filter(e=>e.status==='待观察'),processed:evidence.filter(e=>['已接受','已拒绝'].includes(e.status))}}
function evidenceRowHTML(item,processed=false){
 return '<div class="evidence-row '+(item.status==='待观察'?'evidence-watch':'')+'"><div class="grow"><h4>'+esc(item.title)+' <span class="evidence-status">'+esc(item.status)+'</span></h4><p>'+esc(item.body)+'</p><p>'+esc(item.desc||'')+'</p></div><button onclick="evidenceState('+item.id+',\'已接受\','+processed+')">接受</button><button onclick="editEvidence('+item.id+')">修改</button><button onclick="evidenceState('+item.id+',\'已拒绝\','+processed+')">拒绝</button>'+(processed?'<button onclick="deleteProcessedEvidence('+item.id+')">删除</button>':'<button onclick="evidenceState('+item.id+',\'待观察\')">待观察</button>')+'</div>';
}
function evidenceInboxHTML(){
 const groups=evidenceGroups();
 return '<section class="panel evidence"><div class="evidence-inbox-heading"><div class="panel-title">证据收件箱</div><button class="secondary" onclick="showProcessedEvidence()">已处理证据（'+groups.processed.length+'）</button></div><h3>待处理（'+groups.pending.length+'）</h3>'+ (groups.pending.map(e=>evidenceRowHTML(e)).join('')||'<p class="tiny">暂无待处理证据。</p>')+'<section class="evidence-watch-section"><h3>待观察（'+groups.watch.length+'）</h3><p class="tiny">暂不纳入能力报告，可补充或修改后重新核对。</p>'+(groups.watch.map(e=>evidenceRowHTML(e)).join('')||'<p class="tiny">暂无待观察证据。</p>')+'</section></section>';
}
function showProcessedEvidence(){const groups=evidenceGroups();modal('<div class="modal-head"><h2>已处理证据（'+groups.processed.length+'）</h2><button onclick="closeModal()" aria-label="关闭已处理证据">✕</button></div><p class="tiny">可重新选择接受或拒绝；修改后返回待处理。删除后不再保留该证据记录。</p>'+(groups.processed.map(e=>evidenceRowHTML(e,true)).join('')||'<p class="empty">暂无已处理证据。</p>'))}
async function persistEvidenceChange(change,processed=false){
 if(evidenceBusy)return false;
 evidenceBusy=true;const previous=structuredClone(evidence);
 try{change();if(!save())throw Error('请先登录后保存');await saveQueue;await report();if(processed)showProcessedEvidence();return true}
 catch(error){evidence=previous;toast('证据变更未保存，请重试');return false}
 finally{evidenceBusy=false}
}
evidenceState=async function(id,status,processed=false){
 if(!['已接受','已拒绝','待观察'].includes(status)||!evidence.some(e=>e.id===id))return;
 await persistEvidenceChange(()=>{evidence.find(e=>e.id===id).status=status},processed);
};
editEvidence=function(id){
 if(evidenceBusy)return;const item=evidence.find(e=>e.id===id);if(!item)return;
 modal('<div class="modal-head"><h2>修改证据</h2><button onclick="closeModal()">✕</button></div><p class="tiny">保存后视为新候选，重新待确认，确认前不纳入能力报告。</p><div class="form-group"><label for="edit-title">标题</label><input id="edit-title" value="'+esc(item.title)+'"></div><div class="form-group"><label for="edit-body">内容</label><textarea id="edit-body">'+esc(item.body||'')+'</textarea></div><div class="form-group"><label for="edit-desc">说明</label><textarea id="edit-desc">'+esc(item.desc||'')+'</textarea></div><div class="form-group"><label for="edit-dim">关联能力</label><select id="edit-dim">'+abilities.map((label,i)=>'<option value="'+i+'" '+(item.dim===i?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></div><div class="modal-footer"><button class="secondary" onclick="closeModal()">取消</button><button class="primary" onclick="saveEditedEvidence('+id+')">保存为待确认</button></div>');
};
async function saveEditedEvidence(id){
 if(evidenceBusy)return;
 const item=evidence.find(e=>e.id===id);if(!item)return;
 const title=val('edit-title').trim(),body=val('edit-body').trim(),desc=val('edit-desc'),dim=Number(val('edit-dim'));
 if(!title||!body||!Number.isInteger(dim)||dim<0||dim>5)return showStudyAlert('请填写标题、内容并选择关联能力。','请补充证据');
 const replacement={...item,id:Math.max(Date.now(),...evidence.map(e=>Number(e.id)||0))+1,title,body,desc,dim,status:'待确认'};
 if(await persistEvidenceChange(()=>{evidence=evidence.map(e=>e.id===id?replacement:e)}))closeModal();
}
async function deleteProcessedEvidence(id){
 if(evidenceBusy)return;
 const item=evidence.find(e=>e.id===id);if(!item||!['已接受','已拒绝'].includes(item.status))return;
 if(!await confirmStudyAction('删除「'+item.title+'」后，该证据记录无法恢复，能力报告将同步更新。','删除证据？'))return;
 await persistEvidenceChange(()=>{evidence=evidence.filter(e=>e.id!==id)},true);
}
