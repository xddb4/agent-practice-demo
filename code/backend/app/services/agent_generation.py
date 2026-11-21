"""生成候选的应用服务；通过注入保留模型和请求生命周期的可替换性。"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Any

from fastapi import HTTPException

from ..core.db import Record, Session
from ..integrations.model import ModelCapabilityError
from ..repositories.plans import PlanRepository
from ..repositories.transactions import begin_write
from .agent_errors import diagnose
from .ai_safety import SafetyRefusal, guard_model_output, guard_text, redact_context
from .context import bounded_context
from .model_settings import use_settings
from .plans import plan_payload, plan_title
from .stream_events import ensure_stream_active


log = logging.getLogger('studypilot')
IMAGE_PREFIXES = ('data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')


def validate_agent_input(body):
    guard_text(body.text)
    if body.dialogue_message:
        guard_text(body.dialogue_message)
    if body.route not in ['auto', 'schedule', 'evidence', 'recommend']:
        raise HTTPException(422, '任务类型无效')
    if body.image:
        validate_primary_image(body.image)
    if body.material_ids and body.route not in ('recommend', 'evidence'):
        raise HTTPException(422, '辅助资料仅用于生成推荐方案或成长证据')
    if body.attachment_images and body.route != 'recommend':
        raise HTTPException(422, '辅助资料仅用于生成推荐方案')


def validate_primary_image(image):
    if not image.startswith(IMAGE_PREFIXES) or len(image) > 14_000_000:
        raise HTTPException(422, '仅支持不超过10MB的PNG/JPEG/WebP图片')


def reference_plan(owner, plan_id):
    with Session() as db:
        base = PlanRepository(db, owner).get(plan_id, detail='参考方案不存在')
        return {
            'title': plan_title(base.data), 'items': plan_payload(base, [])['items'],
            'rule': '仅作为用户明确选择的参考方案；本次约束优先，历史方案不代表已确认能力。',
        }


def initial_dialogue(body, result):
    if result['route'] != 'recommend' or not body.dialogue_message:
        return {}
    generated = result['result']
    reply = generated.get('dialogue_reply') or (
        f"我整理了 {len(generated['items'])} 项准备任务。"
        '你可以打开右侧的「选择任务／执行安排」查看各项建议，也可以告诉我哪些任务想调整。'
    )
    return {'dialogue': {
        'messages': [
            {'role': 'user', 'text': body.dialogue_message},
            {'role': 'assistant', 'text': reply,
             'skills': [skill['label'] for skill in generated.get('skills', []) if 'label' in skill]},
            {'role': 'system', 'text': '准备方案已保存，可以继续对话。'},
        ],
        'skill_profile': body.skill_profile, 'pending': None,
    }}


@dataclass
class AgentGenerationService:
    workflow: Any
    load_state: Callable
    load_settings: Callable
    read_attachments: Callable
    begin_request: Callable
    finish_request: Callable

    def generate(self, body, owner):
        validate_agent_input(body)
        materials = self.read_attachments(
            owner, body.material_ids, body.attachment_images,
            text_limit=30000 if body.route == 'evidence' else 3500,
        )
        settings = self.load_settings(owner)
        context, schedule_tasks = self._context(body, owner)
        self.begin_request(owner, body.request_id)
        result = self._invoke(body, settings, context, schedule_tasks, materials)
        guard_model_output(result['result'])
        run_id = self._save(body, owner, result, materials)
        metrics = result['result'].get('metrics', {})
        log.info('agent_completed run=%s route=%s seconds=%s model_calls=%s context_characters=%s',
                 run_id, result['route'], metrics.get('total_seconds'), metrics.get('model_calls'), metrics.get('context_characters'))
        return {'id': run_id, 'route': result['route'], **result['result']}

    def _context(self, body, owner):
        context = self.load_state(owner)
        context['evidence'] = [item for item in context['evidence'] if item.get('status') == '已接受']
        if body.route in ('auto', 'recommend'):
            context['expired_tasks'] = []
        if body.base_plan_id:
            context['reference_plan'] = reference_plan(owner, body.base_plan_id)
        schedule_tasks = redact_context(context.get('tasks', []))
        return redact_context(bounded_context(context)), schedule_tasks

    def _invoke(self, body, settings, context, schedule_tasks, materials):
        try:
            with use_settings(settings):
                return self.workflow.invoke({
                    **body.model_dump(exclude={'material_ids', 'request_id'}),
                    'context': context, 'schedule_tasks': schedule_tasks, 'materials': materials,
                })
        except SafetyRefusal:
            raise
        except Exception as error:
            error_id = uuid.uuid4().hex[:12]
            detail = diagnose(error, error_id)
            log.warning('agent_failed request_id=%s route=%s code=%s error_type=%s upstream_status=%s',
                        error_id, body.route, detail['code'], type(error).__name__, getattr(error, 'status_code', None))
            status = 422 if isinstance(error, ModelCapabilityError) else 502
            raise HTTPException(status, detail) from None

    def _save(self, body, owner, result, materials):
        run_id = str(uuid.uuid4())
        data = {
            'route': result['route'], 'image': bool(body.image), 'input_source': body.text,
            'created_at': datetime.now(timezone.utc).isoformat(), 'parent_plan_id': body.base_plan_id,
            'material_names': [item['name'] for item in materials],
            **result['result'], **initial_dialogue(body, result), 'status': 'pending',
        }
        with Session() as db:
            begin_write(db, enabled=bool(body.request_id))
            self.finish_request(db, owner, body.request_id)
            db.add(Record(id=run_id, owner=owner, kind='run', data=data))
            ensure_stream_active()
            db.commit()
        return run_id
