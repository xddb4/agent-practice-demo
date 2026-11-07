import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import '../progress.css';

function App(){
 const frame=useRef(null),activeRequest=useRef(null),requestData=useRef(null);
 const [request,setRequest]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[elapsed,setElapsed]=useState(0);
 useEffect(()=>{if(!busy)return;const timer=setInterval(()=>setElapsed(value=>value+1),1000);return()=>clearInterval(timer)},[busy]);
 function cancel(){activeRequest.current?.abort();activeRequest.current=null;frame.current?.contentWindow.postMessage({type:'agent-cancelled',route:requestData.current?.payload.route},location.origin);requestData.current=null;setRequest(null);setError(null);setBusy(false)}
 async function runAgent(nextRequest){
  activeRequest.current?.abort();const operation=new AbortController();activeRequest.current=operation;
  requestData.current=nextRequest;
  const isCurrent=()=>activeRequest.current===operation&&!operation.signal.aborted;
  setRequest(nextRequest);setError(null);setElapsed(0);setBusy(true);
  try{
   const configuration=await fetch('/api/model-settings',{signal:operation.signal});
   const settings=await configuration.json();
   if(!isCurrent())return;
   if(!configuration.ok){const failure=new Error();failure.detail=settings.detail;failure.status=configuration.status;throw failure}
   if(!settings.configured){cancel();frame.current?.contentWindow.postMessage({type:'open-model-settings'},location.origin);return}
   const response=await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(nextRequest.payload),signal:operation.signal});
   let value;try{value=await response.json()}catch{throw new Error('invalid-response')}
   if(!isCurrent())return;
   if(!response.ok){if(value.detail?.code==='model_not_configured'){cancel();frame.current?.contentWindow.postMessage({type:'open-model-settings'},location.origin);return}const failure=new Error();failure.detail=value.detail;failure.status=response.status;throw failure}
   // 候选直接交给唯一的用户核对表单，禁止增加JSON或模型说明页面。
   frame.current.contentWindow.postMessage({type:'agent-result',result:value},location.origin);setRequest(null);
  }catch(failure){if(isCurrent())setError(toDiagnostic(failure))}
  finally{if(isCurrent())setBusy(false)}
 }
 useEffect(()=>{
  function receive(event){if(event.origin===location.origin&&event.source===frame.current?.contentWindow&&event.data.type==='agent')runAgent(event.data)}
  function escape(event){if(event.key==='Escape'&&activeRequest.current)cancel()}
  window.addEventListener('message',receive);window.addEventListener('keydown',escape);
  return()=>{window.removeEventListener('message',receive);window.removeEventListener('keydown',escape);activeRequest.current?.abort();activeRequest.current=null};
 },[]);
 const buttonStyle={border:'1px solid #dcd6e2',borderRadius:9,padding:'8px 16px',cursor:'pointer',background:'#fffef9',color:'#48444e',font:'inherit'};
 return <>
  <iframe ref={frame} id="prototype" title="StudyPilot 工作台" src="/prototype.html" style={{width:'100%',height:'100dvh',border:0,display:'block'}}/>
  {request&&busy&&<aside style={{position:'fixed',bottom:24,right:24,zIndex:999,width:'min(320px,calc(100vw - 48px))',boxSizing:'border-box',background:'#fffef9',color:'#48444e',padding:'16px 20px',border:'1px solid #e0d5eb',borderRadius:14,boxShadow:'0 8px 30px #314d3e22',fontFamily:'Microsoft YaHei'}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,marginBottom:12}}><span role="status">{request.payload.route==='recommend'?'正在生成准备方案…':'正在识别…'}</span><button style={buttonStyle} onClick={cancel}>取消</button></div>
   <progress className="agent-progress" aria-label="正在等待处理结果" />
   <small style={{display:'block',marginTop:8,color:'#8b8098'}}>已等待 {elapsed} 秒</small>
  </aside>}
  {request&&error&&<div style={{position:'fixed',inset:0,background:'#314d3e55',display:'grid',placeItems:'center',fontFamily:'Microsoft YaHei',zIndex:999}}>
   <section role="dialog" aria-modal="true" aria-label="处理失败" style={{background:'#fffef9',borderRadius:22,padding:30,width:'min(640px,85vw)',maxHeight:'85vh',overflow:'auto',color:'#48444e'}}>
    <h2>{error.title}</h2><div role="alert" style={{lineHeight:1.8}}>
     <p>原因：{error.reason}</p>{error.problems?.length>0&&<ul>{error.problems.map((problem,index)=><li key={index}>{problem}</li>)}</ul>}
     <p>建议：{error.action}</p><p style={{fontSize:12}}>原输入已保留，已有日程未受影响。</p>
     {error.request_id&&<small>错误编号：{error.request_id}</small>}
    </div><div style={{display:'flex',gap:12,marginTop:20}}>
     <button style={buttonStyle} onClick={()=>runAgent(request)}>{error.retryable===false?'修改后重试':'重试'}</button>
     <button style={buttonStyle} onClick={cancel}>返回编辑</button>
    </div>
   </section>
  </div>}
 </>;
}
function toDiagnostic(error){
 if(error.detail?.reason)return error.detail;
 if(error.status===401)return {title:'登录已失效',reason:'当前登录状态已过期。',action:'请返回并重新登录后重试。',retryable:false};
 if(typeof error.detail==='string')return {title:'未能完成操作',reason:error.detail,action:'请检查输入后重试，或返回手动添加。'};
 return {title:'无法完成请求',reason:'浏览器未能取得有效的服务响应。',action:'请检查本地服务与网络后重试。',retryable:true};
}
createRoot(document.getElementById('root')).render(<App/>);
