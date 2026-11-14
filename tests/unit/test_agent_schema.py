import json
import pytest
from pydantic import ValidationError
from backend.app.schemas.agent import ScheduleOutput, EvidenceOutput, CourseOutput, RecommendationOutput

def parse(cls,item):return cls.model_validate_json(json.dumps({'items':[item],'notice':''}))
def test_schedule_valid_and_missing_time():
    x=parse(ScheduleOutput,{'title':'读文献','start':None,'end':None})
    assert x.items[0].start is None
    x=parse(ScheduleOutput,{'title':'讨论','start':'2026-11-02T14:00:00+08:00','end':'2026-11-02T15:00:00+08:00'})
    assert x.items[0].start.utcoffset().total_seconds()==28800
    partial=parse(ScheduleOutput,{'title':'研习会','start':'2026-11-02T18:30:00+08:00','end':None})
    assert partial.items[0].start is not None and partial.items[0].end is None
@pytest.mark.parametrize('item',[
 {'title':'讨论','important':'true'},
 {'title':'讨论','start':'2026-11-02T14:00:00','end':'2026-11-02T15:00:00'},
 {'title':'讨论','start':'2026-11-02T15:00:00+08:00','end':'2026-11-02T14:00:00+08:00'},
 {'title':'讨论','estimated_minutes':0},
 {'title':'讨论','fabricated_field':1},
 {'title':'  '},
])
def test_schedule_invalid(item):
    with pytest.raises(ValidationError):parse(ScheduleOutput,item)
def test_evidence_invalid_dimension():
    with pytest.raises(ValidationError):parse(EvidenceOutput,{'title':'作品','dimension':'智商','rationale':'数量多','source':'记录'})
def test_course_invalid_weeks():
    with pytest.raises(ValidationError):parse(CourseOutput,{'title':'课程','from_week':16,'to_week':1})
def test_recommendation_no_longer_requires_completion_criteria():
    result=parse(RecommendationOutput,{'title':'实验','estimated_minutes':60,'important':True,'urgent':False,'rationale':'目标需要'})
    assert result.items[0].completion_criteria is None
