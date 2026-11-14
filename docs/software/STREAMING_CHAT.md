# 对话流式输出

首次推荐与后续方案对话分别使用 `POST /api/agent/stream` 和
`POST /api/plans/{plan_id}/dialogue/stream`。普通 JSON 接口继续保留。

模型调用改用 LangChain `stream()`，每收到一个数据块就尝试提取顶层
`dialogue_reply` 或 `reply` 字符串，通过 SSE 发给浏览器。只显示用户答复，
不显示 `reasoning_content`、工具参数、原始 JSON、记忆或未完成的任务结构。
模型被要求先输出答复字段；查阅资料或模型内部等待期间显示状态提示。
任务审查、预算修订或格式修复若改变答复，展示相应的新版本，最终以校验通过、
事务保存成功的结果为准。不额外调用模型来制作打字动画。

事件类型：`status`（状态）、`reply`（当前答复文字）、`complete`（已保存结果）、
`error`（分类错误）、`cancelled`（取消）。连接保持期间发送心跳，并关闭代理缓冲。
浏览器处理跨网络数据块的 UTF-8 和事件分隔符，只有 `complete` 才展示方案入口。

用户向上阅读时不强制滚动；生成中的文字可复制。“停止生成”先取消请求记录，
通知运行中的工作线程停止，并终止浏览器读取。模型迭代器在下一个数据块或
调用退出时关闭。保存前再次检查取消标记；已经提交成功的回复不能作为运行中
请求撤回，而是通过原有已完成消息撤回流程处理。

半途错误或停止后的文字仅临时显示，不作为完整回复保存，也不提供方案采纳入口。
网络异常导致结果不明时，提示重新打开对话核对，避免盲目重复提交。

实现依据：[LangChain 模型流式接口](https://docs.langchain.com/oss/python/langchain/models)
与 [FastAPI StreamingResponse](https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse)。
