# Tracekeeper

[English README](./README.md)

Tracekeeper 是一个面向本地 Agent 知识体系的 Obsidian 插件：Memory 和 Wiki 使用同一套稳定结构。

它把 AI 辅助工作变成可追踪、可审阅、可决定的候选内容：任务记忆、会话记录和记忆提案都留在 Obsidian 里。

## 安装

Tracekeeper 进入 Obsidian 社区插件目录后：

1. 打开 Obsidian **设置**。
2. 进入 **第三方插件**。
3. 如果当前 vault 还没有启用第三方插件，先启用它。
4. 点击 **浏览**，搜索 **Tracekeeper** 并安装。
5. 在已安装插件列表中启用 **Tracekeeper**。

如需手动安装或测试候选版本，可以从版本一致的 GitHub Release 安装：

1. 下载与 `manifest.json` 版本一致的 release 资产：`main.js`、`manifest.json`、`styles.css`。
2. 在当前 vault 的 Obsidian 配置目录内创建 `plugins/tracekeeper/`。
3. 将三个文件复制到该目录。
4. 重启 Obsidian 或重新加载第三方插件，然后启用 **Tracekeeper**。

## 创意

AI 很擅长发现模式、总结长对话、把散落材料整理成结构化知识。但个人知识库仍然需要一个真正的主人。

Tracekeeper 的核心想法是把边界划清楚：

- Memory 记录任务、会话、决策、偏好和项目连续性。
- Wiki 组织可复用主题、hub、来源和图谱入口。
- Memory 和 Wiki 通过明确 wikilink 串起来，让 Obsidian 图谱和 Agent 召回看到同一套结构。
- 不需要外部数据库，也不需要自动同步其他 App 数据。

AI 可以帮助回忆上下文、草拟提案、整理长期记忆，但是否写入、怎么写入，最后由你决定。

## 背景

个人知识库经常卡在两个极端：有价值的内容停留在一次性对话里，无法沉淀；或者自动化写入太积极，把 vault 变得混乱。Tracekeeper 选择站在中间。

Tracekeeper 会把 AI 给出的整理结果当成候选记忆提案。你可以在熟悉的 Obsidian 环境里检查它、修改它、通过审核、退回修改或不采纳。

## 首次使用

1. 像平时一样在 Obsidian 中记录和收集资料。
2. 启用 Tracekeeper，并打开 **设置 -> 第三方插件 -> Tracekeeper**。
3. 在 **MCP 服务** 中启动 Runtime，并确认不含凭据的 loopback 地址显示“本机访问已保护”。
4. 在 **Agent 配置** 中点击 **添加 Agent** 并选择一个 AI 工具；持久卡片会立即出现。只执行界面给出的公开原生命令，复制操作必须显式点击，且在客户端触达端点前仍标记为未验证。
5. 支持 OAuth 的客户端默认使用 OAuth：浏览器只等待，Obsidian 显示 Allow/Deny 审批；不能安全完成 OAuth 的客户端可显式选择手工 Bearer，明文凭据只在当前弹窗显示一次。配置、授权、连接、使用和 Skill 状态彼此独立。
6. 在适用时单独安装推荐的配套 Skill，再按提示重新加载 AI 工具，让它初始化 Tracekeeper 并调用一个 `tracekeeper.*` 工具。卡片在首次调用前已经存在，成功工具调用只更新使用状态。
7. 在 **知识变更审核** 中查看需要处理的记忆、Wiki、图谱或迁移候选变更。
8. 逐条编辑提案、通过审核、退回修改或不采纳；通过审核后仍需预览并明确确认写入。

## Agent 与 MCP 连接

Tracekeeper 在桌面端 Obsidian 开启时提供本机 Streamable HTTP MCP Runtime。生产 Runtime 只绑定精确的 `127.0.0.1`，每个 MCP 资源请求都必须携带属于一个持久 Agent 集成的凭据。连接地址和客户端原生命令都不含凭据；受支持客户端发现 Tracekeeper 的本机 OAuth 元数据，完成 authorization code + PKCE 与 RFC 8707 resource 绑定，再接收该 Agent 的 access token。手工 Bearer 与 OAuth 使用同一校验、Session 绑定、撤销和审计底座。

每种客户端最多一张卡、每张卡最多一个活动凭据。凭据属于具体集成，可独立替换或撤销；撤销只关闭该卡的 Session，不卸载 Skill。成功请求统一使用 Runtime 固定的 `local-user` 能力集合，MCP `clientInfo` 只作为不可信观察信息。高级区的“撤销全部 Agent 访问”会清空所有凭据和待审批请求、终止全部 Session，但保留卡片和 Skill。

AI 工具通过 `tracekeeper.*` MCP tools 连接 Tracekeeper。连接后，助手可以读取选定的 vault 上下文、构建 context pack、记录有限范围内的工作笔记，并按你的记忆规则提交更新。全局记忆默认进入知识变更审核；启用项目自动保存后，每次符合条件的操作都会在稳定项目 Hub 下创建自己的不可变 Markdown 条目。

Codex、Claude、Cursor 等 MCP 客户端共用一套配套 Skill。Skill 先选择 `no_track`、`recall_only` 或 `tracked_task`；tracked 工作只启动一次、使用返回的 task id、召回最小必要上下文并只结束一次。它不会保存 token、授予权限或复制 MCP 实现。召回内容会明确标记为知识数据而非指令，结构化 MCP action 则减少客户端二次猜测。参见 [Agent 工作流](./docs/features/AGENT_WORKFLOW.md)。

连接是 local-first 的：

- 没有 Tracekeeper 托管后端
- 没有外部数据库
- 没有 App 自动同步或后台同步服务
- 默认不上传 vault 内容
- 不执行系统命令
- MCP tools 不能访问 vault 外文件
- MCP tools 不能读取 Obsidian 配置目录

## 知识变更审核

全局长期记忆默认必须先进入知识变更审核。AI 助手提出的全局 durable memory 更新会先成为变更提案；图谱健康建议和结构迁移冲突也会进入同一个审核界面等待你确认。你可以决定通过审核、退回修改或不采纳。

审核通过和写入是两个独立动作。只有提案通过审核、完成预览并经你明确确认后，Tracekeeper 才会把内容写入对应目标笔记。

项目记忆默认更轻量：项目级更新可以自动保存为 `01_knowledge/memory/projects/<project-key>/agents/<agent-type>/` 下的只创建条目。稳定操作身份会让完全相同的重试复用同一条目，并拒绝使用已存在身份覆盖不同载荷。每个新条目都会通过 Obsidian 原生链接连接稳定项目 Hub，以及已验证的 Wiki 或 Source 笔记。现有项目 `memory.md` 仍可读取并列入目录，但不会被自动改写、拆分或迁移。

`tracekeeper.recall` 始终是按相关性选取的结果。当 Agent 需要完整枚举项目记忆时，只读的 `tracekeeper.project_memory` 会在同一个索引代次内分页列出不可变条目与旧版笔记，并且不返回笔记正文。

## 适合场景

- 优先把散落的项目记录整理成任务记忆和会话记忆。
- 将反复出现的偏好、决策和经验沉淀为长期记忆。
- 在 AI 生成内容写入 vault 前进行人工审核。
- 让 AI 协作始终围绕自己的 Obsidian 知识库展开。
- 使用稳定的 Memory + Wiki 结构，让不可变项目记忆条目持续连接项目 Hub 与主题 Hub。
- 建立一种“AI 提议，人来决定”的个人知识工作流。

## 知识图谱健康

Tracekeeper 通过只读的 `tracekeeper.lint` 统一检查 Obsidian wikilink 图谱和知识库结构。它会统计孤立节点、只有入链或出链的节点、连通分量、hub 候选、未解析 wikilink，以及推荐图谱入口是否缺失。

图谱检查策略可以在 Tracekeeper 设置中配置：

- `off`：只保留手动查看，不加入 lint。
- `advisory`：图谱问题只作为 warning 和建议。
- `strict`：缺少入口、缺少推荐 hub、孤立节点和未解析图谱链接会成为 lint error。

图谱健康不会自动创建笔记或改写链接。你可以在插件的图谱健康视图中查看结果，并显式创建知识变更提案，再决定是否补全全库入口、主题 hub 或 `Graph links` 段落。

## 设计原则

- Vault 优先：Obsidian 仍然是长期知识的归宿。
- 人工审核优先：长期记忆变更应当先经过确认。
- 可追踪优先：知识需要保留足够上下文，方便之后重新理解和判断。
- AI 是协作者：助手负责整理和提出建议，但不拥有你的 vault。

## 安全模型

Tracekeeper 是桌面端插件，因为它会托管本机 MCP Runtime。每个 MCP 资源请求都必须携带某张 Agent 卡的有效凭据；公开 OAuth 路由不能调用工具。Runtime 会校验 `Host`，把浏览器式 CORS 限制在 Obsidian 和 loopback origin，强制 PKCE 与精确 loopback redirect，并拒绝查询参数凭据。

MCP 写入范围被刻意限制：

- 工作记录只写入 Tracekeeper 控制的 vault 目录
- 生成记录不会覆盖已有笔记
- 已审核通过的内容只会追加到对应 proposal 指向的已有目标笔记
- 多步骤任务和审核写回具备幂等标识、操作日志，并在 Runtime 启动时继续恢复
- 每个 Session 使用随机标识，每次 Session 请求都会重新校验其 integration/credential 绑定，并继续执行请求体大小、会话数量、流数量和空闲时间上限
- MCP 不提供删除、重命名、批量重写和系统命令执行能力

正常 Agent 配置由客户端官方 OAuth/MCP 入口拥有；Tracekeeper 不读取或写入跨平台客户端配置路径。经确认的受管 Skill 安装仍是可恢复的 Vault 外写入。Token、digest、授权码、PKCE verifier、pending handle、token response 和 Authorization Header 都不会进入连接 URL、复制命令、AI 指令、Runtime 日志或 Vault 审计记录。

## 项目文档

- [文档总索引](./docs/INDEX.md)
- [产品概览](./docs/overview/PRODUCT.md)
- [功能文档](./docs/features/INDEX.md)
- [技术栈](./docs/technology/TECHNOLOGY_STACK.md)
- [系统架构](./docs/architecture/INDEX.md)
- [Agent 工作流](./docs/features/AGENT_WORKFLOW.md)
- [信任边界](./docs/architecture/TRUST_BOUNDARIES.md)
- [工程与发布指南](./docs/development/ENGINEERING_AND_RELEASE.md)

## 许可证

本项目采用 [MIT License](./LICENSE)。
