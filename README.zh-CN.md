# Tracekeeper

[English README](./README.md)

Tracekeeper 是一个 Obsidian 插件，适合想让 AI 帮忙维护个人 wiki、但不希望自动化直接改写自己知识库的人。

它把 AI 辅助的知识整理变成可追踪、可审阅、可决定的候选内容：来源笔记、候选更新和人工决策都留在 Obsidian 里。

## 安装

Tracekeeper 进入 Obsidian 社区插件目录后：

1. 打开 Obsidian **设置**。
2. 进入 **第三方插件**。
3. 如果当前 vault 还没有启用第三方插件，先启用它。
4. 点击 **浏览**，搜索 **Tracekeeper** 并安装。
5. 在已安装插件列表中启用 **Tracekeeper**。

社区目录审核通过前，可以从 GitHub Release 手动安装：

1. 下载与 `manifest.json` 版本一致的 release 资产：`main.js`、`manifest.json`、`styles.css`。
2. 在当前 vault 的 Obsidian 配置目录内创建 `plugins/tracekeeper/`。
3. 将三个文件复制到该目录。
4. 重启 Obsidian 或重新加载第三方插件，然后启用 **Tracekeeper**。

## 创意

AI 很擅长发现模式、总结长对话、把散落材料整理成结构化知识。但个人知识库仍然需要一个真正的主人。

Tracekeeper 的核心想法是把边界划清楚：AI 可以帮助回忆上下文、草拟 wiki 更新、整理长期记忆，但是否写入、怎么写入，最后由你决定。

## 背景

个人知识库经常卡在两个极端：有价值的内容停留在一次性对话里，无法沉淀；或者自动化写入太积极，把 vault 变得混乱。Tracekeeper 选择站在中间。

Tracekeeper 会把 AI 给出的整理结果当成候选内容。你可以在熟悉的 Obsidian 环境里检查它、修改它、批准它，或者拒绝它。

## 首次使用

1. 像平时一样在 Obsidian 中记录和收集资料。
2. 启用 Tracekeeper，并打开 **AI 助手连接** 视图。
3. 复制连接配置，或使用插件提供的自动配置。
4. 让 AI 助手围绕某个项目、主题或问题进行总结、关联和提炼。
5. 在 **Review Queue** 中查看候选的 wiki 更新或长期记忆更新。
6. 逐条审阅、调整、批准、拒绝、暂缓或要求修订。

## Agent 与 MCP 连接

Tracekeeper 在桌面端 Obsidian 开启时提供本机 Streamable HTTP MCP Runtime。Runtime 默认绑定 loopback 地址，并使用插件生成的本地 token 作为连接 URL 或 bearer token 的一部分。

AI 工具通过 `tracekeeper.*` MCP tools 连接 Tracekeeper。连接后，助手可以读取选定的 vault 上下文、构建 context pack、记录有限范围内的工作笔记，并提出记忆更新候选。它不能静默改写长期记忆。

连接是 local-first 的：

- 没有 Tracekeeper 托管后端
- 默认不上传 vault 内容
- 不执行系统命令
- MCP tools 不能访问 vault 外文件
- MCP tools 不能读取 Obsidian 配置目录

## Review Queue

长期记忆变更必须先进入 Review Queue。AI 助手提出的 durable memory 更新会先成为候选项，由你决定批准、拒绝、暂缓或要求修订。

批准写回是独立动作。只有候选项已通过审核后，Tracekeeper 才会把已批准内容应用到对应目标笔记。

## 适合场景

- 把散落的项目记录整理成清晰的主题 wiki。
- 将反复出现的偏好、决策和经验沉淀为长期记忆。
- 在 AI 生成内容写入 vault 前进行人工审核。
- 让 AI 协作始终围绕自己的 Obsidian 知识库展开。
- 发现图谱入口缺口，让 AI 从稳定 hub 组装上下文，而不是只依赖散落叶子笔记。
- 建立一种“AI 提议，人来决定”的个人知识工作流。

## 知识图谱健康

Tracekeeper 可以通过只读的 `tracekeeper.graph_health` 工具检查 Obsidian wikilink 图谱。它会统计孤立节点、只有入链或出链的节点、连通分量、hub 候选、未解析 wikilink，以及推荐图谱入口是否缺失。

图谱检查策略可以在 Tracekeeper 设置中配置：

- `off`：只保留手动查看，不加入 lint。
- `advisory`：图谱问题只作为 warning 和建议。
- `strict`：缺少入口、缺少推荐 hub、孤立节点和未解析图谱链接会成为 lint error。

图谱健康不会自动创建笔记或改写链接。你可以在插件的图谱健康视图中查看结果，并显式创建 Review Queue 建议，再决定是否补全全库入口、主题 hub 或 `Graph links` 段落。

## 设计原则

- Vault 优先：Obsidian 仍然是长期知识的归宿。
- 人工审核优先：长期记忆变更应当先经过确认。
- 可追踪优先：知识需要保留足够上下文，方便之后重新理解和判断。
- AI 是协作者：助手负责整理和提出建议，但不拥有你的 vault。

## 安全模型

Tracekeeper 是桌面端插件，因为它会托管本机 MCP Runtime。Runtime 默认必须使用本地 token，并且只接受来自 Obsidian 或 loopback origin 的浏览器式 CORS 请求。

MCP 写入范围被刻意限制：

- 工作记录只写入 Tracekeeper 控制的 vault 目录
- 生成记录不会覆盖已有笔记
- 已批准写回只会追加到对应 proposal 指向的已有目标笔记
- MCP 不提供删除、重命名、批量重写和系统命令执行能力

用户确认的客户端配置是预期中唯一可能写到 active vault 外的操作。Tracekeeper 会先展示目标配置和变更预览，并在修改支持的 AI 工具配置文件前创建备份。

## 许可证

本项目采用 [MIT License](./LICENSE)。
