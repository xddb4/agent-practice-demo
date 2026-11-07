"""准备方案的显式持久记忆；不把模型推测写成能力事实。"""
import json
import re
from .memory import unpack

def plan_title(data):
    data=unpack(data)
    if data.get('display_title'):return data['display_title']
    source=data.get('input_source','')
    try:
        parsed=json.loads(source)
        if isinstance(parsed,dict):return str(parsed.get('目标') or parsed.get('goal') or '准备方案')[:200]
    except (ValueError,TypeError):pass
    return source[:100] or '准备方案'

def dialogue_title(data):
    """Prefer the model title; old records use a local fallback without model calls."""
    data=unpack(data)
    title=str(data.get('dialogue_title') or '').strip()
    if title:return title[:10]
    original=plan_title(data)
    for keyword,label in [('六级','六级备考计划'),('四级','四级备考计划'),('雅思','雅思备考计划'),('考研','考研准备计划'),('论文','论文研究计划'),('科研','科研成长计划')]:
        if keyword in original:return label
    return re.sub(r'\s+','',original)[:10] or '准备方案'

def plan_items(data):
    data=unpack(data)
    items=[dict(item) for item in data.get('items',[])]
    revisions=data.get('item_revisions',{})
    if not revisions and data.get('reviewed_items'):
        indices=data.get('reviewed_indices')
        if indices is not None:
            revisions={str(index):item for index,item in zip(indices,data['reviewed_items'])}
        elif len(data['reviewed_items'])==len(items):
            revisions={str(index):item for index,item in enumerate(data['reviewed_items'])}
        else:
            # 旧版部分采纳没有稳定索引，只在标题唯一匹配时恢复修改，避免串位。
            revisions={}
            for item in data['reviewed_items']:
                matches=[i for i,original in enumerate(items) if original.get('title')==item.get('title')]
                if len(matches)==1:revisions[str(matches[0])]=item
    for key,item in revisions.items():
        if str(key).isdigit() and int(key)<len(items):items[int(key)]=dict(item)
    return items

def linked_tasks(tasks, plan_id, items):
    owned = [task for task in tasks if task.get('agent_run_id') == plan_id]
    linked = {task['proposal_index']: task for task in owned if isinstance(task.get('proposal_index'), int)}
    legacy = {}
    for task in owned:
        if not isinstance(task.get('proposal_index'), int):
            legacy.setdefault(task.get('title'), []).append(task)
    for index, item in enumerate(items):
        title = item.get('title')
        matches = legacy.get(title, [])
        if index not in linked and len(matches) == 1 and sum(other.get('title') == title for other in items) == 1:
            linked[index] = matches[0]
    return linked


def plan_payload(record,tasks):
    data=unpack(record.data);items=plan_items(data)
    linked=linked_tasks(tasks,record.id,items)
    indices=[index for index in range(len(items)) if index not in data.get('cancelled_indices',[])]
    calendar_fields=('title','date','start','end','duration','ddl','done','location','suggested_sessions')
    calendar={index:{key:linked[index].get(key) for key in calendar_fields} for index in indices if index in linked}
    return {'id':record.id,'route':'recommend','title':plan_title(data),'dialogue_title':dialogue_title(data),'created_at':data.get('created_at'),'input_source':data.get('input_source',''),'items':[items[index] for index in indices],'proposal_indices':indices,'adopted_indices':list(calendar),'calendar_items':calendar,'sources':data.get('sources',[]),'skills':data.get('skills',[]),'planning':data.get('planning',{}),'search_status':data.get('search_status',{}),'reused':True,'parent_plan_id':data.get('parent_plan_id')}
