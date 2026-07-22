# Tracekeeper 架构重构设计与实施计划

> 文档状态：实施设计草案
>
> 基线版本：`0.2.3`
>
> 基线日期：2026-07-22
>
> 适用仓库：`obsidian-tracekeeper`
>
> 文档性质：`tmp/` 下的评审稿，不替代 `docs/` 中的正式产品、架构、安全或状态契约

## 1. 文档目的

本文档基于当前代码、测试和正式架构文档，对 Tracekeeper 下一阶段重构给出完整的目标结构、关键机制、模块职责、迁移顺序和验收标准。

重构的核心目的不是改变产品定位，而是让已经成立的产品契约在代码中拥有清晰、可测试、可恢复的执行边界：

- Obsidian 继续作为用户维护、审核和治理本地知识的主要工作空间；
- 本地 Vault 继续作为知识与 AI 记忆的可读、可编辑、可重建事实源；
- MCP 继续作为 Agent 访问本地知识能力的协议、校验和权限边界；
- Tracekeeper Skill 只负责提高 Agent 主动调用、召回和收尾的工作习惯；
- 不引入托管控制面、云端数据库、静默上传或 SaaS 多租户模型；
- 不用一次性重写替换现有实现，而是保持工具和 Vault 格式兼容的渐进式重构。

## 2. 参考契约与证据范围

本设计受以下正式文档约束：

- [文档索引](../docs/INDEX.md)
- [产品说明](../docs/product/INDEX.md)
- [架构说明](../docs/architecture/INDEX.md)
- [Agent Workflow Contract](../docs/architecture/AGENT_WORKFLOW_CONTRACT.md)
- [安全与隐私架构](../docs/security/INDEX.md)
- [工程与发布指南](../docs/engineering/INDEX.md)
- [当前实现状态](../docs/status/INDEX.md)

当前实现证据主要来自：

- [Obsidian 插件主入口](../apps/obsidian-plugin/src/main.ts)
- [MCP 工具实现](../apps/mcp-server/src/tools.ts)
- [MCP HTTP Runtime](../apps/mcp-server/src/http-runtime.ts)
- [MCP JSON-RPC Handler](../apps/mcp-server/src/handler.ts)
- [Core Vault 扫描](../packages/core/src/scan.ts)
- [Core Context Pack](../packages/core/src/context-pack.ts)
- [MCP 冒烟测试](../apps/mcp-server/scripts/smoke.mjs)
- [Core 测试](../packages/core/scripts/test.mjs)

本文中“当前”指上述 `0.2.3` 代码基线；“目标”指尚未完全实现的重构结果。

## 3. 执行摘要

### 3.1 总体判断

Tracekeeper 的产品架构方向正确，已经形成以下稳定边界：

1. Vault 是用户拥有的事实源；
2. Obsidian 是本地人机协作与治理界面；
3. MCP 暴露受控能力并执行路径、权限和审核约束；
4. Skill 教 Agent 何时调用，不替代 MCP 权限；
5. 全局持久记忆默认审核，项目自动记忆由用户配置且保持追加式；
6. standalone MCP 只用于本地开发和测试，生产 Runtime 由桌面 Obsidian 托管。

当前主要问题不是产品方向，而是实现边界落后于已经形成的契约：

- 多文件写入缺少统一幂等、协调和恢复机制；
- 召回、Lint、图谱、任务启动等链路重复同步扫描整个 Vault；
- 插件直接依赖 MCP 源码和 Core 编译产物，应用与库的依赖方向不稳定；
- 插件 UI 同时通过 Obsidian API 和本地 HTTP 调用业务，形成双执行路径；
- MCP 工具与插件代码高度集中，业务规则、协议、文件系统和 UI 难以单测；
- 工具名称、权限、Schema、分发、本地化、文档和未来 Skill 存在多份表达；
- 当前共享 token 只能证明“持有凭证”，无法可信地区分不同 Agent；
- Runtime Session、请求体和并发写入缺少防御性上限。

### 3.2 重构核心决策

本方案采用四个核心结构：

1. **Application Kernel**：承载任务、召回、记忆候选、审核写回和来源分析等用例；
2. **KnowledgeIndex**：由 Vault 重建、由 Obsidian 事件增量更新的派生读模型；
3. **VaultWriteCoordinator**：提供操作 ID、幂等、路径协调、原子替换和恢复日志；
4. **Structured Contracts**：统一工具、工作流、能力和结果状态的机器可校验定义。

插件 UI 和 MCP 都只成为 Application Kernel 的适配器：

```text
Agent + Tracekeeper Skill
            │
            ▼
      MCP Transport Adapter ───────┐
                                   │
Obsidian View / Settings ──────────┤
                                   ▼
                         Application Kernel
                                   │
                 ┌─────────────────┼─────────────────┐
                 ▼                 ▼                 ▼
          KnowledgeIndex   VaultWriteCoordinator   Policy/Auth
                 │                 │                 │
                 └──────────── Vault Ports ──────────┘
                                   │
                  ┌────────────────┴────────────────┐
                  ▼                                 ▼
       Obsidian Vault Adapter              Node FS Adapter
        production runtime              standalone/tests only
```

## 4. 重构目标、非目标与不变量

### 4.1 重构目标

#### G1：写入正确性

- 相同请求重试不能重复追加知识块、任务收尾或来源记录；
- 多文件操作中断后能够判断已完成步骤并安全恢复；
- 外部编辑造成版本冲突时必须停止并返回可行动错误，不能静默覆盖；
- 审计必须能区分成功、失败、部分提交和恢复完成。

#### G2：大型 Vault 可扩展性

- Agent 每次 recall/start/lint 不再同步读取全部 Markdown；
- 一个用例中的所有查询共享同一代 `KnowledgeSnapshot`；
- 索引损坏或丢失时可从 Vault 完整重建；
- 索引永远不能成为独立事实源。

#### G3：代码所有权清晰

- 协议层不保存业务规则；
- UI 不重新实现路径、记忆和审核规则；
- Core 不依赖 Obsidian、HTTP、Agent 客户端配置或具体视图；
- 生产 Obsidian 与 standalone 测试使用同一组用例，不复制业务流程。

#### G4：Agent 生态一致性

- MCP、插件能力说明、Skill 和文档可以适配不同客户端措辞，但语义不可漂移；
- Skill 明确何时主动调用，MCP 明确能做什么和允许做什么；
- Agent 能依据结构化 `next_actions` 继续，而不需要猜测工具顺序。

#### G5：安全和可治理性

- 凭证身份与客户端自报名称分离；
- 不同客户端可独立撤销、轮换和限制能力；
- 现有 loopback、token、Vault 边界、敏感信息过滤和审核规则保持不变或加强。

#### G6：可测试和可发布

- 关键用例可使用内存或临时 Vault 适配器单测；
- 崩溃点、并发、重试和契约一致性可自动验证；
- 重构过程中始终保持现有公开工具和 Vault 格式兼容。

### 4.2 明确非目标

本轮重构不做以下事情：

- 不建设云端同步、用户账号、团队空间或多租户后台；
- 不把 Markdown 迁移进外部数据库；
- 不引入远程向量数据库作为必需依赖；
- 不把 Obsidian 插件变成独立 Web/SaaS 管理台；
- 不开放 Shell、任意网络访问或 Vault 外任意文件访问；
- 不让 Skill 保存 token、修改权限或直接操作 Vault；
- 不在重构期间重新设计三根目录 Vault 结构；
- 不同时重写全部 UI、全部 MCP 工具和全部 Core；
- 不以文件行数下降作为唯一成功标准。

### 4.3 必须保持的不变量

1. Markdown 与附件仍是用户可见、可备份、可编辑的数据主体；
2. `00_tracekeeper`、`01_knowledge`、`02_archive` 的现有语义保持；
3. 全局持久记忆默认进入 Review Queue；
4. 项目自动写入仍是用户主动配置、项目限定、Wiki bridge 限定和追加式；
5. MCP 不得审批自己的 proposal；
6. approval 与 apply 是不同状态；
7. 所有路径必须经过 active Vault、`.obsidian` 排除、符号链接和 traversal 检查；
8. 客户端配置仍由插件在人类确认后修改，MCP 不获得该权限；
9. `tracekeeper.*` 公共工具名称在兼容期内保持；
10. 生产 Runtime 仍由桌面 Obsidian 生命周期管理。

## 5. 当前代码结构与问题基线

### 5.1 代码规模

| 文件 | 当前行数 | 当前主要职责 |
| --- | ---: | --- |
| `apps/obsidian-plugin/src/main.ts` | 8,590 | 生命周期、设置、Runtime、配置、迁移、数据读取、View、Modal、UI 状态 |
| `apps/mcp-server/src/tools.ts` | 6,369 | 工具类型、Schema、权限、业务逻辑、文件写入、审计、dispatch、next action |
| `apps/mcp-server/src/http-runtime.ts` | 432 | HTTP、token、CORS、Session、SSE、请求读取 |
| `apps/mcp-server/src/handler.ts` | 291 | JSON-RPC、initialize、工具调用、Agent 自报信息 |
| `packages/core/src/scan.ts` | 187 | 同步目录遍历、读取、解析和 ScanResult 构建 |
| `packages/core/src/context-pack.ts` | 185 | 自行扫描、召回并组装 context pack |
| `apps/mcp-server/scripts/smoke.mjs` | 1,326 | Runtime、工具、路径、安全和流程冒烟验证 |
| `packages/core/scripts/test.mjs` | 268 | Core 临时 Vault 验证 |

行数本身不是错误，但当前两个主文件已经同时承担多层职责，导致任何小改动都可能影响协议、业务、存储和 UI。

### 5.2 当前值得保留的设计

- Core 已经集中 Markdown、召回、图谱、Lint、来源分析和路径安全等通用能力；
- MCP 默认 loopback、token 和受限 CORS；
- 工具区分 read-only、low-risk write 和 review-gated apply；
- proposal 创建、批准、应用已经在概念上分离；
- 项目自动记忆拥有内容签名和重复检测；
- 客户端配置写入会保留无关项、备份并通过临时文件替换；
- Runtime 与 Core 已有临时 Vault 冒烟测试；
- Agent Workflow Contract 已明确 Skill、MCP、插件和用户职责。

重构应围绕这些能力建立稳定接口，而不是替换它们。

## 6. 风险与根因分析

### 6.1 R1：审核写回不是可恢复操作

当前 `handleApplyApprovedWriteback` 的关键顺序是：

1. 读取目标笔记；
2. 追加 proposal 内容并直接写目标；
3. 更新 proposal 为 `applied`；
4. 追加审计；
5. 更新 task 引用。

风险窗口：

| 中断点 | 当前结果 | 重试风险 |
| --- | --- | --- |
| 目标写入前 | 无变化 | 可安全重试 |
| 目标写入后、proposal 更新前 | 目标已有内容，proposal 仍 approved | 再次追加相同块 |
| proposal 更新后、审计前 | 目标和 proposal 已变化 | 操作无完整审计，重试可能被拒绝 |
| 审计后、task 更新前 | 写回成功但 task 无引用 | 跨会话追踪不完整 |

根因不是缺少一个 `try/catch`，而是没有稳定操作身份、步骤状态和恢复协议。

### 6.2 R2：任务启动和收尾不具备请求幂等性

`start_task` 每次生成新 `task_id`；`finish_task` 默认文件名包含时间和随机 UUID。Agent 或客户端即使遵守“一次调用”指导，也可能因为响应丢失、超时或客户端自动重试而重复提交。

当前项目自动记忆通过内容签名避免部分重复，但仍不能保证：

- session note 不重复；
- task closeout body 不重复；
- proposal、audit 和 task 引用保持同一个提交结果；
- 相同 task 的第二次不同 payload 是修订还是冲突。

### 6.3 R3：一次任务启动发生至少两次完整扫描

`scanVault` 当前同步递归读取和解析全部 Markdown，并将解析内容放入 `ScannedNote`。`buildContextPack` 内部再次调用 `scanVault`。

`start_task` 同时执行：

- `scanVaultForContext(...)`；
- `buildContextPackForContext(...)`，后者再次扫描。

除此之外，status、recall、project context/history、review queue、graph health、lint、memory bridge 和 finish routing 等函数也各自发起扫描。

因为生产 Runtime 与 Obsidian 同进程，问题不仅是工具响应时间，还包括：

- 同步 I/O 阻塞 Obsidian 主线程；
- 大 Vault 内存峰值上升；
- 同一操作中前后扫描可能看到不同文件版本；
- UI 视图刷新与 Agent 请求重复解析同一批文件。

### 6.4 R4：物理依赖边界和文档边界不一致

当前插件直接导入：

- `apps/mcp-server/src/http-runtime`；
- `apps/mcp-server/src/tools`；
- `packages/core/dist/index`。

插件 workspace 自身没有声明对应运行时依赖。这会造成：

- app 依赖另一个 app 的内部源码；
- TypeScript source 与被跟踪的 `dist` 可能产生版本漂移；
- 构建顺序和本地已有产物影响类型检查结果；
- MCP 内部重构直接成为插件破坏性变更；
- 无法明确哪些 API 是稳定公共边界。

### 6.5 R5：插件内存在两条业务执行路径

当前插件部分能力直接通过 Obsidian API 读取、修改、移动文件，另一些能力通过 `callLocalMcpTool` 访问自己托管的 loopback HTTP Runtime。

这意味着同一 Obsidian 插件内部还需要承担：

- URL 与 token 拼接；
- initialize 和 Session 管理；
- JSON-RPC 序列化；
- HTTP 错误转换；
- structuredContent 再解析。

而外部 Agent 才是真正需要 MCP 传输的调用者。UI 通过 HTTP 调用自身会扩大失败面，也让 UI 和 MCP 之间形成隐性循环依赖。

### 6.6 R6：工具契约存在多份表达

当前工具相关信息至少分布在：

- `ToolName` union；
- `TOOL_NAME_SET`；
- read-only / low-risk / review-gated 集合；
- deprecated replacement map；
- public order；
- `toolDefinitions()`；
- `callTool()` switch；
- 插件 capability 本地化；
- Agent Workflow Contract；
- MCP prompt 和返回 next actions；
- 未来 Tracekeeper Skill。

这些表达用途不同，但缺少一个结构化语义源，新增或修改工具时容易出现以下漂移：

- 文档称为只读，代码却发生写入；
- Skill 使用废弃工具；
- 插件显示的风险等级和 Runtime 不一致；
- next action 参数与真实 Schema 不一致；
- compatibility 工具重新出现在公共 Agent 工作流中。

### 6.7 R7：Agent 身份是自报信息，不是授权主体

当前 Runtime 使用一个共享 token。initialize 中的 `agentId` 和 `clientName` 来自客户端提交字段，可用于调试和审计展示，但不能作为可信身份。

因此当前模型实际是：

```text
shared token = 认证主体
agentId/clientName = 未验证声明
risk level = 工具级静态分类与审计字段
```

这对单客户端本地测试足够，但无法支持以下目标：

- 单独撤销某个 Agent；
- 只允许某个客户端读取而禁止写入；
- 判断哪个可信客户端真正执行了写回；
- 给不同 Agent 限制不同项目范围；
- token 泄露后最小化影响范围。

### 6.8 R8：Runtime 防御性上限不足

当前 Session 只有显式 DELETE 或 Runtime 停止时清理，没有 TTL、空闲回收和最大数量；请求体读取也没有大小限制。

这不是远程公网服务风险，但本地错误客户端、扩展冲突或失控 Agent 仍可能造成：

- Session Map 长期增长；
- 大 JSON 请求占用过多内存；
- 长连接未释放；
- 同一路径并发写入发生 lost update。

### 6.9 R9：测试验证集中但缺少架构级故障测试

现有 Core 和 MCP smoke 能证明大量正常路径，仍缺少：

- 写回每个中断点的故障注入；
- 相同 operation 重试；
- 两个 Session 并发追加同一项目记忆；
- 外部修改后的 compare-and-swap 冲突；
- KnowledgeIndex 与全量扫描的一致性；
- Obsidian event 顺序和重复事件；
- 插件 ViewModel、配置和 onboarding 状态机；
- MCP、Skill、插件文案的契约一致性。

## 7. 目标逻辑架构

### 7.1 分层定义

#### 7.1.1 Product Surface

包括 Obsidian View、Modal、Settings、Command、通知和 onboarding。它只负责：

- 收集人类输入；
- 展示状态、差异、风险和恢复建议；
- 请求应用层执行动作；
- 管理 Obsidian 插件和 Runtime 生命周期；
- 对 Vault 外客户端配置操作进行确认。

Product Surface 不得直接实现记忆规则、路径白名单或 proposal 状态机。

#### 7.1.2 Transport Adapter

包括 MCP Streamable HTTP、JSON-RPC、Session、认证头、工具 Schema 暴露和结果封装。它只负责：

- 将协议请求转换为 application command/query；
- 解析可信 credential principal 与未验证 client claims；
- 根据 Tool Contract 做输入校验和 capability 检查；
- 将 application result 转成 MCP structuredContent；
- 处理 transport 级错误、超时和 Session。

Transport Adapter 不得直接扫描或修改 Vault。

#### 7.1.3 Application Kernel

Application Kernel 编排用例、策略、读模型和写协调器。它负责：

- 任务生命周期；
- 召回和 context pack；
- 记忆策略路由；
- proposal 创建、审核状态和应用；
- 来源请求和来源捕获；
- Lint、图谱健康和结构检查；
- operation recovery；
- 结构化 next actions。

Application Kernel 不依赖 Obsidian UI 或 HTTP。

#### 7.1.4 Domain

Domain 定义稳定业务概念和不变量：

- `AgentTask`；
- `MemoryProposal`；
- `MemoryPolicy`；
- `KnowledgeScope`；
- `ProjectIdentity`；
- `WriteOperation`；
- `OperationId` / `IdempotencyKey`；
- `CredentialPrincipal` / `ClientClaim`；
- `ReviewDecision`；
- `KnowledgeSnapshotVersion`。

Domain 对文件格式、Obsidian 和 MCP 无感知。

#### 7.1.5 Ports

应用层通过 Port 访问外部能力：

```ts
export interface VaultRepository {
  readText(path: VaultPath): Promise<VaultTextFile>;
  createText(path: VaultPath, content: string): Promise<VaultWriteReceipt>;
  replaceText(
    path: VaultPath,
    expectedVersion: FileVersion,
    content: string
  ): Promise<VaultWriteReceipt>;
  listMarkdown(scope?: VaultScope): Promise<readonly VaultFileMetadata[]>;
}

export interface KnowledgeIndex {
  snapshot(): Promise<KnowledgeSnapshot>;
  rebuild(): Promise<KnowledgeIndexReport>;
  apply(event: VaultIndexEvent): Promise<void>;
}

export interface OperationJournal {
  prepare(operation: PreparedOperation): Promise<void>;
  markStep(operationId: OperationId, step: OperationStep): Promise<void>;
  complete(operationId: OperationId, result: OperationResult): Promise<void>;
  listRecoverable(): Promise<readonly RecoverableOperation[]>;
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
}
```

接口名称可在实现时调整，但依赖方向必须保持。

#### 7.1.6 Adapters

需要两个主要 Vault Adapter：

| Adapter | 用途 | 实现原则 |
| --- | --- | --- |
| `ObsidianVaultAdapter` | 插件生产 Runtime | 使用 Obsidian Vault/FileManager API，协调 metadata cache 和 file events |
| `NodeFsVaultAdapter` | standalone MCP、CLI fixture、smoke | 使用安全路径解析、原子临时文件替换和 filesystem snapshot |

两者必须通过相同契约测试，保证写入和路径语义一致。

### 7.2 推荐物理目录

最终推荐结构如下：

```text
apps/
├─ obsidian-plugin/
│  └─ src/
│     ├─ main.ts
│     ├─ composition/
│     ├─ adapters/
│     │  ├─ obsidian-vault-adapter.ts
│     │  ├─ obsidian-event-source.ts
│     │  └─ client-config-adapter.ts
│     ├─ features/
│     │  ├─ onboarding/
│     │  ├─ activity/
│     │  ├─ recall/
│     │  ├─ review/
│     │  ├─ source-status/
│     │  ├─ graph-health/
│     │  ├─ runtime-status/
│     │  └─ settings/
│     └─ shared-ui/
└─ mcp-server/
   └─ src/
      ├─ server.ts
      └─ node-composition-root.ts

packages/
├─ contracts/
│  └─ src/
│     ├─ tool-contracts.ts
│     ├─ workflow-contract.ts
│     ├─ result-contracts.ts
│     └─ versions.ts
├─ core/
│  └─ src/
│     ├─ domain/
│     ├─ application/
│     ├─ ports/
│     ├─ knowledge/
│     ├─ policies/
│     └─ adapters/
│        └─ node-fs/
└─ mcp-runtime/
   └─ src/
      ├─ protocol/
      ├─ transport/
      ├─ auth/
      ├─ sessions/
      └─ tool-adapter.ts
```

这是一张目标地图，不要求第一批 PR 立即创建全部目录。实施时先建立真实依赖边界，再逐步移动代码。

### 7.3 Workspace 依赖方向

允许的依赖方向：

```text
contracts
   ▲
   │
core
   ▲
   │
mcp-runtime
   ▲          ▲
   │          │
mcp-server   obsidian-plugin
```

更准确地说：

- `contracts` 不依赖其他 workspace；
- `core` 可依赖 `contracts`，但不依赖 MCP 或 Obsidian；
- `mcp-runtime` 依赖 `contracts` 和 Core Application API；
- `apps/mcp-server` 依赖 Core、MCP Runtime 和 Node Adapter；
- `apps/obsidian-plugin` 依赖 Core、MCP Runtime、Contracts 和 Obsidian Adapter；
- app 不得导入另一个 app 的 `src/`；
- workspace 不得导入其他 workspace 的 `dist/` 相对路径；
- 所有跨 workspace 引用必须通过声明的 package exports。

## 8. Application Kernel 设计

### 8.1 Command 与 Query 分离

Query 不改变 Vault：

- `GetRuntimeStatus`；
- `RecallKnowledge`；
- `ReadKnowledgeNote`；
- `BuildContextPack`，当 `persist=false`；
- `InspectReviewQueue`；
- `LintKnowledge`；
- `InspectGraphHealth`；
- `ListSourceRequests`；
- `GetProjectHistory`，作为兼容内部 query。

Command 可能写入：

- `StartTask`；
- `FinishTask`；
- `PersistContextPack`；
- `CaptureSource`；
- `AnalyzeSourceRequest`；
- `ProposeMemory`；
- `ChangeProposalReviewState`，仅插件人类入口；
- `ApplyApprovedWriteback`；
- `ArchiveReviewItems`，仅插件人类入口；
- `MigrateVaultStructure`，仅插件人类入口；
- `RecoverOperation`，系统启动入口。

### 8.2 用例输入必须携带执行上下文

```ts
export interface UseCaseContext {
  principal: CredentialPrincipal;
  clientClaim: ClientClaim | null;
  sessionId: string | null;
  taskId: string | null;
  operationId: OperationId | null;
  contentLanguage: ContentLanguage;
  now: Instant;
}
```

规则：

- `principal` 来自已验证 token，不由 MCP 参数直接提供；
- `clientClaim` 只用于显示和诊断；
- 所有 command 必须获得或生成 `operationId`；
- 时间和 ID 生成通过 Port 注入，保证测试可重复；
- 业务逻辑不得在多个函数内重复调用 `Date.now()` 或 `randomUUID()` 来决定同一操作身份。

### 8.3 统一结果模型

每个公开用例返回结构化结果：

```ts
export interface UseCaseResult<T> {
  ok: boolean;
  status: ResultStatus;
  data?: T;
  operation?: OperationSummary;
  warnings: readonly ResultWarning[];
  nextActions: readonly AgentNextAction[];
}
```

`nextActions` 必须使用稳定语义，而不是只返回自然语言：

```ts
export interface AgentNextAction {
  kind: 'call_tool' | 'read_note' | 'open_in_obsidian' | 'user_review' | 'retry' | 'none';
  tool?: PublicToolName;
  arguments?: Record<string, unknown>;
  reasonCode: string;
  message: LocalizedText;
}
```

Skill 可以直接遵循该结果，不需要根据字符串猜测下一步。

## 9. 核心领域状态机

### 9.1 AgentTask

推荐状态：

```text
active ──► closing ──► completed
   │           │
   │           └────► recovery_required
   └───────────────► abandoned
```

约束：

- `start_task` 创建 `active`；
- `finish_task` 先通过 coordinator 进入 `closing`；
- session、memory routing、task update 和 audit 完成后才变为 `completed`；
- 相同 `finish operation_id` 重试返回第一次的结果；
- 已完成 task 收到不同幂等键的 finish 请求时返回 `task_already_completed`；
- 如需修改收尾内容，应设计显式 `revise_task_closeout`，不能隐式覆盖。

### 9.2 MemoryProposal

推荐状态：

```text
pending ──► revision_requested ──► pending
   │
   ├──────► approved ──► applying ──► applied
   │                       │
   │                       └────────► recovery_required
   ├──────► rejected
   └──────► archived
```

约束：

- MCP 可以创建 proposal，但不能把它设为 `approved`；
- 只有插件人类操作可以进入 `approved`、`rejected`、`revision_requested`；
- `applying` 由 `ApplyApprovedWriteback` 在 journal prepare 后设置；
- `applied` 必须记录 operation ID、目标路径、目标版本和时间；
- proposal 内容或目标在批准后发生变化时，批准失效并要求重新审核；
- 兼容期内仍需读取现有 `approval_status` 字段。

### 9.3 WriteOperation

推荐状态：

```text
prepared
  └─► target_committed
        └─► proposal_committed
              └─► task_committed
                    └─► audit_committed
                          └─► completed
```

任意非终态在 Runtime 重启后都必须能进入：

- `completed`：安全补齐剩余步骤；
- `conflict`：检测到用户或外部进程修改，停止自动恢复；
- `failed`：不可重试错误，保留诊断；
- `rolled_forward`：已有目标写入，恢复后补齐元数据和审计。

不建议尝试跨文件“回滚”用户可见 Markdown，因为回滚可能覆盖用户在中间窗口中的新编辑。优先采用幂等的 roll-forward。

## 10. KnowledgeIndex 详细设计

### 10.1 设计原则

1. Vault 文件是事实源；
2. Index 是可删除、可重建的派生状态；
3. Index 不拥有审核状态或记忆事实；
4. 一个 use case 只读取一个稳定 snapshot；
5. 初始重建不能长期阻塞 Obsidian UI；
6. 生产使用 Obsidian event，standalone 使用 filesystem snapshot；
7. 全量扫描保留为恢复和一致性验证工具。

### 10.2 索引记录

```ts
export interface IndexedKnowledgeNote {
  path: VaultPath;
  fileVersion: FileVersion;
  title: string;
  aliases: readonly string[];
  type: string | null;
  tags: readonly string[];
  frontmatter: Readonly<Record<string, unknown>>;
  headings: readonly IndexedHeading[];
  blockIds: readonly string[];
  wikilinks: readonly IndexedLink[];
  backlinks: readonly VaultPath[];
  searchTokens: readonly string[];
  excerptSource: string;
  contentHash: string;
  modifiedAt: string;
  size: number;
}
```

完整正文默认不需要常驻索引。`read_note` 或需要生成精确 excerpt 时可按路径和 `fileVersion` 延迟读取。

### 10.3 生命周期

#### 启动

1. Runtime 创建 Index，状态为 `initializing`；
2. 如果存在兼容缓存，先校验版本和 Vault identity；
3. 异步分批读取 Markdown；
4. 建立 forward links、backlinks、类型和 scope 映射；
5. 发布第一代 `KnowledgeSnapshot`；
6. 状态变为 `ready`；
7. 初始化期间的 Vault events 按顺序排队并在 snapshot 发布前应用。

#### 增量事件

| Obsidian 事件 | Index 动作 |
| --- | --- |
| create | 解析新文件，新增记录，更新 link edges |
| modify | 按新 file version 重建该记录和相关 edges |
| delete | 删除记录，清理 forward/backlink edges |
| rename | 原子更新 path、入边、出边和 scope 映射 |

事件必须具备去重能力。相同 path/version 的重复 modify 不应重复解析。

#### 重建

触发条件：

- 用户执行“重建知识索引”；
- Index schema version 不匹配；
- event sequence 发现不可恢复缺口；
- 一致性检查失败；
- 本地缓存损坏。

重建期间可以继续提供上一代 snapshot，但结果必须携带 `index_state: rebuilding` 和可能过期警告。

### 10.4 Snapshot 一致性

```ts
export interface KnowledgeSnapshot {
  version: KnowledgeSnapshotVersion;
  createdAt: string;
  notes: ReadonlyMap<VaultPath, IndexedKnowledgeNote>;
  graph: KnowledgeGraphSnapshot;
  scopes: KnowledgeScopeIndex;
}
```

`StartTask` 应只获得一次 snapshot，然后将它传递给：

- related project 发现；
- context pack 生成；
- recommended recall；
- graph/memory bridge 判断。

禁止子函数自行再次调用全量扫描。

### 10.5 Index 持久化策略

分两阶段实施：

#### 第一阶段：内存 Index

- 启动时重建；
- 使用 Obsidian event 增量维护；
- 不新增持久格式；
- 先验证查询接口和事件一致性。

#### 第二阶段：可选本地缓存

- 缓存只能放在插件私有数据区域或明确的 Tracekeeper control cache；
- 缓存必须包含 schema version、Vault identity 和文件版本；
- 删除缓存不能丢失任何知识；
- 缓存不得被 recall 当成第二份笔记来源；
- standalone 测试不依赖用户真实缓存。

本轮不需要向量数据库。后续即使增加 embedding，也只能作为可重建索引字段。

### 10.6 Index 验收标准

- `start_task` 不再触发两次全量扫描；
- ready 状态下 recall/lint/graph/status 不执行同步全库读取；
- create/modify/delete/rename 后查询结果与全量扫描一致；
- Index 删除后能从同一 Vault 得到等价结果；
- 初始化和重建不会长时间阻塞 Obsidian UI；
- 查询结果包含 snapshot/index 状态，便于诊断。

## 11. VaultWriteCoordinator 详细设计

### 11.1 职责

`VaultWriteCoordinator` 是所有多步骤写入的唯一编排入口，负责：

- 获取或验证 `operation_id`；
- 检查 idempotency key 是否已有结果；
- 计算所有触及路径；
- 按稳定顺序获取路径锁；
- 读取目标版本并验证前置条件；
- 创建 journal；
- 执行单文件原子写或追加；
- 标记每个提交步骤；
- 追加业务审计；
- 返回第一次提交的稳定结果；
- 启动时恢复未完成操作。

### 11.2 操作身份

推荐区分：

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `operation_id` | Runtime 生成或客户端提供后校验 | 唯一标识一次写操作 |
| `idempotency_key` | 客户端稳定请求键 | 响应丢失后的安全重试 |
| `task_id` | `start_task` 返回 | 业务任务关联 |
| `proposal_id` | proposal 文件 | 审核写回关联 |
| `principal_id` | token credential | 可信执行主体 |
| `session_id` | MCP Session | 传输诊断，不作为授权主体 |

同一个 principal、tool、idempotency key 应返回同一个结果。相同 key 但 payload hash 不同必须返回 `idempotency_conflict`。

### 11.3 Journal 存储决策

建议在目标 Vault 的 Tracekeeper control 区新增：

```text
00_tracekeeper/control/operations/<operation_id>.json
```

原因：

- operation 是本地 Vault 相关运行状态；
- plugin 与 standalone adapter 都能恢复；
- 不依赖外部数据库；
- JSON 不进入 Markdown recall；
- 每个 operation 独立文件，避免单一 append log 成为恢复热点。

示例：

```json
{
  "schema_version": 1,
  "operation_id": "op_...",
  "idempotency_key": "...",
  "kind": "apply_approved_writeback",
  "status": "target_committed",
  "principal_id": "client_...",
  "task_id": "obs_task_...",
  "proposal_id": "prop_...",
  "payload_hash": "sha256:...",
  "paths": [
    "01_knowledge/memory/projects/demo/memory.md",
    "00_tracekeeper/inbox/review_queue/proposal.md"
  ],
  "preconditions": {
    "target_version": "...",
    "proposal_version": "...",
    "proposal_status": "approved"
  },
  "committed_steps": ["target"],
  "created_at": "...",
  "updated_at": "..."
}
```

该目录属于目标设计，正式实施时必须同步更新 architecture、security、status 和 required structure/lint 规则。

### 11.4 单文件原子写

Node adapter：

1. 在同目录创建唯一临时文件；
2. 写入完整内容；
3. 必要时 flush；
4. 再次验证 expected version；
5. rename 替换目标；
6. 清理临时文件。

Obsidian adapter：

- 优先使用 `vault.process` 或 `vault.modify`；
- 在 process callback 中验证目标 hash/block；
- 写入后等待或验证 metadata/event 更新；
- 不能绕过 Obsidian API 直接使用 Node `fs` 修改生产 Vault Markdown。

### 11.5 路径协调

进程内使用 per-Vault、per-path mutex：

```text
lock key = canonical vault identity + normalized vault-relative path
```

多路径操作按规范化路径排序后获取锁，避免死锁。锁只解决进程内并发；外部编辑通过 expected version/hash 检测。

### 11.6 Approved Writeback 幂等流程

1. 校验 principal capability 为 `apply-approved`；
2. 读取 proposal，确认状态为 approved；
3. 计算 proposal payload hash 和目标 expected version；
4. 生成稳定 block ID：`writeback-<proposal_id>`；
5. 检查目标是否已经存在该 block：
   - 已存在且内容 hash 相同：视为目标步骤已提交；
   - 已存在但内容不同：返回 conflict；
6. prepare journal；
7. 追加目标块并原子替换，标记 `target_committed`；
8. 更新 proposal 为 applied，记录 operation/block/target version；
9. 更新 task 引用；
10. 写用户可读 audit projection；
11. complete journal；
12. 返回稳定 result。

### 11.7 FinishTask 幂等流程

1. 验证 task 仍为 active 或存在相同未完成 operation；
2. 使用 task ID、principal 和 idempotency key 建立 operation；
3. 把 task 标记为 closing；
4. 为 session note 生成由 operation ID 派生的稳定路径；
5. 路由 memory candidates；
6. 自动写入项目记忆时使用每条 candidate 的稳定 child operation ID；
7. 创建 Review Queue proposal 时使用稳定 proposal ID；
8. 更新 task 为 completed；
9. 写 audit；
10. 返回同一 operation 的首次结果。

### 11.8 恢复策略

Runtime 启动时：

1. 列出非终态 journal；
2. 逐条重新验证 Vault 文件和 block；
3. 已提交步骤不得重复执行；
4. 安全步骤自动 roll-forward；
5. 发现用户编辑冲突时标记 conflict；
6. 在插件 Runtime Status 中显示恢复结果；
7. 需要用户选择时打开本地治理入口，不允许 Agent 自动覆盖。

## 12. Structured Contracts 与 Skill/MCP 分工

### 12.1 三类契约必须分开

| 契约 | 解决的问题 | 不负责 |
| --- | --- | --- |
| Agent Workflow Contract | 何时启动、何时召回、何时读取完整笔记、何时收尾 | 具体 transport、路径校验和权限实现 |
| Tracekeeper Skill | 把工作流契约适配到具体 Agent 的主动行为 | 授权、Vault 写入和工具实现 |
| MCP Tool Contract | 工具输入输出、状态、错误、capability、幂等和 next action | 判断普通对话是否值得建立任务 |

### 12.2 ToolContractRegistry

建议 `packages/contracts` 定义：

```ts
export interface ToolContract<Name extends string = string> {
  name: Name;
  version: number;
  visibility: 'public' | 'compatibility' | 'internal';
  capability: Capability;
  risk: 'read-only' | 'low-risk-write' | 'review-gated-write';
  inputSchema: JsonSchema;
  resultSchema: JsonSchema;
  useCase: ApplicationUseCaseName;
  deprecated?: {
    replacement: PublicToolName;
    removalAfter?: string;
  };
}
```

由 registry 派生：

- MCP `tools/list`；
- `ToolName` 类型；
- public order；
- capability/risk 查找；
- deprecated replacement；
- plugin capability 列表基础数据；
- contract tests；
- 文档工具矩阵中的机器校验区段。

`callTool` 不再维护大型 switch，可使用 registry 中的 use case key 路由到 handler map。

### 12.3 WorkflowContract

Workflow contract 的结构化部分至少包括：

- meaningful task triggers；
- noise exclusions；
- start/recall/read/finish 顺序；
- stable hints；
- closeout required/optional fields；
- durable memory 状态语义；
- unavailable MCP 时的失败行为；
- token 不得进入日志和记忆的规则。

自然语言文档仍可保留，但 CI 应验证 MCP next actions、Skill 和插件 onboarding 没有违反结构化约束。

### 12.4 Skill 包装原则

Tracekeeper Skill 应保持短小和主动：

- 识别有持续价值的任务；
- 开始时调用一次 `start_task`；
- 优先使用 `recall`，需要时再 `read_note`；
- 保存 `task_id`；
- 完成时调用一次 `finish_task`；
- 明确报告 auto-saved、queued、ignored、requires user action；
- MCP 不可用时明确停止 Tracekeeper 工作流，但继续用户主任务；
- 不复制所有工具 Schema；
- 不保存 token；
- 不宣称未经验证的连接或安装成功。

Skill 可提高主动性，但所有权限和写入安全仍由 Runtime 保证。

## 13. 身份、权限与 Runtime 加固

### 13.1 身份模型

```ts
export interface CredentialPrincipal {
  principalId: string;
  credentialId: string;
  capabilities: ReadonlySet<Capability>;
  projectScopes: readonly ProjectScope[];
  issuedAt: string;
  expiresAt: string | null;
}

export interface ClientClaim {
  agentId: string | null;
  clientName: string | null;
  clientVersion: string | null;
}
```

审计必须分别写：

- `principal_id`：可信；
- `credential_id`：可信但不含 token；
- `claimed_agent_id`：未验证；
- `claimed_client_name`：未验证；
- `session_id`：传输上下文。

### 13.2 Capability 建议

| Capability | 允许行为 |
| --- | --- |
| `vault.read` | status、recall、read note、lint、inspect queue |
| `work.write` | task、session、context pack、source analysis 等受控工作记录 |
| `memory.propose` | 创建 Review Queue candidate |
| `memory.project-auto-write` | 执行用户启用的项目追加规则 |
| `memory.apply-approved` | 应用已经由用户批准的 proposal |

capability 不能绕过 proposal 状态或路径白名单。例如拥有 `memory.apply-approved` 仍只能应用已批准 proposal。

### 13.3 Token 生命周期

- 每个客户端独立生成高熵 token；
- Runtime 只保存 token hash 和 metadata；
- 明文 token 只在生成、复制或写入客户端配置时出现；
- 插件支持撤销、轮换和最后使用时间；
- 轮换前展示受影响客户端；
- 配置审计不得记录明文 URL/token；
- 迁移期保留 legacy shared token，并明确标记为 full-access credential。

### 13.4 Runtime 限制

建议默认值在实现阶段通过测试确定，但必须具备：

- 请求体最大字节数；
- 最大活跃 Session 数；
- Session idle TTL；
- 每 Session 最大 stream 数；
- 初始化前禁止 tools/call；
- Content-Type 校验；
- token 使用常量时间比较；
- 请求超时和明确错误码；
- Runtime 停止时关闭全部连接和恢复资源。

## 14. Obsidian 插件重构

### 14.1 `main.ts` 的目标职责

最终 `main.ts` 只保留：

1. 加载和规范化设置；
2. 创建 composition root；
3. 启动/停止 Application Kernel 和 MCP Runtime；
4. 注册 View、Command、Settings 和 event source；
5. 在 unload 时释放资源。

它不再包含：

- 大量 record/parser helper；
- client config merge/write 细节；
- Review Queue 状态机；
- MCP HTTP client；
- recall result 业务解析；
- 所有 Modal 和 View 实现；
- legacy migration 编排；
- audit log 文件解析。

### 14.2 Composition Root

```text
TracekeeperPlugin.onload
  ├─ SettingsRepository
  ├─ ObsidianVaultAdapter
  ├─ ObsidianEventSource
  ├─ KnowledgeIndex
  ├─ OperationJournal
  ├─ VaultWriteCoordinator
  ├─ ApplicationKernel
  ├─ McpRuntime(ApplicationKernel)
  └─ FeatureControllers/ViewModels
```

所有对象在一个地方装配，Feature 不自行创建 Runtime、Index 或 Repository。

### 14.3 Feature Slice

每个插件 feature 包含：

```text
features/review/
├─ review-controller.ts
├─ review-view-model.ts
├─ review-view.ts
├─ review-modals.ts
└─ review-view-model.test.ts
```

View 只渲染 ViewModel；Controller 调用 Application Kernel；文件读取和状态转换不放进 View。

推荐优先拆分顺序：

1. `review`：与 P0 写回 coordinator 直接相关；
2. `runtime-status` 与 `settings`：用于展示恢复和索引状态；
3. `onboarding`：需要 Runtime、client config、Skill 和验证状态；
4. `recall`：改为直接调用 Application Kernel；
5. `activity` / `runtime-log`；
6. `source-status` / `graph-health`；
7. 其他 inspection view。

### 14.4 移除插件自调用 HTTP

以下插件动作应直接调用 Application Kernel：

- preview approved writeback；
- apply approved writeback；
- memory recall；
- source request analysis；
- queue/status refresh。

只有外部 Agent 客户端经过 MCP HTTP。这样可以：

- 消除插件内部 token/Session/JSON-RPC 失败面；
- 保留同一业务实现；
- 让 UI 测试使用 fake kernel；
- 保留 MCP 端到端测试验证适配层。

### 14.5 ClientConfigAdapter

当前备份、临时文件和保留其他 MCP entries 的行为应保留并抽离。接口需要明确：

- `previewChange(clientId)`；
- `applyConfirmedChange(planId)`；
- `removeConfirmedChange(planId)`；
- `verifyInstalledConfig(clientId)`；
- `openTarget(clientId)`。

plan 必须包含目标路径、原始 hash、预览 diff 和过期时间。确认后若文件 hash 已变，应重新预览而不是覆盖。

### 14.6 UI 技术边界

本轮重构继续使用 Obsidian 原生 API 和轻量本地组件。不要把模块拆分和 UI 框架迁移混在一起。

如果未来引入开源组件库，应独立验证：

- bundle size；
- Obsidian theme variables；
- CSS isolation；
- 键盘和焦点；
- accessibility；
- View/Modal 生命周期清理。

## 15. MCP Runtime 与工具层重构

### 15.1 MCP 请求流水线

目标流水线：

```text
HTTP request
  → origin/token/body/session validation
  → credential principal resolution
  → JSON-RPC validation
  → ToolContract lookup
  → input schema validation
  → capability authorization
  → application use case
  → result schema validation
  → MCP structuredContent mapping
  → transport audit summary
```

业务审计由 Application Kernel 生成；transport audit 记录连接、耗时和协议结果。二者不应依赖同一个 best-effort append 来证明事务完成。

### 15.2 Tool Adapter

```ts
const toolHandlers: ToolHandlerMap = {
  'tracekeeper.status': queryHandler('getRuntimeStatus'),
  'tracekeeper.recall': queryHandler('recallKnowledge'),
  'tracekeeper.start_task': commandHandler('startTask'),
  'tracekeeper.finish_task': commandHandler('finishTask'),
  'tracekeeper.apply_approved_writeback': commandHandler('applyApprovedWriteback')
};
```

handler 只做：

- MCP 参数名与 application DTO 的映射；
- compatibility alias 转换；
- application error 到 MCP error/result 的转换。

handler 不应使用 `fs`、扫描 Vault 或构建 Markdown。

### 15.3 Compatibility 工具

兼容工具保持可调用，但：

- 不进入公共 `tools/list`，除非当前客户端兼容策略需要；
- 内部映射到同一个新 use case；
- 返回 `deprecated` 和 replacement；
- 不维护第二份业务逻辑；
- 删除前必须经过版本化弃用周期和 release notes。

## 16. Core 包重构

### 16.1 保留的纯能力

以下逻辑适合保留在 Core 并逐步纯化：

- Markdown/frontmatter parsing；
- wikilink、heading、block、claim/evidence 解析；
- recall ranking；
- context pack projection；
- graph health；
- lint rules；
- source analysis；
- knowledge architecture constants；
- legacy structure mapping；
- Vault-relative path value object 和安全规则。

### 16.2 从 Core 中隔离的基础设施

当前同步 `scanVault` 应变成 Node adapter 或 compatibility facade。纯 Core 接收 `KnowledgeSnapshot` 或 `readonly ScannedNote[]`，而不是自行访问文件系统。

目标形式：

```ts
export function recallKnowledge(
  snapshot: KnowledgeSnapshot,
  query: RecallQuery
): RecallResult;

export function buildContextPack(
  snapshot: KnowledgeSnapshot,
  request: ContextPackRequest
): ContextPack;
```

这能直接消除 `buildContextPack` 的隐式扫描副作用。

### 16.3 Path Safety

路径安全必须继续处于最低可复用层，并覆盖：

- 相对路径规范化；
- Vault root containment；
- `.obsidian` 或 active config dir 排除；
- symlink segment；
- Windows/macOS 路径差异；
- Unicode 和大小写边界；
- allowed read/write scope；
- journal、临时文件和 client config 的不同策略。

## 17. 错误模型

建议采用稳定错误 code，message 可本地化：

| Code | 含义 | Agent/用户动作 |
| --- | --- | --- |
| `invalid_input` | 参数不符合契约 | 修正参数，不自动扩大范围 |
| `unauthenticated` | token 无效 | 重新连接或配置 |
| `capability_denied` | principal 无权限 | 用户调整客户端权限 |
| `vault_boundary_violation` | 路径越界或受保护 | 不重试 |
| `task_already_completed` | task 已完成 | 使用已有结果或显式修订 |
| `idempotency_conflict` | 同 key 不同 payload | 生成新 key 或人工确认 |
| `proposal_not_approved` | proposal 不可应用 | 在 Obsidian 审核 |
| `write_conflict` | 文件已被外部修改 | 刷新预览并重新审核 |
| `operation_recovery_required` | 操作处于部分提交 | 打开 Runtime Status |
| `index_initializing` | 索引尚未就绪 | 等待或使用明确降级路径 |
| `index_rebuilding` | 使用上一代 snapshot | 可继续，但显示警告 |
| `sensitive_content_rejected` | 检测到疑似秘密 | 移除敏感内容 |

不要让 Agent 根据英文错误字符串决定控制流。

## 18. Audit、Operation Journal 与运行日志

三者职责必须分开：

| 数据 | 用途 | 是否事实源 |
| --- | --- | --- |
| Operation Journal | 恢复多步骤写入 | 是操作恢复事实源，不是知识事实源 |
| Business Audit | 用户可读的动作归因和结果 | 是治理记录，不承担事务恢复 |
| Runtime/Transport Log | 调试连接、错误和性能 | 诊断数据，可按保留策略清理 |

业务审计建议记录：

- operation ID；
- principal/credential ID；
- claimed client；
- tool/use case；
- task/proposal ID；
- bounded target paths；
- result status；
- duration；
- risk/capability；
- recovery outcome；
- warnings。

不得记录：

- token；
- authorization header；
- password/API key/cookie；
- 完整敏感 payload；
- 无限制的完整笔记正文。

## 19. Onboarding 与 Agent 生态接入

重构后的 onboarding 应是可恢复状态机，而不是一次性说明页面：

```text
vault_check
  → runtime_start
  → client_select
  → config_preview
  → config_confirmed
  → skill_install_or_copy
  → client_restart_wait
  → connection_verify
  → first_recall
  → completed
```

每一步存储：

- 当前状态；
- 已完成时间；
- 可恢复动作；
- 验证证据；
- 失败原因；
- 是否需要用户离开 Obsidian 重启 Agent。

约束：

- 插件不能在未验证时显示“连接成功”；
- Skill 安装成功和 MCP 连接成功是两项独立检查；
- client config 变更必须先预览后确认；
- onboarding 使用新的 credential principal，而不是默认复制一个长期共享 token；
- 首次召回应读取安全、窄范围结果，不自动把整个 Vault 暴露给 Agent。

## 20. 测试策略

### 20.1 测试分层

#### Domain 单元测试

- Task/Proposal/Operation 状态转换；
- MemoryPolicy 路由；
- idempotency payload hash；
- capability 判断；
- path allowlist；
- error code 和 next action。

#### Application 用例测试

使用 in-memory/fake ports 验证：

- start/finish 的稳定结果；
- approved writeback 顺序；
- review-gated 不变量；
- project auto-write fallback；
- source request 流程；
- operation resume。

#### Adapter 契约测试

同一套测试分别运行于：

- `ObsidianVaultAdapter` fake harness；
- `NodeFsVaultAdapter` 临时目录。

验证读取、create、expected-version replace、rename event、路径错误和原子语义。

#### KnowledgeIndex 测试

- full scan 与 index snapshot parity；
- create/modify/delete/rename；
- 重复和乱序 event；
- rebuild 期间读取；
- schema/cache invalidation；
- 大 fixture 下不发生每请求全量读取。

#### 故障注入测试

对每个 operation step 注入异常：

- journal prepare 后；
- target commit 后；
- proposal commit 后；
- task commit 后；
- audit commit 前后。

每次重新创建 Kernel 并执行 recovery，验证：

- 不重复写；
- 状态可解释；
- 用户编辑不被覆盖；
- audit 标记 recovery；
- 相同请求返回稳定结果。

#### 并发测试

- 两个 Agent 同时追加相同项目记忆；
- 两个 proposal 同时写同一目标；
- UI approve 与 MCP apply 交错；
- 外部 Obsidian 修改发生在 read/replace 之间；
- Session 断开后客户端重试。

#### Contract 测试

- public tools 与文档矩阵一致；
- 所有 tool 都有 capability、risk、input 和 result schema；
- deprecated tool 都有 replacement；
- Skill 只引用 public tool；
- start/recall/finish next action 参数符合 Schema；
- plugin capability 列表无未知工具。

#### Plugin 测试

- ViewModel 状态；
- onboarding 状态机；
- client config merge/backup/conflict；
- review preview/apply/conflict；
- Runtime/Index recovery status；
- settings migration。

#### 端到端 smoke

保留当前 MCP HTTP smoke，并缩小到真正跨层验证：

- initialize/auth/session；
- start → recall → finish；
- proposal → user-approved fixture → apply；
- source request；
- path/sensitive rejection；
- Runtime stop/start recovery。

### 20.2 验证命令

重构期间仍以现有命令为基础：

```bash
npm run typecheck
npm run test
npm run build
npm run community:check
npm run package
npm run verify
```

迭代时优先运行变更模块的窄测试；合并前运行 `npm run verify`。所有 Vault 测试使用临时 fixture，不写入真实用户 Vault。

## 21. 渐进式迁移计划

### 21.1 总体原则

- 不做大爆炸重写；
- 每个 PR 保持可构建、可测试、可回滚；
- 先通过 characterization tests 锁定行为；
- 先解决写入正确性，再优化性能和结构；
- 公共工具名和现有 Vault frontmatter 保持兼容；
- 新架构先包裹旧实现，再逐个替换；
- 每完成一个 gap，同步正式 architecture/security/status 文档。

### 21.2 Phase 0：建立重构安全网

目标：在不改变行为的前提下，锁定高风险链路。

实施：

1. 为 `start_task`、`finish_task`、`apply_approved_writeback` 增加 characterization tests；
2. 增加可注入 Clock、ID generator 和 failure hook；
3. 增加 approved writeback 目标 block 检查测试；
4. 增加 finish retry 当前行为测试，明确目标行为差异；
5. 增加插件 workspace 最小测试运行器；
6. CI 增加 clean generated artifact 检查，而不只执行 `git diff --check`。

完成标准：

- 当前行为被测试记录；
- 高风险写入可精确注入失败；
- 未改变工具 Schema 和 Vault 内容格式。

### 21.3 Phase 1：先重构 Approved Writeback

目标：用最小纵向切片建立 Application Kernel 和 Coordinator。

实施：

1. 定义 `ApplyApprovedWriteback` command/result；
2. 定义 `VaultRepository`、`OperationJournal`、`AuditSink` Port；
3. 用现有 Node FS 包装实现 adapter；
4. 添加 operation ID、payload hash、target block 检查；
5. 实现 journal 和 roll-forward recovery；
6. 让现有 MCP handler 委托新 use case；
7. 保持旧 MCP input/output 兼容；
8. 插件 review UI 暂时仍可经 MCP 调用，但业务已经只有一份。

完成标准：

- 任意步骤中断并重试不会重复写回；
- proposal、task、audit 可以恢复到一致状态；
- 外部编辑冲突不会被覆盖；
- 原有 smoke 继续通过。

### 21.4 Phase 2：任务生命周期幂等化

目标：统一 `start_task` 和 `finish_task` 操作身份。

实施：

1. 为 command 增加可选 idempotency key；
2. Runtime 为旧客户端生成 operation key，并在 Session 内缓存稳定映射；
3. session/task/proposal 路径由 operation ID 派生；
4. 实现 task `active/closing/completed`；
5. finish child writes 使用 child operation；
6. 相同 key 返回原结果，不同 payload 返回 conflict；
7. 保持现有 task/proposal frontmatter 可读。

完成标准：

- start/finish 响应丢失后可安全重试；
- 不产生重复 session note；
- 已完成 task 不被隐式重写；
- memory closeout status 保持语义一致。

### 21.5 Phase 3：消除一次调用内重复扫描

目标：先建立 snapshot seam，再实现完整增量 Index。

实施：

1. 将 `buildContextPack` 改为接收 notes/snapshot；
2. `start_task` 只扫描一次并传递 snapshot；
3. `buildArchitectureStatus`、bridge resolution 等函数接收 snapshot；
4. 为 scan count 增加测试 instrumentation；
5. 保持 `scanVault` 作为 Node compatibility adapter。

完成标准：

- `start_task` 单次请求只有一次 snapshot 获取；
- 子函数不再隐式全量扫描；
- recall/context pack 结果与旧实现一致。

### 21.6 Phase 4：实现增量 KnowledgeIndex

目标：让生产 Obsidian Runtime 不再按请求全量读取。

实施：

1. 实现内存 Index 和 snapshot generation；
2. 接入 Obsidian create/modify/delete/rename；
3. Runtime 启动时异步初始化；
4. 查询迁移到 Index；
5. 建立 shadow comparison：同一 fixture 比较 Index 与 full scan；
6. 增加 rebuild command 和 Runtime Status；
7. 评估后再决定是否持久化缓存。

完成标准：

- ready 状态下公共读工具不进行同步全库扫描；
- event parity 和 rebuild 测试通过；
- Index 删除不会造成知识丢失；
- 初始化/重建状态对 Agent 和用户可见。

### 21.7 Phase 5：建立 Contracts 与 MCP Runtime 包

目标：修复 app-to-app 源码依赖和契约重复。

实施：

1. 新建 `packages/contracts`；
2. 将 tool names、visibility、capability、risk、Schema 和 deprecation 汇总；
3. 由 registry 生成 tools/list 和类型；
4. 新建或抽取 `packages/mcp-runtime`；
5. standalone server 和 plugin 均通过 package exports 依赖；
6. 删除对其他 workspace `src/` 和 `dist/` 的相对导入；
7. 增加 contract conformance tests。

完成标准：

- app 不再导入另一个 app 的源码；
- package.json 声明完整依赖；
- 工具风险和 public/deprecated 信息只有一个结构化来源；
- clean checkout 可以按固定顺序构建和类型检查。

### 21.8 Phase 6：插件 Feature 化并移除 self-HTTP

目标：让 Obsidian 成为 Application Kernel 的直接人类适配器。

实施：

1. 创建 composition root；
2. 抽取 ObsidianVaultAdapter；
3. 先拆 Review feature；
4. preview/apply 直接调用 Kernel；
5. 再拆 Recall、Runtime Status、Client Config 和 Onboarding；
6. 删除 UI MCP Session 和 `callLocalMcpTool`；
7. 为 ViewModel 添加自动测试；
8. 保持 UI 外观与交互基本不变。

完成标准：

- 插件内部不通过 loopback HTTP 调用自己；
- `main.ts` 成为 composition/registration 入口；
- Review、Recall、Onboarding 具备独立 ViewModel 测试；
- 外部 Agent MCP 行为不变。

### 21.9 Phase 7：每客户端身份和 Runtime 加固

目标：为多 Agent 本地接入提供真实的撤销和能力边界。

实施：

1. token 记录迁移为 credential principal；
2. 支持 per-client token、capability 和撤销；
3. 区分 principal 与 client claims；
4. 增加 Session TTL、上限、请求体限制；
5. 审计增加 principal/credential 字段；
6. onboarding 使用新 credential；
7. legacy token 提供明确迁移流程。

完成标准：

- 撤销单个客户端不影响其他客户端；
- read-only credential 无法调用写工具；
- client 自报 agentId 不能改变权限；
- Session 和请求资源受限。

### 21.10 Phase 8：Skill 与 Onboarding 完成生态闭环

目标：解决 Agent 主动调用不足，并让普通用户可完成安装和验证。

实施：

1. 从 Workflow Contract 打包 Tracekeeper Skill；
2. 提供 Codex、Claude 等薄适配安装说明；
3. 实现 resumable onboarding；
4. 验证配置、Skill、重启、连接和首次 recall；
5. 增加契约一致性 CI；
6. 更新正式产品、架构、安全、工程和状态文档。

完成标准：

- meaningful task 下 Agent 能主动 start/recall/finish；
- 简单任务不会制造 task noise；
- Skill 不包含 token 或权限实现；
- 插件能区分“配置已写”“Skill 已安装”“连接已验证”“首次召回已完成”。

## 22. 推荐 PR 切片

| PR | 主题 | 主要变更 | 明确不做 |
| --- | --- | --- | --- |
| 1 | Write-flow characterization | 故障注入、Clock/ID seam、关键测试 | 不改工具行为 |
| 2 | ApplyApprovedWriteback use case | Port、Kernel 最小骨架、target block 幂等 | 不拆全部 tools.ts |
| 3 | Operation journal and recovery | journal、原子替换、恢复状态 | 不做 Index |
| 4 | Task lifecycle idempotency | start/finish operation、稳定路径、task state | 不改 UI |
| 5 | Shared KnowledgeSnapshot | 消除 start/context/bridge 重扫 | 不做持久缓存 |
| 6 | Incremental KnowledgeIndex | Obsidian events、rebuild、parity tests | 不引入向量 DB |
| 7 | Contracts and package boundaries | contracts、mcp-runtime、package exports | 不修改用户工作流 |
| 8 | Review/Recall plugin slices | composition root、direct Kernel、ViewModel tests | 不改视觉系统 |
| 9 | Client principals | per-client token/capability、Runtime limits | 不增加远程账号 |
| 10 | Skill and onboarding | Skill、状态机、验证、文档同步 | 不扩大 MCP 权限 |

每个 PR 都必须包含：

- 行为边界说明；
- 触及的 Vault 路径、工具、权限或状态；
- 自动测试；
- `git diff --check`；
- 相关 workspace typecheck/test；
- 必要时的临时 Vault 手工验证；
- 不修改真实用户 Vault。

## 23. 向后兼容与数据迁移

### 23.1 MCP 兼容

- 保持当前 12 个 public tool 名称；
- compatibility 工具继续映射到新 use case；
- 新增 idempotency key 初期为可选；
- result 只增加字段，不删除现有字段；
- 错误新增 code，同时保留可读 message；
- deprecated removal 需要跨 release 通知。

### 23.2 Vault 兼容

- 继续读取现有 task/session/proposal/memory frontmatter；
- 新字段采用 additive migration；
- 现有 `content_signature` 继续有效；
- 已存在 `^writeback-<proposal_id>` 可被新 coordinator 识别；
- operation journal 目录是新增 control 数据，不改变知识目录；
- 旧 proposal 没有 payload hash 时在首次应用前计算并记录；
- 结构迁移仍由插件人类确认，不进入 MCP 自动操作。

### 23.3 Token 迁移

- 现有 token 映射为一个 legacy full-access principal；
- 插件提示用户为每个客户端生成独立 credential；
- 验证新客户端连接后再撤销 legacy token；
- 不静默删除已写入客户端配置的旧 token；
- 所有备份和预览继续生效。

## 24. 发布与观测策略

### 24.1 Shadow 验证

在切换关键读取前，可在开发/测试模式同时执行：

- old full scan result；
- new KnowledgeIndex result；
- 只记录摘要差异，不记录完整敏感内容。

一致后再让生产请求只走 Index。

### 24.2 关键诊断指标

本地 Runtime Status 可显示：

- index state、generation、note count、last event、last rebuild；
- active/recoverable/conflict operation count；
- active Session count；
- credential principal 数量和最后使用；
- 最近一次 recall 的 snapshot generation 与耗时；
- 最近恢复操作结果。

这些是本地诊断，不需要遥测上传。

### 24.3 发布门槛

涉及以下变更时必须更新正式文档：

- 新增 operation journal 路径；
- Index 生命周期和缓存位置；
- token/principal/capability；
- proposal/task 状态；
- MCP tool Schema 或结果；
- onboarding/Skill 安装行为。

## 25. 验收标准

### 25.1 正确性

- approved writeback 在每个步骤崩溃并恢复后只出现一个目标 block；
- finish_task 重试不生成重复 session/proposal/memory block；
- 同 idempotency key 不同 payload 被拒绝；
- 用户外部修改不会被静默覆盖；
- operation、proposal、task、audit 最终状态可相互追踪。

### 25.2 性能与体验

- Index ready 后 recall/start/lint/graph/status 不执行同步全库扫描；
- `start_task` 不重复获取 snapshot；
- Index 初始化和 rebuild 状态可见；
- Obsidian 在大 fixture 初始化时仍可交互；
- 插件 UI 不再通过 HTTP 调用自身。

### 25.3 架构

- app 不导入其他 app 的内部源码；
- workspace 不导入其他 workspace 的相对 `dist`；
- MCP handler 不直接访问 `fs`；
- View 不实现路径、审核和记忆策略；
- Application Kernel 可通过 fake ports 单测；
- tool contract 有单一结构化语义源。

### 25.4 安全

- principal 来源于 credential，而不是 initialize 自报字段；
- read-only credential 无法执行写操作；
- MCP 仍保持 loopback、token、CORS、Vault 路径和敏感信息边界；
- Skill 不扩大权限；
- Session、请求体和并发资源有上限。

### 25.5 产品一致性

- Vault 仍是可读、可编辑、可备份的事实源；
- 无外部数据库或托管后台；
- 全局 durable memory 仍默认审核；
- 项目 auto-write 仍是用户控制、追加式和 Wiki bridge 限定；
- Agent 主动性由 Skill/next actions 提升，而不是放宽 MCP。

## 26. 主要风险与缓解

| 风险 | 影响 | 缓解方式 |
| --- | --- | --- |
| 重构过程中工具结果漂移 | Agent/Skill 失效 | characterization + contract tests + additive result |
| Obsidian API 与 Node adapter 行为不同 | 生产和 smoke 不一致 | adapter contract suite |
| Journal 自身损坏 | 无法自动恢复 | 单 operation 文件、原子写、校验、用户可见 conflict |
| Index event 丢失 | 召回过期 | generation、parity check、rebuild escape hatch |
| 外部编辑与自动写入竞争 | 用户内容被覆盖 | expected version、path lock、conflict，不自动回滚 |
| per-client token 增加配置复杂度 | onboarding 变难 | 插件生成/写入/验证，legacy 迁移 |
| 过度拆包增加维护成本 | 构建复杂 | 先逻辑模块，只有跨 app 稳定边界才建 package |
| UI 拆分引发视觉变化 | 用户体验回归 | 先拆 ViewModel/Controller，保持 DOM/CSS |
| Skill 过于积极产生噪音 | Vault task 污染 | meaningful triggers、noise exclusions、一次 start/finish |

## 27. 明确设计决策与待确认事项

### 27.1 本文已做出的设计决策

1. 采用渐进式 Application Kernel，而非重写；
2. KnowledgeIndex 是派生缓存，Vault 是事实源；
3. 第一阶段 Index 只在内存中运行；
4. 多文件一致性采用 operation journal + roll-forward，不做伪事务回滚；
5. journal 建议放在 `00_tracekeeper/control/operations/`；
6. 插件生产写入使用 Obsidian API adapter；
7. standalone MCP 只保留 Node FS adapter；
8. 插件 UI 直接调用 Kernel，不通过 self-HTTP；
9. Skill、Workflow Contract、MCP Tool Contract 分工明确；
10. per-client principal 是多 Agent 接入前的目标权限模型；
11. 不引入外部数据库和 SaaS 基础设施；
12. UI 框架更换不纳入本轮重构。

### 27.2 实施前仍需在正式 ADR 中确认

1. operation journal 使用 JSON 单文件还是 Markdown/frontmatter；
2. 是否需要第二阶段持久化 Index cache，以及缓存具体位置；
3. Obsidian desktop plugin 可用的最稳妥 token hash 与一次性显示实现；
4. legacy shared token 的弃用周期；
5. proposal `applying/recovery_required` 状态是否直接写入现有 frontmatter；
6. Runtime 初始化期间 query 的降级策略：等待、旧 snapshot 或明确失败；
7. mobile Obsidian 是否仅关闭 MCP Runtime，还是同时复用本地治理 UI。

这些问题不应阻塞 Phase 0；在对应实现 Phase 前确定即可。

## 28. 第一实施切片建议

第一批代码变更不应先拆 8,590 行 `main.ts`，而应选择最能建立架构支点的 Approved Writeback：

### 建议新增

```text
packages/core/src/application/apply-approved-writeback.ts
packages/core/src/domain/write-operation.ts
packages/core/src/ports/vault-repository.ts
packages/core/src/ports/operation-journal.ts
packages/core/src/ports/audit-sink.ts
packages/core/src/adapters/node-fs/node-vault-repository.ts
packages/core/src/adapters/node-fs/file-operation-journal.ts
packages/core/scripts/apply-writeback-recovery.test.mjs
```

### 建议修改

```text
apps/mcp-server/src/tools.ts
apps/mcp-server/scripts/smoke.mjs
packages/core/src/index.ts
packages/core/package.json
docs/architecture/INDEX.md
docs/security/INDEX.md
docs/status/INDEX.md
```

### 第一切片验收

1. MCP 外部 Schema 不变；
2. approved proposal 正常应用；
3. 目标已有相同 block 时返回原结果；
4. 目标已有不同内容的同名 block 时 conflict；
5. 在 target/proposal/task/audit 各步骤注入失败后可恢复；
6. 不覆盖用户在恢复前产生的编辑；
7. `npm run typecheck`、相关测试和完整 `npm test` 通过；
8. 正式文档明确 operation journal 是目标 Vault 中的受控运行状态。

完成这一切片后，再将同一 coordinator 扩展到 `finish_task` 和项目自动记忆。这样重构不会停留在目录调整，而是先解决最关键的数据正确性问题。

## 29. 最终目标状态

重构完成后的 Tracekeeper 应具备以下特征：

- 用户仍然只需要理解 Obsidian、自己的 Vault、Review Queue 和连接的 Agent；
- Agent 通过 Skill 主动遵循 start → recall → work → finish；
- MCP 只暴露受控能力，并按真实 credential principal 授权；
- 插件和 MCP 使用同一个 Application Kernel；
- recall 使用可重建增量 Index，不形成第二知识库；
- 所有多步骤写入可幂等、可恢复、可归因；
- 业务规则、协议、存储和 UI 可以独立测试与演进；
- 公开工具和 Vault Markdown 继续兼容；
- 项目仍然是 Obsidian-native、local-first 的个人知识与 AI 记忆系统，而不是 SaaS 服务。
