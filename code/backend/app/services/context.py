"""有明确上限的检索式上下文，不把整个历史数据库塞进提示词。"""
import json
import re
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from ..schemas.agent import DIMENSIONS


def ability_context(evidence, topic, max_items=12, max_characters=6000):
    """Read fresh accepted records only; lexical relevance is not an ability assessment."""
    confirmed=[item for item in evidence if item.get('status')=='已接受']
    terms=set(re.findall(r'[a-zA-Z0-9]{2,}|[\u4e00-\u9fff]{2}', topic.lower()))
    ranked=sorted(enumerate(confirmed), key=lambda pair:(
        -sum(term in (str(pair[1].get('title',''))+' '+str(pair[1].get('body',''))).lower() for term in terms), pair[0]))
    result=[]
    for _,item in ranked:
        candidate={key:item.get(key) for key in ('id','dim','kind','status','source_type')}
        dim=item.get('dim')
        candidate['dimension']=DIMENSIONS[dim] if type(dim) is int and 0<=dim<len(DIMENSIONS) else None
        candidate.update({key:str(item.get(key) or '')[:800] for key in ('title','body','desc')})
        if len(result)>=max_items or len(json.dumps([*result,candidate],ensure_ascii=False))>max_characters:continue
        result.append(candidate)
    return {'evidence':result,'total_confirmed':len(confirmed),'omitted':len(confirmed)>len(result),
            'limitations':'已接受指用户确认保留；自述不是客观测评。维度证据不足不表示能力低，不作跨学科推断。'}

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
