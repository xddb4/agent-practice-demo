import httpx
import pytest
from backend.app.integrations.search import search_public,search_provider

@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('MODEL_PROVIDER','deepseek')
    monkeypatch.setenv('MODEL_BASE_URL','https://api.deepseek.com')
    monkeypatch.setenv('MODEL_API_KEY','test-only-key')
    monkeypatch.setenv('TAVILY_API_KEY','')
    monkeypatch.setenv('SEARCH_PROVIDER','auto')
    return monkeypatch

def mock_response(monkeypatch,status,data):
    monkeypatch.setattr(httpx,'post',lambda url,**kwargs:httpx.Response(status,json=data,request=httpx.Request('POST',url)))

def test_deepseek_uses_existing_configuration(configured):
    assert search_provider()=='deepseek'
    mock_response(configured,200,{'results':[{'title':'Paper','url':'https://example.com/paper','summary':'actual search result'}]})
    result=search_public('公开测试主题')
    assert result['status']=='success' and result['checked_at']
    assert result['sources'][0]['url']=='https://example.com/paper'
    assert 'test-only-key' not in str(result)

def test_empty_is_not_unconfigured(configured):
    mock_response(configured,200,{'results':[]})
    assert search_public('公开测试主题')['status']=='empty'

@pytest.mark.parametrize('status',[401,402,403,429,500])
def test_failure_is_not_empty(configured,status):
    mock_response(configured,status,{'error':{'message':'private-provider-error'}})
    result=search_public('公开测试主题')
    assert result['status']=='failed' and result['sources']==[]
    assert 'private-provider-error' not in str(result)

def test_search_can_be_disabled(configured):
    configured.setenv('SEARCH_PROVIDER','off')
    assert search_public('公开测试主题')['status']=='not_configured'
