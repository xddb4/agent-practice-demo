"""任务路由只生成候选；保存由独立的鉴权确认接口执行。"""

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from backend.app.integrations.model import create_model, structured_model
from backend.app.integrations.model_stream import invoke_with_reply_stream
from backend.app.schemas.agent import DIMENSIONS
from backend.app.services.scheduling import planning_slots, schedule_plan
from core_engine.ai.skills import SkillProfile
from core_engine.ai.tools.profile import profile_tool
from core_engine.ai.tools.research import ResearchSession
from core_engine.ai.workflows.candidate_generation import CandidateGenerator, GenerationDependencies
from core_engine.ai.workflows.generation_strategies import select_route
from core_engine.ai.workflows.task_review import review_tasks


class State(TypedDict, total=False):
    text: str
    route: str
    context: dict
    image: str
    result: dict
    schedule_tasks: list
    materials: list[dict]
    skill_profile: SkillProfile
    dialogue_message: str | None
    attachment_images: list[str]


def model(vision=False):
    return create_model(vision)


def route(state):
    return {'route': select_route(state)}


def generate(state):
    dependencies = GenerationDependencies(
        model=model, structured_model=structured_model, research_session=ResearchSession,
        profile_tool=profile_tool, planning_slots=planning_slots, schedule_plan=schedule_plan,
        review_tasks=review_tasks, stream_reply=invoke_with_reply_stream,
    )
    return {'result': CandidateGenerator(dependencies).generate(state)}


builder = StateGraph(State)
builder.add_node('router', route)
for name in ['schedule', 'evidence', 'recommend']:
    builder.add_node(name, generate)
    builder.add_edge(name, END)
builder.add_edge(START, 'router')
builder.add_conditional_edges('router', lambda state: state['route'], {
    name: name for name in ['schedule', 'evidence', 'recommend']
})
workflow = builder.compile()
