from backend.app.services.plans import dialogue_title, plan_title, plan_payload
from backend.app.schemas.agent import GeneratedRecommendation
from types import SimpleNamespace
import json


def test_short_title_preserves_full_goal_and_payload():
    goal = '准备六级，上次考试成绩为521，目前已经背诵一部分单词，但是没有做真题'
    data = {'input_source': json.dumps({'目标': goal}), 'dialogue_title': '六级提分计划', 'items': []}
    assert dialogue_title(data) == '六级提分计划'
    assert plan_title(data) == goal
    payload = plan_payload(SimpleNamespace(id='plan', data=data), [])
    assert payload['dialogue_title'] == '六级提分计划'
    assert payload['title'] == goal


def test_legacy_titles_and_overlong_values_stay_bounded():
    assert dialogue_title({'input_source': '准备六级，上次521分'}) == '六级备考计划'
    assert len(dialogue_title({'input_source': '制定个人成长学习实践反思与复盘的长期计划'})) <= 10
    assert len(dialogue_title({'dialogue_title': '这是旧数据里可能存在的过长标题'})) == 10
    assert dialogue_title({'dialogue_title': '   '}) == '准备方案'


def test_generated_title_contract_limits_model_output():
    field = GeneratedRecommendation.model_json_schema()['properties']['dialogue_title']
    text = next(schema for schema in field['anyOf'] if schema.get('type') == 'string')
    assert text['maxLength'] == 10
    assert text['minLength'] == 1
