"""账号独立的模型配置；运行时通过 ContextVar 隔离，不修改进程环境。"""
import os
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import urlsplit
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, Field, ConfigDict, model_validator
from ..core.db import Session, Record

current_settings = ContextVar('model_settings', default=None)
PRESETS = {
    'deepseek': 'https://api.deepseek.com',
    'qwen': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'openai': 'https://api.openai.com/v1',
}

def model_env(name, default=None):
    settings = current_settings.get()
    return settings.get(name, default) if settings is not None else os.getenv(name, default)

class ModelSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: str
    model: str = Field(min_length=1, max_length=150)
    base_url: str = Field(default='', max_length=500)
    api_key: str = Field(default='', max_length=4096)
    vision_model: str = Field(default='', max_length=150)
    supports_vision: bool = False

    @model_validator(mode='after')
    def check(self):
        if self.provider not in [*PRESETS, 'custom']:
            raise ValueError('不支持的服务商')
        self.base_url = (self.base_url.strip() or PRESETS.get(self.provider, '')).rstrip('/')
        url = urlsplit(self.base_url)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('API 地址必须是 HTTPS 地址，不得包含账号、参数或片段')
        self.model = self.model.strip()
        self.vision_model = self.vision_model.strip()
        self.api_key = self.api_key.strip()
        if not self.model or any(c in self.api_key for c in '\r\n'):
            raise ValueError('模型名称或密钥无效')
        return self

def cipher():
    path = Path(os.getenv('MODEL_ENCRYPTION_KEY_FILE', '.model-encryption.key'))
    if not path.exists():
        try:
            with path.open('xb') as file:
                file.write(Fernet.generate_key())
        except FileExistsError:
            pass
    return Fernet(path.read_bytes().strip())

def read_settings(owner):
    with Session() as db:
        row = db.get(Record, 'model-settings:' + owner)
        return dict(row.data) if row else None

def public_settings(data):
    if not data:
        return {'configured': False, 'provider': 'deepseek', 'model': 'deepseek-chat', 'base_url': PRESETS['deepseek'], 'supports_vision': False, 'vision_model': ''}
    return {**{k: v for k, v in data.items() if k != 'encrypted_key'}, 'configured': bool(data.get('encrypted_key'))}

def save_settings(owner, body):
    data = body.model_dump(exclude={'api_key'})
    previous = read_settings(owner)
    if body.api_key:
        data['encrypted_key'] = cipher().encrypt(body.api_key.encode()).decode()
    elif previous and previous['provider'] == body.provider and previous['base_url'] == body.base_url:
        data['encrypted_key'] = previous['encrypted_key']
    else:
        raise HTTPException(422, '首次配置或更换服务商/API 地址时，请输入 API 密钥')
    with Session() as db:
        db.merge(Record(id='model-settings:' + owner, owner=owner, kind='model-settings', data=data))
        db.commit()
    return public_settings(data)

def runtime_settings(owner):
    data = read_settings(owner)
    if not data:
        raise HTTPException(409, {'code': 'model_not_configured', 'message': '请先配置你的模型 API'})
    try:
        key = cipher().decrypt(data['encrypted_key'].encode()).decode()
    except (InvalidToken, KeyError):
        raise HTTPException(409, {'code': 'model_not_configured', 'message': '密钥无法解密，请重新输入 API 密钥'})
    return {'MODEL_PROVIDER': data['provider'], 'MODEL_NAME': data['model'], 'MODEL_BASE_URL': data['base_url'], 'MODEL_API_KEY': key,
            'MODEL_SUPPORTS_VISION': str(data['supports_vision']).lower(), 'VISION_MODEL': data['vision_model'] or data['model'],
            'MODEL_JSON_MODE': 'true', 'MODEL_THINKING': 'false', 'SEARCH_PROVIDER': 'auto'}

@contextmanager
def use_settings(settings):
    token = current_settings.set(settings)
    try:
        yield
    finally:
        current_settings.reset(token)
