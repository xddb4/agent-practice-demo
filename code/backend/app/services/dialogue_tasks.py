"""方案任务与日程任务之间的只读投影。"""

import json
from datetime import date, datetime
from zoneinfo import ZoneInfo


LOCAL = ZoneInfo('Asia/Shanghai')


def local_time(value):
    return datetime.fromisoformat(value).astimezone(LOCAL).strftime('%H:%M') if value else ''


def task_view(item, official=None):
    if official:
        return {key: official.get(key) for key in ('title', 'description', 'date', 'start', 'end', 'duration', 'ddl', 'done')}
    return {
        'title': item['title'], 'description': item.get('description'), 'date': item.get('date'),
        'start': local_time(item.get('start')), 'end': local_time(item.get('end')),
        'duration': item.get('estimated_minutes'), 'ddl': (item.get('deadline') or '')[:10],
    }


def plan_deadline(data):
    try:
        source = json.loads(data.get('input_source', ''))
        return date.fromisoformat(source['截止日期']).isoformat()
    except (ValueError, TypeError, KeyError):
        return ''
