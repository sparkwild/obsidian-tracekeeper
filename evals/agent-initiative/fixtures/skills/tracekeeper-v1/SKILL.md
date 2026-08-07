---
name: tracekeeper
description: Use Tracekeeper as a local Obsidian knowledge and AI-memory workflow for meaningful tasks that need scoped recall, reviewable closeout, or durable project continuity.
---

# Tracekeeper Agent Skill

这个 Skill 的职责是教学：

- 什么时候该启动 Tracekeeper；
- 用哪组 MCP 工具闭环一轮有意义的任务；
- 如何在有回执的情况下收尾，且不越权。

Skill 只负责工作流提示，不实现权限模型、vault 路径、写入审批或 MCP 传输。
It does not grant permissions or create capability exceptions.

## 适用场景（触发）

仅在以下情况启动：

- 任务与已知项目/仓库/主题重复相关；
- 结果会影响持续决策、复用规则或下一步行动；
- 工作有较明显的上下文连续性，需要跨会话接续。

以下情况不应触发：

- 简单问答、一句话转换、无上下文的零散操作；
- 纯文本清理/格式化，不涉及决策沉淀；
- 仅为查看现成配置、安装插件、或执行一次性命令。

## 先验接入要求

在执行任何 Tracekeeper 工具前，先确认 MCP 能够连接；连接失败时应明确返回失败原因，不要假设已就绪。

Skill 需支持以下场景：

- 本地 MCP 端点不可达；
- 用户尚未完成 client 配置；
- 返回 `tool not available` / `permission denied` 的运行时错误。

## Golden Workflow（执行顺序）

1. 调用 `tracekeeper.start_task`
   - 传入简洁 `goal`；已知项目时附带 `project_hint`。
2. 持久化 `task_id`。
3. 调用 `tracekeeper.recall`，优先 `scope: project`，优先执行推荐的回执 `recommended_recall`。
4. 如需更精确时再加码：
   - `tracekeeper.read_note`（仅在摘要不足时）。
5. 执行任务。
6. 仅在工作需要时触发 `tracekeeper.source_request`、`tracekeeper.capture_source`。
7. 关闭前调用 `tracekeeper.finish_task`
   - 必带 `task_id` + `summary`。
8. 报告 closeout 状态，并仅根据返回状态处理记忆：
   - `auto_propose`：按规则提交提案；
   - `review_queue`：放入人工复核队列；
   - `suggest`：仅给建议。

## 权限与写回边界

- Skill 不能授予新权限，不能修改权限边界。
- Skill 不读取/修改非 Tracekeeper MCP 公共能力。
- 不写入用户保险库的长期记忆；
- 不直接调用 `tracekeeper.apply_approved_writeback`，除非用户已批准并且工具明确要求。
- 不展示或持久化任何 MCP token、密钥、凭据。
Never expose, copy, or persist MCP token/secret values.

## 兼容与失败提示（薄适配）

Skill 适配客户端差异时，仅提供两条信息：

- 是否具备自动注入配置；
- 是否只支持可复制的配置文本。

不要在 Skill 中复制 MCP schema、权限列表、路径校验细节。

如果某客户端不支持自动分发，直接返回：

- “本地环境已具备 Tracekeeper MCP，可手动拷贝/配置”；
- 让用户确认后继续。

## 审核与回溯要求

- 把 `tracekeeper.review_queue` 视为候选列表，不是耐久事实。
- 耐久更新必须走审查后状态，不在 Skill 中承诺写入成功。
- 遇到 `tracekeeper.finish_task` 返回的 closeout 状态，应使用返回值，不猜测结构。

## 命名与安装说明

Skill 仅提供“引导型调用说明”与“错误恢复建议”，不包含仓库配置和客户端账号信息。
推荐引用仓库内的规范文档：

- `docs/architecture/AGENT_WORKFLOW_CONTRACT.md`
- `docs/architecture/INDEX.md`
- `docs/product/INDEX.md`
- `docs/engineering/INDEX.md`
- `docs/status/INDEX.md`

若需要更详细的客户化操作文案，按客户端差异生成一份薄 adapter，不触碰执行边界。
