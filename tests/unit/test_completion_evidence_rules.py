from backend.app.services.completion_evidence import completion_snapshot


def test_legacy_completed_flexible_tasks_become_pending_once():
    task={'id':1,'title':'精听','done':True,'ability':-1,'agent_run_id':'plan'}
    state=completion_snapshot([task,{'id':2,'done':True,'start':'08:00'},{'id':3,'done':False}],[])
    assert len(state['evidence'])==1
    candidate=state['evidence'][0]
    assert candidate['status']=='待确认' and candidate['dim']==-1
    assert candidate['agent_run_id']=='plan'
    assert not candidate['completion_details_confirmed']
    assert completion_snapshot(**state)==state
    # A queued write captured before the first response does not drop the candidate.
    late=completion_snapshot([task],[],state)
    assert late['evidence']==state['evidence']


def test_cancel_completion_retracts_pending_but_preserves_confirmed_evidence():
    state=completion_snapshot([{'id':1,'done':True}],[])
    state['tasks'][0]['done']=False
    assert completion_snapshot(**state)['evidence']==[]
    state['evidence'][0].update(status='已接受',completion_details_confirmed=True,dim=1)
    assert completion_snapshot(**state)['evidence']==state['evidence']


def test_intentionally_deleted_candidate_is_not_recreated():
    state=completion_snapshot([{'id':1,'done':True}],[])
    assert completion_snapshot(state['tasks'],[],state)['evidence']==[]
