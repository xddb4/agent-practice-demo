"""公开资料检索适配。只返回真实取得的来源与可核验的服务状态。"""
from ..services.model_settings import model_env
from datetime import datetime,timezone
from urllib.parse import urlsplit
import httpx

def search_provider():
    preference=model_env('SEARCH_PROVIDER','auto')
    if preference=='off':return None
    if preference in ('auto','tavily') and model_env('TAVILY_API_KEY'):return 'tavily'
    if preference in ('auto','deepseek') and model_env('MODEL_PROVIDER')=='deepseek' and model_env('MODEL_API_KEY') and urlsplit(model_env('MODEL_BASE_URL','')).hostname=='api.deepseek.com':return 'deepseek'
    return None

def search_public(query):
    provider=search_provider()
    state={'provider':provider,'status':'not_configured','sources':[],'checked_at':None,'message':'未启用联网检索，本方案仅依据你提供的信息。'}
    if not provider:return state
    query=query.strip()[:128]
    if not query:return {**state,'status':'failed','message':'搜索关键词为空，未取得外部资料。'}
    state['checked_at']=datetime.now(timezone.utc).isoformat()
    try:
        if provider=='deepseek':
            response=httpx.post('https://api.deepseek.com/v1/tools/search',headers={'Authorization':'Bearer '+model_env('MODEL_API_KEY'),'Accept-Encoding':'gzip, deflate'},json={'query':query,'count':3,'need_content':False},timeout=20)
        else:
            response=httpx.post('https://api.tavily.com/search',json={'api_key':model_env('TAVILY_API_KEY'),'query':query,'max_results':3},timeout=20)
        response.raise_for_status()
        results=response.json().get('results',[])
        sources=[{'title':str(item.get('title') or item['url']),'url':item['url'],'summary':str(item.get('summary') or item.get('content') or item.get('snippet') or '')[:1600],'checked_at':state['checked_at']} for item in results if isinstance(item,dict) and urlsplit(str(item.get('url',''))).scheme in ('https','http')]
        return {**state,'status':'success' if sources else 'empty','sources':sources,'message':'已检索到外部参考资料。' if sources else '已进行联网检索，但没有找到可用资料。'}
    except httpx.TimeoutException:
        return {**state,'status':'failed','message':'联网检索超时，本次方案未使用外部资料。'}
    except httpx.HTTPStatusError as error:
        messages={401:'搜索服务密钥验证失败',402:'搜索账户额度不足',403:'当前账户没有搜索权限',429:'搜索服务请求过于频繁'}
        return {**state,'status':'failed','message':messages.get(error.response.status_code,'搜索服务暂时不可用')+'，本次方案未使用外部资料。'}
    except Exception:
        return {**state,'status':'failed','message':'联网检索失败，本次方案未使用外部资料。'}
