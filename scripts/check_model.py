"""本地模型探测；不输出密钥、认证头或原始错误响应。"""
import os, sys, json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
for line in (Path(__file__).resolve().parents[1]/'.env').read_text(encoding='utf-8-sig').splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1);os.environ[k]=v

def main():
    import httpx
    if '--search' in sys.argv:
        from backend.app.integrations.search import search_public
        result=search_public('计算机系统 缓存替换算法 对照实验')
        print(json.dumps(result,ensure_ascii=False));return 0 if result['status']=='success' else 1
    if '--live' not in sys.argv and '--vision' not in sys.argv:
        try:
            r=httpx.get(os.environ['MODEL_BASE_URL'].rstrip('/')+'/models',headers={'Authorization':'Bearer '+os.environ['MODEL_API_KEY']},timeout=20)
            print(json.dumps({'status':r.status_code,'models':[{'id':x['id'],'modalities':x.get('input_modalities')} for x in r.json().get('data',[])]},ensure_ascii=False))
            return 0 if r.is_success else 1
        except Exception as e:
            print(type(e).__name__+': network request failed');return 2
    from backend.app.ai.workflows.pilot import workflow
    if '--vision' in sys.argv:
        import pymupdf, base64
        doc=pymupdf.open();page=doc.new_page(width=900,height=240)
        page.insert_text((30,50),'TIMETABLE - TERM 2026',fontsize=22)
        page.insert_text((30,100),'MON 09:00-10:00  Computer Systems  Room A201  Weeks 1-16',fontsize=16)
        raw=base64.b64encode(page.get_pixmap().tobytes('png')).decode()
        try:
            result=workflow.invoke({'route':'schedule','text':'Extract the course timetable. Unknown fields must be null.','image':'data:image/png;base64,'+raw,'context':{'tasks':[],'evidence':[]}})['result']
            print(json.dumps({'vision':True,'ok':True,'items':result['items']},ensure_ascii=False));return 0
        except Exception as e:
            print(json.dumps({'vision':True,'ok':False,'error_type':type(e).__name__}));return 1
    cases=[('schedule','2026年11月2日14:00至15:00，在图书馆203讨论实验设计。'),('evidence','实验报告：比较两个缓存替换算法，固定测试数据，记录命中率，发现样本范围有限。'),('recommend','目标：两周内完成缓存替换算法小实验；已有Python基础，每周可投入4小时，无比赛报名需求。')]
    if '--partial-time' in sys.argv:
        cases=[('schedule','研习会第三期：2026年10月26日（周一）18:30，地点：工科楼702会议室。分享两篇图像分割论文。第四期延期三周，于2026年11月23日举行。通知未给出结束时间，第四期未给出开始时刻，不得编造。')]
    if '--recommend' in sys.argv:cases=[cases[-1]]
    if '--timed-recommend' in sys.argv:
        from datetime import datetime,timedelta
        cases=[('recommend',json.dumps({'目标':'准备英语六级写作，写作后需要修改','截止日期':(datetime.now().date()+timedelta(days=21)).isoformat(),'每周小时':6,'基础与约束':'重点练习写作及修改，不要凭空指定套数'},ensure_ascii=False))]
    results=[]
    for route,text in cases:
        try:
            result=workflow.invoke({'route':route,'text':text,'context':{'tasks':[],'evidence':[]}})['result']
            results.append({'route':route,'ok':True,'items':len(result['items']),'sources':len(result.get('sources',[])),'search_status':result.get('search_status',{}).get('status'),'metrics':result.get('metrics'),'planning':result.get('planning'),'deadlines':[{'title':item['title'],'deadline':item.get('deadline'),'depends_on':item.get('depends_on')} for item in result['items']] if route=='recommend' else [],'trace':result.get('trace',[]),'notice':result.get('notice','')})
        except Exception as e:
            import traceback
            frames=[{'file':Path(f.filename).name,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(e.__traceback__)[-8:]]
            results.append({'route':route,'ok':False,'error_type':type(e).__name__,'detail':str(e).replace(os.environ['MODEL_API_KEY'],'[REDACTED]')[:400],'frames':frames})
        print(json.dumps(results[-1],ensure_ascii=False),flush=True)
    return 0 if all(x['ok'] for x in results) else 1

if __name__=='__main__':raise SystemExit(main())
