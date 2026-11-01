"""模型候选契约；与服务商无关，校验通过仍须用户确认。"""
from datetime import date as Date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, model_validator

DIMENSIONS = ['问题发现与研究设计','计算与系统思维','实验验证与数据素养','批判性与独立思考','信息素养与学术规范','表达协作与反思']
Dimension = Literal['问题发现与研究设计','计算与系统思维','实验验证与数据素养','批判性与独立思考','信息素养与学术规范','表达协作与反思']
class Contract(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
class TaskCandidate(Contract):
    title:str=Field(min_length=1,max_length=300)
    date:Date|None=None
    start:AwareDatetime|None=None
    end:AwareDatetime|None=None
    deadline:AwareDatetime|None=None
    location:str|None=None
    important:bool=False
    urgent:bool=False
    estimated_minutes:int|None=Field(default=None,gt=0,le=10080)
    completion_criteria:str|None=None
    source:str|None=None
    @model_validator(mode='after')
    def interval(self):
        # 候选可保留通知明确提供的单端时间，正式日程保存仍要求完整区间。
        if self.start and self.end and self.end<=self.start:raise ValueError('结束时间必须晚于开始时间')
        if not self.title.strip():raise ValueError('标题不能为空白')
        return self
class CourseCandidate(Contract):
    title:str=Field(min_length=1,max_length=300)
    day:int|None=Field(default=None,ge=1,le=7)
    start:str|None=Field(default=None,pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    end:str|None=Field(default=None,pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    location:str|None=None
    from_week:int|None=Field(default=None,ge=1,le=40)
    to_week:int|None=Field(default=None,ge=1,le=40)
    pattern:Literal['all','odd','even']|None=None
    q:int|None=Field(default=None,ge=0,le=3)
    @model_validator(mode='after')
    def bounds(self):
        if self.start and self.end and self.end<=self.start:raise ValueError('课程时间无效')
        if self.from_week and self.to_week and self.to_week<self.from_week:raise ValueError('教学周范围无效')
        return self
class EvidenceCandidate(Contract):
    title:str=Field(min_length=1,max_length=300)
    dimension:Dimension
    rationale:str=Field(min_length=1,max_length=5000)
    source:str=Field(min_length=1,max_length=30000)
class ProposedTask(Contract):
    title:str=Field(min_length=1,max_length=300)
    estimated_minutes:int=Field(gt=0,le=10080)
    completion_criteria:str|None=Field(default=None,max_length=5000)
    important:bool
    urgent:bool
    date:Date|None=None
    start:AwareDatetime|None=None
    end:AwareDatetime|None=None
    rationale:str=Field(min_length=1,max_length=5000)
    task_key:str|None=Field(default=None,max_length=64)
    depends_on:list[str]=Field(default_factory=list,max_length=20)
    deadline:AwareDatetime|None=None
    suggested_finish:AwareDatetime|None=None
    suggested_sessions:list[dict]=Field(default_factory=list,max_length=400)
    @model_validator(mode='after')
    def interval(self):
        if (self.start is None)!=(self.end is None):raise ValueError('推荐时段必须提供完整起止时间')
        if self.start and self.end<=self.start:raise ValueError('推荐时段结束时间无效')
        return self
class ScheduleOutput(Contract):
    items:list[TaskCandidate]=Field(min_length=1,max_length=100)
    notice:str
class CourseOutput(Contract):
    items:list[CourseCandidate]=Field(min_length=1,max_length=100)
    notice:str
class EvidenceOutput(Contract):
    items:list[EvidenceCandidate]=Field(min_length=1,max_length=100)
    notice:str
class RecommendationOutput(Contract):
    items:list[ProposedTask]=Field(min_length=1,max_length=100)
    notice:str
def output_contract(route,image=False):
    return CourseOutput if image else {'schedule':ScheduleOutput,'evidence':EvidenceOutput,'recommend':RecommendationOutput}[route]
