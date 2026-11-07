"""Load the project-owned skills selected for the current Agent request."""

import json
import re
from pathlib import Path
from typing import Literal

SkillProfile = Literal['auto', 'time-management', 'english-prep', 'research-growth']
SKILL_ROOT = Path(__file__).resolve().parent
SKILL_LABELS = {
    'task-breakdown': '任务拆解',
    'time-management': '时间管理',
    'english-prep': '英语备考',
    'research-growth': '科研成长',
    'evidence-extraction': '能力证据提取',
}


def skills_for_request(route: str, profile: SkillProfile, text: str) -> list[str]:
    if route == 'evidence':
        return ['evidence-extraction']
    if route != 'recommend':
        return []
    if profile == 'auto':
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        goal = str(data.get('目标', '')) if isinstance(data, dict) else text
        if re.search(r'英语|四六级|四级|六级|cet[- ]?[46]|ielts|toefl|雅思|托福', goal, re.I):
            profile = 'english-prep'
        elif re.search(r'科研|论文|实验|课题|文献|复现|毕业设计', goal):
            profile = 'research-growth'
        else:
            profile = 'time-management'
    return ['task-breakdown', profile]


def skill_instructions(names: list[str]) -> str:
    instructions = []
    for name in names:
        if name not in SKILL_LABELS:
            raise ValueError(f'Unknown skill: {name}')
        document = (SKILL_ROOT / name / 'SKILL.md').read_text(encoding='utf-8')
        _, _, body = document.split('---', 2)
        instructions.append(f'【{SKILL_LABELS[name]}】\n{body.strip()}')
    return '\n\n'.join(instructions)
