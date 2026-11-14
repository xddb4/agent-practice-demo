from backend.app.services.completion_stats import merge_completion_ids


def test_completion_counts_are_distinct_and_survive_removal():
    done={'id':1,'done':True}
    recorded=merge_completion_ids([],[],[done])
    assert recorded==['1']
    assert merge_completion_ids(recorded,[done],[done])==['1']
    assert merge_completion_ids(recorded,[done],[])==['1']
    assert merge_completion_ids(recorded,[],[done,{'id':2,'done':True}])==['1','2']


def test_legacy_completions_are_kept_and_pending_tasks_are_not_counted():
    assert merge_completion_ids([],[{'id':7,'done':True}],[{'id':8,'done':False},{'id':9}])==['7']


def test_completion_stats_api_is_owner_scoped_and_idempotent():
    import uuid
    from fastapi.testclient import TestClient
    from backend.app.main import app
    def client():
        c=TestClient(app)
        response=c.post('/api/auth/register',json={'email':uuid.uuid4().hex+'@example.com','password':'test-password-123','name':'测试'})
        assert response.status_code==200
        return c
    a,b=client(),client()
    task={'id':31,'title':'完成记录','q':1,'done':False}
    assert a.get('/api/completion-stats').json()['completed_tasks']==0
    for done,expected in [(False,0),(True,1),(True,1),(False,1),(True,1)]:
        task['done']=done
        assert a.put('/api/state',json={'tasks':[task],'evidence':[]}).status_code==200
        assert a.get('/api/completion-stats').json()['completed_tasks']==expected
    assert a.put('/api/state',json={'tasks':[],'evidence':[]}).status_code==200
    assert a.get('/api/completion-stats').json()['completed_tasks']==1
    assert b.get('/api/completion-stats').json()['completed_tasks']==0
