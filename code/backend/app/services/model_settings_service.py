"""模型配置门面：整合已有的加密存储、账号隔离和模型网关。"""

import uuid
from collections.abc import Callable

from fastapi import HTTPException

from ..core.db import Record, Session
from ..integrations import model as model_gateway
from .agent_errors import diagnose
from .model_settings import public_settings, read_settings, runtime_settings, save_settings, use_settings


class ModelSettingsService:
    """Keep HTTP handlers independent from provider creation and persistence details."""

    def __init__(self, model_factory: Callable | None = None):
        self._model_factory = model_factory

    def read(self, owner):
        return public_settings(read_settings(owner))

    def save(self, owner, body):
        return save_settings(owner, body)

    def delete(self, owner):
        with Session() as db:
            row = db.get(Record, 'model-settings:' + owner)
            if row:
                db.delete(row)
                db.commit()
        return {'configured': False}

    def test_connection(self, owner):
        settings = runtime_settings(owner)
        factory = self._model_factory or model_gateway.create_model
        try:
            with use_settings(settings):
                factory().invoke('Reply only OK. This is a connection test.')
        except Exception as error:
            raise HTTPException(502, diagnose(error, uuid.uuid4().hex[:12])) from None
        return {'ok': True, 'message': '文本模型连接成功；图片能力需用实际图片单独验证。'}
