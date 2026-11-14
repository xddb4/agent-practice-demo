"""Read-only, request-scoped profile tool."""
import json
from langchain_core.tools import tool

def profile_tool(context):
    @tool
    def profile() -> str:
        """查询当前用户已确认的能力证据和已有日程。"""
        return json.dumps(context,ensure_ascii=False)
    return profile
