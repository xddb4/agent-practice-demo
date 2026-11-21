"""模型配置的 HTTP 适配层；配置和连接逻辑由服务统一处理。"""

from fastapi import APIRouter, Depends

from ..core.auth import uid
from ..services.model_settings import ModelSettings
from ..services.model_settings_service import ModelSettingsService


router = APIRouter(
    prefix='/api/model-settings',
    tags=['模型配置'],
    responses={401: {'description': '未登录或会话已过期'}},
)


def settings_service():
    return ModelSettingsService()


@router.get('')
def get_model_settings(owner=Depends(uid), service: ModelSettingsService = Depends(settings_service)):
    return service.read(owner)


@router.put('', responses={422: {'description': '配置字段无效或缺少 API 密钥'}})
def put_model_settings(body: ModelSettings, owner=Depends(uid), service: ModelSettingsService = Depends(settings_service)):
    return service.save(owner, body)


@router.delete('')
def delete_model_settings(owner=Depends(uid), service: ModelSettingsService = Depends(settings_service)):
    return service.delete(owner)


@router.post('/test', responses={
    409: {'description': '模型尚未配置或配置不可用'},
    502: {'description': '模型连接失败，返回经过脱敏的原因和建议'},
})
def test_model_settings(owner=Depends(uid), service: ModelSettingsService = Depends(settings_service)):
    return service.test_connection(owner)
