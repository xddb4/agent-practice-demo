from ..services.model_settings import model_env
from langchain_openai import ChatOpenAI

class ModelCapabilityError(ValueError):pass

def create_model(vision=False):
    provider=model_env('MODEL_PROVIDER','qwen')
    if vision and model_env('MODEL_SUPPORTS_VISION','true').lower()!='true':
        raise ModelCapabilityError('当前模型未启用图片能力，请配置视觉模型或改用文字录入')
    name=model_env('VISION_MODEL' if vision else 'MODEL_NAME')
    if not name:raise ModelCapabilityError('未设置视觉模型' if vision else '未设置文本模型')
    # 使用标准库可解码的压缩格式，避免宿主旧版 Brotli 与 HTTP SDK 的冲突。
    options={}
    if provider=='deepseek':options['extra_body']={'thinking':{'type':'enabled' if model_env('MODEL_THINKING','false').lower()=='true' else 'disabled'}}
    return ChatOpenAI(model=name,api_key=model_env('MODEL_API_KEY'),base_url=model_env('MODEL_BASE_URL','https://dashscope.aliyuncs.com/compatible-mode/v1'),timeout=45,max_retries=1,max_tokens=4096,temperature=0,default_headers={'Accept-Encoding':'gzip, deflate'},**options)

def structured_model(vision=False):
    llm=create_model(vision)
    return llm.bind(response_format={'type':'json_object'}) if model_env('MODEL_JSON_MODE','true').lower()=='true' else llm
