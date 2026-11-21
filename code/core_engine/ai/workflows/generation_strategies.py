"""按任务类型选择生成规则，集中管理路由优先级和离线候选。"""

from dataclasses import dataclass
from typing import Callable

from backend.app.schemas.agent import DIMENSIONS


ROUTING_RULES = (
    ('evidence', ('证据', '反思', '实验结果', '作品')),
    ('recommend', ('准备', '推荐', '方案', '比赛')),
)


def select_route(state):
    requested = state.get('route', 'auto')
    if requested != 'auto':
        return requested
    for name, keywords in ROUTING_RULES:
        if any(word in state['text'] for word in keywords):
            return name
    return 'schedule'


def schedule_items(text):
    return [{'title': text[:100], 'important': False, 'urgent': False,
             'source': text, 'completion_criteria': ''}]


def evidence_items(text):
    return [{'title': text[:100], 'dimension': DIMENSIONS[0],
             'rationale': '离线模式：关联维度需人工核对，不能据此判定能力水平。', 'source': text}]


def recommendation_items(text):
    steps = [('问题定义', '写出研究问题和约束'), ('实验验证', '保留可复现实验、对照和数据'),
             ('反思表达', '记录局限、引用和后续改进')]
    return [
        {'title': f'{step}：{text[:50]}', 'estimated_minutes': 60,
         'completion_criteria': criteria, 'important': True, 'urgent': False,
         'rationale': '基于用户目标的离线初步方案，需人工核对'}
        for step, criteria in steps
    ]


@dataclass(frozen=True)
class GenerationStrategy:
    schema_description: str
    offline_items: Callable


STRATEGIES = {
    'schedule': GenerationStrategy(
        'items 每项为 title,date,start,end,deadline,location,important,urgent,estimated_minutes,description,suggested_finish,dimension；description为具体执行说明，任务名称应简短；suggested_finish为依据已有日程和用户时长建议的完成时间，缺少可用时间依据则null；dimension仅表示任务涉及的能力方向，只能从' + str(DIMENSIONS) + '中选择，无法判断填null，不据此判断能力高低；保留用户明确填写的任务类型、日期、时长与四象限，q=0重要且紧急，1重要不紧急，2不重要但紧急，3不重要不紧急；时间用带时区ISO格式，缺失填null，不猜测原通知未提供的日期',
        schedule_items,
    ),
    'evidence': GenerationStrategy(
        'items 每项为 title,dimension,rationale,source；dimension只能从' + str(DIMENSIONS) + '选择；不可通过速度、数量或偏好推断能力',
        evidence_items,
    ),
    'recommend': GenerationStrategy(
        'items 每项为 title,estimated_minutes,important,urgent；给出分阶段可执行任务，使用profile读取用户依据；只在缺少需核实的事实时使用search，不能虚构日期或来源',
        recommendation_items,
    ),
}
