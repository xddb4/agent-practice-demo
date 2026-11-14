"""无损压缩生成记录；正式任务、证据、附件不参与清理。"""
import base64,json,zlib
from datetime import datetime,timedelta,timezone

def unpack(data):
    if '_compressed_v1' not in data:return data
    decoder=zlib.decompressobj();raw=decoder.decompress(base64.b64decode(data['_compressed_v1']),32*1024*1024)
    if decoder.unconsumed_tail:raise ValueError('压缩记录过大')
    result=json.loads(raw)
    if 'archived' in data:result['archived']=data['archived']
    return result

def pack(data):
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode('utf8')
    payload={'_compressed_v1':base64.b64encode(zlib.compress(raw,9)).decode(),'route':data.get('route'),'created_at':data.get('created_at')}
    if 'archived' in data:payload['archived']=data['archived']
    return payload if len(json.dumps(payload,ensure_ascii=False).encode('utf8'))<len(raw) else data

def record_bytes(record):return len(json.dumps(record.data,ensure_ascii=False).encode('utf8'))

def cleanup_candidates(records,tasks,days=30,keep=5):
    ordered=sorted(records,key=lambda record:record.data.get('created_at') or '',reverse=True)
    protected={task.get('agent_run_id') for task in tasks if task.get('agent_run_id')}
    cutoff=(datetime.now(timezone.utc)-timedelta(days=days)).isoformat()
    return [record for record in ordered[keep:] if record.id not in protected and (record.data.get('route')!='recommend' or record.data.get('archived')) and (record.data.get('created_at') or '')<cutoff]
