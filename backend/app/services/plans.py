"""准备方案的显式持久记忆；不把模型推测写成能力事实。"""
import json
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

def plan_payload(record,tasks):
    data=unpack(record.data);items=plan_items(data);adopted=set()
    for task in tasks:
        if task.get('agent_run_id')!=record.id:continue
        index=task.get('proposal_index')
        if isinstance(index,int):adopted.add(index)
        else:adopted.update(i for i,item in enumerate(items) if item.get('title')==task.get('title'))
    return {'id':record.id,'route':'recommend','title':plan_title(data),'created_at':data.get('created_at'),'input_source':data.get('input_source',''),'items':items,'proposal_indices':list(range(len(items))),'adopted_indices':sorted(adopted),'sources':data.get('sources',[]),'search_status':data.get('search_status',{}),'reused':True,'parent_plan_id':data.get('parent_plan_id')}
