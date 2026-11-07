# DeepSeek 联调记录（2026-10-29）

后续更新：DeepSeek官方搜索接口已真实调用成功，通用缓存替换算法测试关键词取得3条真实来源，并带检索时间。下表“未配置Tavily”记录是首次联调状态，现有推荐已支持直接使用DeepSeek搜索，不再依赖Tavily密钥。新测试覆盖搜索成功、空结果、未启用、服务失败等状态，避免用统一文案掩盖实际结果。

使用官方接口`https://api.deepseek.com`与模型`deepseek-flash`。密钥只存储在被Git忽略的本地`.env`，未写入本文、前端或测试用例。更换时修改`.env`并重启后端。

| 检查 | 实际结果 |
|---|---|
| `/models` 鉴权 | HTTP 200；返回Flash和Pro模型 |
| 文字日程 | 1条候选，通过时区、字段及区间校验 |
| 能力证据 | 1条候选，通过能力枚举、来源与依据校验；明确不能推断能力水平 |
| 推荐ReAct | 7项候选；实际调用profile、search；总时长480分钟对应两周每周4小时 |
| 检索缺失 | 未配置Tavily，明确未取得外部来源；没有伪造已核实资料 |
| 视觉课表 | 程序生成的英文合成图片，正确提取星期一09:00–10:00、Room A201、第1–16周；未知象限返回null |
| 前端构建 | Vite生产构建成功 |

此次只使用合成材料，不代表中文复杂课表、模糊截图、真实学生作品或大规模并发已验收。模型返回JSON后仍由Pydantic校验；失败修复一次；编辑后通过服务端review接口再次校验。review记录保存修改版，不会自动写入正式任务。

本机曾出现HTTP SDK与宿主旧Brotli解码库冲突；适配层限定使用gzip/deflate，之后实际调用通过。Qwen尚未进行相同回归，切换供应商时必须复跑。

复现：

```powershell
$env:PYTHONPATH="$PWD/.runtime"
python scripts/check_model.py
python scripts/check_model.py --live
python scripts/check_model.py --vision
```

上述真实请求会使用本地密钥并产生API用量。普通离线回归：清空进程环境中的MODEL_API_KEY后执行`python -m pytest tests/test_api.py tests/test_agent_schema.py -q`。
