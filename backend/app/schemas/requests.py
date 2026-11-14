"""HTTP request contracts."""
import uuid
from pydantic import BaseModel, Field
from ..ai.skills import SkillProfile

class Credentials(BaseModel):
    email: str=Field(min_length=3,max_length=254)
    password: str=Field(min_length=8,max_length=128)
    name: str=Field(default='同学',max_length=24)


class Snapshot(BaseModel):
    tasks:list[dict]=Field(max_length=5000)
    evidence:list[dict]=Field(max_length=5000)


class AgentInput(BaseModel):
    text:str=Field(min_length=1,max_length=30000)
    route:str='auto'
    image:str=''
    base_plan_id:str|None=None
    material_ids:list[uuid.UUID]=Field(default_factory=list,max_length=3)
    skill_profile:SkillProfile='auto'
    dialogue_message:str|None=Field(default=None,min_length=1,max_length=3000)
    attachment_images:list[str]=Field(default_factory=list,max_length=3)
    request_id:uuid.UUID|None=None


class CandidateReview(BaseModel):
    items:list[dict]=Field(min_length=1,max_length=100)
    indices:list[int]|None=None


class DialogueMessage(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    skill_profile: SkillProfile = 'auto'
    material_ids:list[uuid.UUID]=Field(default_factory=list,max_length=3)
    attachment_images:list[str]=Field(default_factory=list,max_length=3)
    request_id:uuid.UUID|None=None


class DialogueDecision(BaseModel):
    proposal_id: str
    apply: bool


class DialogueWithdrawal(BaseModel):
    token: str = Field(min_length=64, max_length=64)


class ArchiveInput(BaseModel):
    archived:bool=True


class MemoryAction(BaseModel):
    older_than_days:int=Field(default=30,ge=0,le=3650)
    keep_recent:int=Field(default=5,ge=0,le=1000)
