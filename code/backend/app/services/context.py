"""有明确上限的检索式上下文，不把整个历史数据库塞进提示词。"""
import json
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo

def bounded_context(state,limit=12000):
    today=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
    tasks=state.get('tasks',[]);evidence=[item for item in state.get('evidence',[]) if item.get('status')=='已接受']
    active=[item for item in tasks if not item.get('done')]
    active.sort(key=lambda item:(item.get('date','')<today,item.get('date') or '9999',item.get('q',3)))
    view={'tasks':[{key:(value[:160] if isinstance(value,str) else value) for key,value in item.items() if key in ['id','title','date','start','end','repeat','ddl','duration','q']} for item in active[:40]],'evidence':[{key:(value[:300] if isinstance(value,str) else value) for key,value in item.items() if key in ['id','title','dim','body','status']} for item in evidence[-12:]]}
    if state.get('reference_plan'):
        reference=state['reference_plan']
        view['reference_plan']={'title':str(reference.get('title',''))[:160],'items':[{key:(value[:160] if isinstance(value,str) else value) for key,value in item.items() if key in ['title','estimated_minutes','task_key','depends_on']} for item in reference.get('items',[])[:20]],'rule':reference.get('rule','')}
    view['memory_meta']={'total_tasks':len(tasks),'total_confirmed_evidence':len(evidence),'character_limit':limit,'omitted':False}
    while len(json.dumps(view,ensure_ascii=False))>limit-128:
        if view.get('reference_plan',{}).get('items'):view['reference_plan']['items'].pop()
        elif view['tasks']:view['tasks'].pop()
        elif view['evidence']:view['evidence'].pop(0)
        else:break
        view['memory_meta']['omitted']=True
    view['memory_meta']['included_tasks']=len(view['tasks']);view['memory_meta']['included_evidence']=len(view['evidence'])
    return view
