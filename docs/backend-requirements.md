# Relay 后端需求与领域模型

> 状态：MVP 实施基线  
> 版本：1.2（2026-07-13）
> 依据：`docs/cosmos-evidence-matrix.md`（2026-07-12）  
> API 契约：`docs/api-contract.yaml`  
> 目标：为 Relay 的 Home、Sessions、Experts、Environments、Files、Artifacts、Workers 与 Automations 原型提供可演进、可审计的多租户后端边界。

## 1. 设计原则

1. 主链固定为 `Organization -> Space -> ExpertRevision + EnvironmentRevision -> Session -> Turn -> Attempt -> ToolCall`。
2. `Worker` 是 Session 内由 Agent 委派的子执行单元，不创建第二套 Session 语义。
3. `Automation` 是 Expert Trigger 的管理投影，不保存一份可独立漂移的重复规则。
4. `Event -> Automation -> Session` 创建新会话；`Subscription -> Event -> existing Session` 把后续事件送回已有会话。
5. `File` 是 User、Organization 或 Session Workspace 范围内的持久文件；每次写入产生不可变版本，公共 API 默认只读。
6. `Artifact` 是可搜索、可分享的外部或内部交付引用，不等同于 File，也不等同于代码变更。
7. Session 是持续对话；Attempt 是某个 Turn 的一次执行尝试。重试增加 Attempt，不复制 Session。
8. Session 启动时固定 Expert Revision、Environment Revision、模型和权限快照，后续配置变更不得静默改变已运行会话。
9. Archive 是可逆的展示状态，不是删除；默认不提供普通用户永久删除 Session/File 的接口。
10. 所有跨租户查询必须在数据库层带 `organization_id`，Space 资源还必须带 `space_id`；不得只依赖应用层过滤。

### 1.1 当前代码事实

| 范围 | 当前实现 | 未实现/不得声称 |
| --- | --- | --- |
| 进程与配置 | Fastify API；`/api/health` 公开存活检查；受鉴权的 `/api/ready` 检查 PostgreSQL/migration 且不依赖 Worker；独立 Worker 以 PostgreSQL 新鲜心跳控制动态 execution capability，并由实例级数据库健康命令探测；生产模式强制 OIDC、`DATABASE_URL` 和 `CORS_ORIGIN` | 无信任代理、安全 header、优雅排空验收和多区部署；SSE 连接仅有单实例预算，尚无全局分布式配额 |
| 身份发现与授权 | `GET /api/v1/me` 返回 authenticated actor 及其真实 Organization/Space membership；Session repository 重检 membership；Private Session 支持动态 User/Group ShareGrant；ServiceAccount 的 create/send/archive 使用 audience + exact Expert/Session binding；API/Worker 使用分离的 NOLOGIN/NOBYPASSRLS 角色和 FORCE RLS，API 查询设置 transaction-local actor/org/space context | 无合规访问、实时撤权通知或公开 ServiceAccount binding 管理 API |
| Session 与 File API | tenant-scoped Session 全生命周期、ShareGrant、Artifact 管理，以及 File list/get/content/versions；Session/Artifact/File list 使用 filter-bound keyset cursor；File 公共表面只读且危险 MIME 强制附件；共享 Zod 请求/响应/错误验证；Private/Workspace 资源按 creator/grant conceal | Pin 尚未拆为 actor 偏好资源；无 Tool/Approval API 或公开 File 写 API |
| Catalog API | tenant-scoped Expert/Environment list/get；单条 SQL 与 FORCE RLS 重检 Organization/Space membership；Private Expert、未发布 Expert 和未就绪 Environment 按角色隐藏；keyset cursor、资源 version 与 detail ETag 已实现 | 无 create/update/publish/reprovision；service account 暂时拒绝；无 Catalog operation policy 或 Audit |
| 权威配置与持久化 | PostgreSQL migration 已建立 Expert/Environment identity、immutable revision、Repository binding、ShareGrant、Artifact、三作用域 File/FileVersion、ServiceAccount binding、复合 tenant FK 与 27 张租户表的 FORCE RLS；Session/Artifact/FileVersion 写事务维护 Outbox/Event/Audit；FileVersion 与账本不可变 | File 内容仍为有界 `bytea`；无 Expert/Environment CRUD/publish API、ExecutionSnapshot 或完整失败/拒绝 Audit；大表 migration 的生产规模锁等待仍需演练 |
| 基础执行 | 独立 Worker 以数据库权威租约 claim protocol-1 Command；heartbeat/fencing、有限重试、过期恢复、撤权取消与 immutable Attempt history 已有 PostgreSQL 并发测试；Worker 内部 File append repository 执行 scope/RBAC/配额重检并写脱敏 ledger | 无 workspace/coding sandbox、ToolCall/Approval 编排、外部副作用幂等、dead-letter 与负载/soak 证据 |
| 写入幂等 | Organization + authenticated actor + method + canonical path + key 作用域；create/start/send/archive/restore/pause/resume/cancel/retry/share 写在授权后重放，同 key/同 body 返回原结果，不同 body 返回 409；PostgreSQL advisory lock、Session 行锁与强 `If-Match` CAS 处理并发 | 未运行过期记录清理作业；尚未统一所有写 endpoint 的幂等中间件 |
| 测试 | API/repository/config/JWT 单元测试；配置 `TEST_DATABASE_URL` 时运行 PostgreSQL 并发幂等、权威配置、Catalog/Session/File 分页与可见性、File 不可变/配额/脱敏、metadata/执行控制/ShareGrant/ServiceAccount、受限角色/FORCE RLS/上下文防泄漏、跨 tenant/Private 隔离、Session FIFO、Worker 就绪边界和 `001 -> 051` 新库/升级测试；Session activity indexes 使用独立 concurrent migrations | 数据库测试会在无环境变量时 skip；无生产规模在线 schema、备份恢复或负载测试 |

这是“PostgreSQL 权威数据与基础对话执行纵向切片”，不是本文 Phase 1 已完成，也不具备处理客户私密数据的完整生产安全边界。

### 1.2 契约权威与已知漂移

`docs/api-contract.yaml` 是目标 API 设计，`packages/contracts` 是当前运行时实现契约。在两者由同一源生成之前，不得将 OpenAPI 中未实现的 operation 标记为可用。

| 漂移 | 当前实现 | 目标决策 |
| --- | --- | --- |
| Base path | 代码为 `/api/v1`，OpenAPI server 为 `/v1` | 生产边缘对外使用 `/v1`；同源 Web 可经 `/api/v1` 代理。在合同测试中明确两者的 rewrite，不保留两套业务路由 |
| Create body | `expertId/title/message` 是最小输入；`visibility/start` 有默认值；`advancedOverrides.repositoryId/baseBranch` 严格校验。旧名称/版本/环境/仓库字段仅是迁移提示，不作为事实持久化 | 移除迁移提示前先完成所有 Web/Automation caller 升级；附件仍需迁移为预上传引用 |
| Create/start/send transaction | `start=true` create 同事务解析并锁定 Published ExpertRevision、Ready EnvironmentRevision 与 Repository binding，再写 Session + first Message + Turn + Command + Outbox + 完整幂等响应；draft start 以 `If-Match` 锁定版本并复用 first Message；send 在 Session 行锁内分配 Message sequence/Turn ordinal 并原子追加 Command/Outbox/SessionEvent/AuditEvent；protocol-1 consumer、lease/heartbeat/fencing 与单 Session FIFO 已实现 | 无 ExecutionSnapshot、Tool runtime 或外部副作用 ledger；其余生命周期命令尚未接入统一事务 |
| Response | `SessionDto` 返回 `configurationResolutionVersion` 和三个 authoritative ID；create 返回 message/turn/command、`ETag`、`Location` 与 replay header；get 返回 `ETag` 和 no-store | 仍需与目标 `Session` resource 的完整字段、统一 problem details 和生成契约收敛 |
| Error | 运行时为 `{code,message,retryable,fieldErrors,correlationId}` | 统一到 `application/problem+json`；迁移期前端适配必须有合同测试，不允许第三套错误格式 |
| Identifier | 当前接受 1-128 字符串并生成 UUIDv4 | 持久实体改为服务端 UUIDv7；不在 URL 中使用可猜业务标识 |
| Attachment | 最多 10 个 URL/字符串 | 使用预上传后的 `AttachmentReference`；统一大小、数量、MIME 和扫描约束 |

发布前必须让 OpenAPI 成为可机器校验的单一契约源，CI 至少执行 lint/bundle、operation 实现覆盖检查、生成类型差异检查和 Web/API contract test。

## 2. 系统边界

### 2.1 同步控制面

- REST API：资源查询、配置 CRUD、会话命令、审批决策、分享与归档。
- Authorization：组织和 Space 范围 RBAC，叠加资源可见性与会话成员授权。
- Transactional store：PostgreSQL；所有状态变更和 outbox 写入使用同一事务。
- Object store：附件、File version 内容、大型 ToolCall 输出、Artifact 快照。
- Search index：Session 标题/消息摘要、Artifact 标识、File 路径和元数据；索引是投影，不是事实源。

### 2.2 异步执行面

- Command queue：Session start/send/pause/resume/cancel、Turn 执行、Environment snapshot、Automation dispatch。
- Agent runtime：模型调用、ToolCall、Worker 委派、文件同步和 Artifact 提取。
- Event router：接收外部事件、验签、幂等、匹配 Trigger、创建 Session 或投递 Subscription。
- Realtime gateway：按 Session 输出有序 SSE 事件流。
- Webhook delivery：向客户系统投递签名事件，独立重试和死信。

### 2.3 一致性边界

- 资源 CRUD 和命令接受是强一致；命令执行结果最终一致。
- API 返回 `202 Accepted` 表示命令已持久化，不表示 Agent 已执行完成。
- 同一 Session 的领域事件必须有单调递增的 `sequence`；不同 Session 之间不承诺全局顺序。
- Search、统计、侧栏 Recent/Pinned 和 Automation Run History 可最终一致，但必须返回投影更新时间。

## 3. 统一字段与标识

除不可持久化的值对象外，所有实体使用：

| 字段 | 规则 |
| --- | --- |
| `id` | 不可枚举的 UUIDv7；API 使用字符串 |
| `organizationId` | 强制租户边界，不从客户端 body 信任写入 |
| `spaceId` | Space 资源必填；User scope File 可为空 |
| `createdAt` / `updatedAt` | UTC RFC 3339，服务端生成 |
| `createdBy` / `updatedBy` | User、ServiceAccount 或 System actor ID |
| `version` | 从 1 递增，用于 ETag/乐观并发，不等同于 Expert Revision 号 |
| `metadata` | 限制 16 KiB 的 JSON object；禁止 Secret 和原始凭据 |

所有外部 ID 以 `(organization_id, provider, external_id)` 建唯一约束。所有软删除资源使用 `deleted_at`，普通列表默认排除；Session 和 File 不开放普通软删除入口。

## 4. 领域实体

### 4.1 Organization

租户、安全和账单的最高边界。

核心字段：`id`、`name`、`slug`、`status(active|suspended|deleting)`、`defaultSpaceId`、`region`、`retentionPolicyId`、`createdAt`。

约束：

- `slug` 全局唯一；一个 Organization 恰有一个 Default Space。
- Default Space 不可删除或重命名。
- `region` 创建后不可直接修改；迁移是独立运维流程。
- Organization suspend 后阻止新命令，但保留只读、导出和合规访问。

### 4.2 Space

Sessions、Experts、Environments、Secrets、MCP Servers、Webhooks、Projects 和 Automations 的资源边界。

核心字段：`id`、`organizationId`、`name`、`slug`、`description`、`isDefault`、`defaultExpertId`、`defaultEnvironmentId`、`status(active|migrating|archived)`、`settings`。

约束：

- `(organization_id, slug)` 唯一。
- 删除非 Default Space 前必须提供 `migrationTargetSpaceId`；服务端预检并原子地建立迁移作业。
- 资源迁移期间禁止在源 Space 创建新 Session。
- 当前 Space 选择属于用户偏好，不应写入 Organization 全局状态。

### 4.3 Expert 与 ExpertRevision

Expert 是稳定身份；ExpertRevision 是不可变、可执行配置。

Expert 核心字段：`id`、`spaceId`、`kind(managed_template|custom|built_in)`、`name`、`description`、`status(draft|published|disabled|archived)`、`visibility(private|space)`、`publishedRevisionId`、`draftRevisionId`、`upstreamTemplateId`。

ExpertRevision 核心字段：

- `revision`：Expert 内从 1 递增。
- `baseRevisionId`：托管模板上游 Revision；Custom Expert 可空。
- `managedInstructions`：托管基础提示词，只能由平台更新。
- `organizationInstructions`：组织追加配置。
- `model`、`capabilities`、`toolPolicy`、`environmentId`、`environmentRevisionId`。
- `launchGuidance`、`workerDefinitions`、`triggerDefinitions`、`approvalPolicy`。
- `checksum`、`publishedAt`、`publishedBy`。

约束：

- Managed Template 的 `managedInstructions` 不可通过租户 API 覆盖；自定义内容只写 `organizationInstructions`。
- Published Revision 不可修改；编辑产生新 Draft Revision，发布再切换指针。
- 新 Session 只能固定 Published Revision；内置 Advisor 也遵循同一 Revision 规则。
- 禁用 Expert 不终止既有 Session，但禁止创建新 Session。

### 4.4 Environment 与 EnvironmentRevision

Environment 是 Agent 访问仓库、文件、命令和工具的计算模板；EnvironmentRevision 是不可变配置快照。

Environment 核心字段：`id`、`spaceId`、`type(cloud|daemon)`、`name`、`slug`、`status(draft|provisioning|ready|updating|failed|disabled)`、`activeRevisionId`。

EnvironmentRevision 核心字段：`image`、`repositoryBindings`、`variableReferences`、`hooks`、`networkPolicy`、`sharing`、`daemonPoolId`、`enterpriseResourcePolicy`、`checksum`。

约束：

- 环境变量只保存 Secret reference；API 永不返回明文。
- 每个 Cloud Session 从固定 Environment Revision 创建新隔离 Snapshot。
- 默认按工作负载自动分配计算资源；CPU/Memory 上限属于 Relay Enterprise Policy，不是 Expert 的业务字段。
- Update/Refresh 创建新 Revision；运行中的 Snapshot 不原地变更。
- Environment disable 不影响已启动 Snapshot，但禁止新 Session 使用。

### 4.5 Session

与一个 Expert 的持续对话和长期事实容器。

核心字段：

- 归属：`organizationId`、`spaceId`、`createdBy`、`managerId`。
- 固定配置：`expertId`、`expertRevisionId`、`environmentId`、`environmentRevisionId`、`executionSnapshotId`。
- 展示：`title`、`summary`、`visibility(private|space)`、`pinnedAt`、`pinFolderId`。
- 执行：`status(draft|queued|active|waiting|paused|completed|failed|canceled)`、`waitingReason`、`activeTurnId`。
- 来源：`source(manual|automation|worker_import)`、`sourceEventId`、`automationId`。
- 生命周期：`startedAt`、`lastActivityAt`、`completedAt`、`archivedAt`、`retentionUntil`、`legalHold`。

约束：

- Archive 与 `status` 正交；归档中的 Session 可重新打开、继续和恢复。
- 自动化可在终态后自动归档；不得在 Turn 仍运行时立即隐藏事件。
- 标题可由首条用户消息异步生成，用户可重命名。
- Space 按 `explicit manager assignment -> Expert -> user selected Space -> Daemon` 解析并记录 `spaceResolutionSource`。
- Private Session 仅创建者、显式成员和有合规权限的管理员可见；Space Session 受 Space membership 限制。
- Session 默认长期保存。永久删除只允许合规删除作业，并受 legal hold 阻止。

### 4.6 Turn

Session 中由一个用户消息、自动化事件或 Subscription 事件触发的一轮 Agent 工作。

核心字段：`id`、`sessionId`、`ordinal`、`initiatorType(user|event|system)`、`initiatorId`、`inputMessageId`、`status(queued|running|waiting_tool|waiting_approval|completed|failed|canceled)`、`queuedAt`、`startedAt`、`completedAt`。

约束：

- `(session_id, ordinal)` 唯一且递增。
- Agent 忙时发送的消息先建立 Message，再进入该 Session 的 FIFO Turn 队列。
- 默认一个 Session 同时最多一个前台 Turn；Worker 可在限额内并行。
- Turn 完成后才把该 Turn 的 File 写入同步到 User/Organization scope。

### 4.7 Attempt

Turn 的一次可重试执行。用于模型错误、运行时故障、用户恢复和幂等重放诊断。

核心字段：`id`、`turnId`、`number`、`status(queued|starting|running|waiting|paused|succeeded|failed|canceled)`、`model`、`runtimeId`、`failureCode`、`failureDetailRedacted`、`usage`、`startedAt`、`finishedAt`。

约束：

- `(turn_id, number)` 唯一；重试只追加 Attempt。
- 已成功 Attempt 不自动重试。
- 模型请求和 ToolCall 重试必须使用子级幂等键，避免重复外部写入。

### 4.8 Worker

由父 Turn 委派的子 Agent 执行单元，形成树，但仍属于同一 Session。

核心字段：`id`、`sessionId`、`parentTurnId`、`parentWorkerId`、`expertRevisionId`、`name`、`instructions`、`status(queued|running|waiting|completed|failed|canceled)`、`depth`、`ordinal`、`resultSummary`。

约束：

- Worker 树深度、总数和并发受 Organization/Space/Expert policy 三者最严格值限制。
- Worker 继承 Session 的租户、可见性和 Environment Snapshot；不能扩大工具或 Secret 权限。
- Worker 输出先回到父 Turn；只有父 Turn 或授权 ToolCall 可发布 File/Artifact。

### 4.9 ToolCall

Agent/Worker 对模型外能力的结构化调用，也是 File 写入、配置变更和高风险动作的审计依据。

核心字段：`id`、`sessionId`、`turnId`、`attemptId`、`workerId`、`toolName`、`operation`、`riskLevel`、`status(queued|approval_required|running|succeeded|failed|canceled)`、`inputRef`、`outputRef`、`approvalId`、`idempotencyKey`、`startedAt`、`completedAt`。

约束：

- Tool input/output 大于 64 KiB 写 Object Store，仅数据库保存摘要、hash 和 reference。
- Secret 值不得进入 ToolCall payload、日志、SSE 或审计 metadata。
- 外部写操作必须带 provider 幂等标识；网络超时后先查询结果，再决定重试。
- 需要审批的调用在批准前不得进入执行队列。

### 4.10 File 与 FileVersion

跨 Session 持久文件或 Session Workspace 文件。

File 核心字段：`id`、`scope(workspace|user|organization)`、`spaceId`、`ownerUserId`、`sessionId`、`path`、`mimeType`、`size`、`latestVersionId`、`lastWrittenByToolCallId`、`lastWrittenByExpertId`、`archivedAt`。

FileVersion 核心字段：`id`、`fileId`、`version`、`contentRef`、`contentHash`、`size`、`createdByToolCallId`、`sourceSessionId`、`sourceTurnId`、`createdAt`。

约束：

- 作用域唯一键：Organization `(organization_id, path)`；User `(organization_id, owner_user_id, path)`；Workspace `(session_id, path)`。
- FileVersion 不可变；恢复旧版必须由 Session 内 Agent ToolCall 读取旧内容并写入新 Version。
- 公共前端 API 提供浏览、预览、复制内容、下载和版本查询，不提供直接上传/编辑/删除。
- Organization scope 写入需满足 Space policy，并可触发 Approval。
- 文件路径必须规范化，禁止 `..`、NUL、绝对路径逃逸和 Unicode 混淆。

### 4.11 Artifact

Session 的可发现交付物或外部引用。

核心字段：`id`、`sessionId`、`turnId`、`type(pull_request|branch|commit|issue|link|test_report|deployment|document)`、`provider`、`externalId`、`label`、`url`、`status`、`attributes`、`createdByToolCallId`、`removedAt`。

约束：

- `(organization_id, provider, external_id, type)` 在非空 external ID 时唯一。
- URL 必须经过协议和 host policy 校验；前端不得渲染未经转义的 provider 内容。
- Artifact label、external ID、branch、PR、issue 和自定义链接进入 Session 搜索索引。
- 手工新增/编辑只改变 Relay 引用，不修改外部系统对象；删除为解除关联并保留审计。

### 4.12 Automation

Expert Trigger 的只读聚合身份和可管理投影。

核心字段：`id`、`spaceId`、`expertId`、`expertRevisionId`、`triggerId`、`source`、`eventType`、`filter`、`status(draft|paused|active|error)`、`autoArchive`、`serviceAccountId`、`lastMatchedAt`、`matchCount`。

约束：

- `Automation.id` 稳定映射到一个 Expert Trigger；PATCH Automation 实际创建新 Expert Draft Revision 并在发布后切换投影。
- 新 Trigger 默认 paused；测试事件成功后显式启用。
- Filter 使用受限 JSONLogic 方言，限制深度、操作符和执行时间，不允许任意代码。
- 自动化创建 Session 时使用固定 ServiceAccount，权限不得高于 Expert 和 Space policy。

### 4.13 Event

来自 GitHub、Slack、Webhook、Schedule 等来源的不可变输入记录。

核心字段：`id`、`spaceId`、`source`、`eventType`、`externalId`、`headersRef`、`payloadRef`、`payloadHash`、`status(received|matched|ignored|dispatching|dispatched|failed)`、`automationId`、`sessionId`、`receivedAt`、`processedAt`。

约束：

- 接收时先验签和持久化，再异步匹配；响应不等待 Agent 启动。
- `(organization_id, source, external_id)` 唯一；重复事件返回原处理结果。
- 原始 headers/payload 加密存储，展示时按 provider schema 脱敏。
- 一个 Event 最多通过一个 Automation 创建一个 Session；需要 fan-out 时由显式规则组建模。

### 4.14 Subscription

Agent 在运行时创建的临时事件监听，将后续 Event 投递到已有 Session。

核心字段：`id`、`sessionId`、`createdByToolCallId`、`source`、`eventType`、`filter`、`status(active|paused|expired|canceled)`、`expiresAt`、`lastDeliveredAt`、`deliveryCount`。

约束：

- Session 进入 completed/failed/canceled 后默认关闭 Subscription；显式配置可保留至 `expiresAt`。
- Subscription 命中只创建新 Turn，不创建新 Session。
- 同一 Event 对同一 Subscription 最多投递一次；唯一键 `(subscription_id, event_id)`。

### 4.15 Approval

高风险 ToolCall 或 Relay 治理动作所需的人类决策。

核心字段：`id`、`organizationId`、`spaceId`、`sessionId`、`turnId`、`toolCallId`、`action`、`riskLevel(low|medium|high|critical)`、`reasons`、`evidenceRefs`、`status(pending|approved|changes_requested|rejected|expired|canceled)`、`requestedBy`、`assignedTo`、`expiresAt`、`decidedBy`、`decisionNote`、`decidedAt`。

约束：

- 决策是一次性 CAS 操作；仅 pending 可决定，重复同值请求幂等，冲突决定返回 `409 APPROVAL_ALREADY_DECIDED`。
- 批准只释放与 `toolCallId` 绑定的确切输入 hash；输入变化必须新建 Approval。
- critical 动作可要求双人批准；审批人不得与请求动作的 ServiceAccount 相同。
- 过期、拒绝或要求修改后不得执行原 ToolCall。

## 5. 状态机

### 5.1 Expert

```text
draft --publish--> published --disable--> disabled --enable--> published
  |                    |                    |
  +------archive-------+------archive------+--> archived
published --edit--> published + new draft revision
```

归档不可执行；恢复归档回到 draft，必须重新发布。

### 5.2 Environment

```text
draft -> provisioning -> ready -> updating -> ready
                \-> failed --retry--> provisioning
ready/failed -> disabled --enable--> provisioning
```

删除为异步作业；仍被 Published Expert 或保留期内 Session 引用时返回冲突。

### 5.3 Session 与 Turn

```text
Session: draft -> queued -> active <-> waiting
                           |  \-> paused --resume--> queued
                           +----> completed | failed | canceled

Turn: queued -> running -> waiting_tool/waiting_approval -> running
                   \-----> completed | failed | canceled
```

- `send`：任何非 canceled Session 可接收；终态 Session 接收新消息时切回 queued，并创建新 Turn。
- `pause`：只对 queued/active/waiting 生效；正在进行的安全点完成后进入 paused。
- `cancel`：终止当前和排队 Turn，关闭默认 Subscription；不可自动恢复。
- `archive`：不改变执行状态；若产品要求隐藏活跃归档，UI 必须明确仍在运行。

### 5.4 Attempt、Worker、ToolCall

```text
Attempt: queued -> starting -> running <-> waiting/paused -> succeeded|failed|canceled
Worker:  queued -> running <-> waiting -> completed|failed|canceled
Tool:    queued -> approval_required -> running -> succeeded|failed|canceled
                    | rejected/expired        
                    +-----------------> canceled
```

### 5.5 Automation、Event、Subscription、Approval

```text
Automation: draft -> paused -> active <-> paused -> error -> paused
Event: received -> matched|ignored -> dispatching -> dispatched|failed
Subscription: active <-> paused -> expired|canceled
Approval: pending -> approved|changes_requested|rejected|expired|canceled
```

所有非法转换返回 `409 INVALID_STATE_TRANSITION`，响应包含当前状态和允许动作。

## 6. RBAC 与授权

### 6.1 角色

| 角色 | 组织管理 | Space 配置 | Expert/Environment | Session | Approval | 审计 |
| --- | --- | --- | --- | --- | --- | --- |
| `organization_owner` | 全部 | 全部 | 全部 | 全部可见（合规访问需记录理由） | 全部 | 导出 |
| `organization_admin` | 成员/策略 | 全部 | 全部 | Space 可见 | 按策略 | 查看 |
| `space_manager` | 无 | 所管理 Space | CRUD/发布 | Space 可见、分享/归档 | 按策略 | Space 查看 |
| `member` | 无 | 无 | 读取、可创建 Custom Draft | 自己及被分享 | 被指派 | 自己相关 |
| `viewer` | 无 | 无 | 读取 Published | 被分享只读 | 无 | 无 |
| `service_account` | 无 | 无 | 读取固定 Revision | 仅授权自动化/Session | 不能人工决定 | 自身活动 |

### 6.2 授权计算

最终权限是 `organization membership ∩ space membership ∩ role permission ∩ resource visibility ∩ policy`。

- Private Session 不因 Organization admin 身份自动出现在普通列表；合规访问使用单独 permission、理由和 AuditEvent。
- Share grant 支持 User/Group、`viewer|collaborator`、可选失效时间；不得通过可猜 URL 绕过鉴权。
- ServiceAccount token 必须匹配 Organization、Space membership、credential audience/status 和 exact Expert/Session operation binding；不允许通配 resource。
- Approval 决策额外校验 assignment、separation-of-duties 和最新状态。

## 7. API 约定

### 7.1 版本、分页与并发

- 对外 Base path：`/v1`；同源 Web 的 `/api/v1` 只能是边缘 rewrite；破坏性变更发布新主版本。
- 列表使用 cursor 分页：`limit` 默认 25、最大 100，响应 `page.nextCursor`；排序键必须稳定并以 `id` 兜底。
- 时间使用 UTC RFC 3339；数量使用整数最小单位。
- GET 单资源返回 `ETag: "<version>"`；PATCH、DELETE 和一次性决策必须带 `If-Match`，不匹配返回 412。
- PATCH 使用 JSON Merge Patch 语义；传 `null` 表示清空允许为空字段。

### 7.2 幂等

- 所有创建资源、命令和外部副作用 POST 必须接受 `Idempotency-Key`，ASCII 1-128 字符。
- 幂等作用域：`organization + authenticated actor + HTTP method + canonical path + key`。
- 服务端保存请求 body hash、状态码、响应 body 和关键响应头至少 24 小时。
- 相同 key/body 重放返回原结果并设置 `Idempotency-Replayed: true`；相同 key/不同 body 返回 `409 IDEMPOTENCY_KEY_REUSED`。
- Event ingestion 另以 `(organization, source, externalId)` 长期去重；保留期不得短于原始 Event 保留期。
- 客户端超时后必须使用相同 key 重试，不得生成新 key。
- 当前 Session create 已实现 `organization + authenticated actor + method + canonical path + key`、request hash、完整响应和 24 小时有效期；仍需抽成所有写 endpoint 共用的幂等中间件并运行过期记录清理作业。

### 7.3 错误格式

使用 `application/problem+json`：

```json
{
  "type": "https://relay.example/problems/invalid-state-transition",
  "title": "Invalid state transition",
  "status": 409,
  "code": "INVALID_STATE_TRANSITION",
  "detail": "Session is already completed.",
  "requestId": "req_...",
  "errors": [{ "field": "status", "reason": "allowed: queued, active, waiting" }]
}
```

核心错误码：`VALIDATION_FAILED`、`AUTHENTICATION_REQUIRED`、`PERMISSION_DENIED`、`RESOURCE_NOT_FOUND`、`RESOURCE_CONFLICT`、`PRECONDITION_REQUIRED`、`VERSION_MISMATCH`、`INVALID_STATE_TRANSITION`、`IDEMPOTENCY_KEY_REUSED`、`RATE_LIMITED`、`QUOTA_EXCEEDED`、`APPROVAL_REQUIRED`、`APPROVAL_ALREADY_DECIDED`、`ENVIRONMENT_NOT_READY`、`EXPERT_NOT_PUBLISHED`、`EVENT_SIGNATURE_INVALID`、`EVENT_DUPLICATE`、`PAYLOAD_TOO_LARGE`、`INTERNAL_ERROR`、`DEPENDENCY_UNAVAILABLE`。

当前 `@relay/contracts` 的 `ApiError` 仍为迁移格式。在统一前，API 必须始终返回已声明的一种格式，Web 只在单一 adapter 中兼容，并为两种响应写契约测试；禁止 endpoint 自定义错误 JSON。

## 8. 队列、调度和恢复

### 8.1 命令和 Outbox

- API 在同一数据库事务内写领域记录、Command 和 OutboxEvent，再返回 202。
- Worker 通过 `SELECT ... FOR UPDATE SKIP LOCKED` 或具备同等语义的队列租约领取任务。
- Command 至少一次投递；handler 必须以 `commandId` 幂等。
- 租约含 heartbeat；进程失联后可重新领取，已产生的 ToolCall 外部副作用不得盲目重放。

### 8.2 公平性与背压

- 调度顺序：Organization 配额 -> Space 权重 -> Session FIFO -> Worker 并发。
- 每个 Organization、Space、Expert、Environment/Daemon Pool 都有并发和队列长度限制。
- 达到硬限制返回 429/`QUOTA_EXCEEDED`；可排队时返回 202 和 `queuePosition` 估值。
- 队列等待超过策略阈值产生可观测事件和告警，不静默丢弃。

### 8.3 重试与死信

- 仅对明确可重试错误指数退避并加入 jitter；默认最多 5 次。
- Validation、permission、approval rejection 和 policy denial 不重试。
- Event dispatch/Webhook 失败进入死信队列，保留原事件引用、错误分类和 replay 操作审计。

## 9. 实时事件

客户端通过 `GET /v1/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/events` 建立 SSE：

- `id` 为 Session 内可恢复的 `sequence`，支持 `Last-Event-ID`。
- `event` 使用稳定类型，例如 `session.updated`、`message.created`、`turn.started`、`tool_call.updated`、`approval.requested`、`file.version.created`、`artifact.created`、`worker.updated`。
- `data` 包含 `eventId`、`sequence`、`occurredAt`、`resourceType`、`resourceId`、`payload`。
- 服务端每 15 秒发送 heartbeat；无事件 60 分钟可关闭，客户端指数退避重连。
- 交付为至少一次；客户端按 `eventId` 去重并按 `sequence` 应用。
- 权限撤销、Session 移出 Space 或 token 过期时立即关闭连接。
- Event payload 不包含 Secret、完整 ToolCall 大输出或 File 内容；客户端按需拉取授权资源。

## 10. 审计与可观测性

### 10.1 AuditEvent

所有安全或业务关键动作写 append-only AuditEvent：actor、impersonation chain、organization/space、action、target、result、requestId、idempotencyKey hash、IP/UA 摘要、before/after 字段级 diff、policy decision 和 occurredAt。

必须审计：登录/令牌、成员/RBAC、Secret reference、Expert 发布、Environment 更新、Session share/archive/compliance access、ToolCall 外部写、File Organization 写入、Artifact 修改、Automation 启停、Event replay、Approval 决策、数据导出/删除。

禁止记录：Secret 明文、OAuth code/token、完整 prompt、File 内容、未脱敏外部 payload。AuditEvent 不允许业务管理员修改或删除。

### 10.2 指标与追踪

- 所有请求、Command、Turn、Attempt、ToolCall 和外部 provider 调用传播 `traceparent` 与 `requestId`。
- 核心指标：API latency/error、queue wait、Turn latency、Attempt retry、Tool success、approval wait、event match/lag、SSE reconnect、file sync、token/cost、tenant quota。
- 高基数 ID 进入 trace/log，不进入无界 metrics label。

## 11. 数据保留与删除

默认策略：

| 数据 | 默认保留 | 说明 |
| --- | --- | --- |
| Session、Message、Turn、Artifact 元数据 | 无限期 | Archive 不删除；客户策略可缩短 |
| File 与 FileVersion | 无限期 | 受配额、legal hold 和合规删除约束 |
| Workspace snapshot | 终态后 24 小时 | Artifact/File 已同步；故障调查可延长 |
| 原始 Event headers/payload | 90 天 | 脱敏摘要可随 Session 保留 |
| ToolCall 大型 input/output | 30 天 | 摘要和 hash 随 Session 保留 |
| AuditEvent | 至少 365 天 | Enterprise 可配置 7 年或外部归档 |
| Idempotency record | 至少 24 小时 | Event 去重记录随 Event 保留 |
| 已撤销下载链接 | 立即失效 | signed URL 最长 5 分钟 |

- Retention job 必须幂等、可暂停、可按 legal hold 跳过，并记录删除 tombstone。
- Organization 删除先冻结写入，导出，进入至少 30 天 grace period，再分批清除数据库、对象存储、搜索和备份索引。
- 备份中的删除按既定备份生命周期完成；恢复备份后必须重放 deletion ledger。
- 用户请求删除不得破坏共享 Organization File 的合法归属；应先匿名化 actor 或交由管理员裁决。

## 12. 安全要求

1. 身份：OIDC/OAuth 2.1，access token 的 `exp - iat` 不得超过 300 秒，refresh rotation；JWT-only 部署的登出/撤销残余 SLA 因此上限为 5 分钟，要求更短 SLA 的 IdP 必须接 introspection 或 `jti` denylist；ServiceAccount 使用可撤销、可限定 audience/scope 的凭据。
2. 传输与存储：TLS 1.2+；数据库、Object Store、queue 使用 KMS envelope encryption；可选 tenant key。
3. Secret：只存 provider reference；运行时按最小权限临时获取，注入后执行日志自动脱敏；Advisor 不得代用户完成 OAuth 或保存 Secret 明文。
4. 隔离：Cloud Session 使用独立 VM/container snapshot、非 root、只读基础镜像、受控挂载、seccomp 等等效沙箱；Daemon 必须双向认证。
5. 网络：默认拒绝出站；allowlist 做 DNS rebinding、redirect、私网/IP literal 和 metadata service 防护；Tool HTTP 客户端防 SSRF。
6. Webhook：HMAC 签名、timestamp 窗口、constant-time compare、body size 上限、provider external ID 去重。
7. 内容：附件做 MIME sniff、扩展名校验、恶意软件扫描、图像解码隔离；HTML/Markdown 输出消毒，下载使用 `Content-Disposition: attachment`。
8. Prompt/tool injection：外部文本标记不可信来源；模型不可越过服务端 ToolPolicy；所有授权在 ToolCall 执行时重新校验。
9. API：schema allowlist、请求体上限、速率限制、cursor 签名、CORS allowlist；生产禁用详细 stack trace。
10. 供应链：镜像签名/SBOM、依赖和容器扫描、锁定 Tool/MCP 版本、关键变更双人审批。

## 13. 关系型存储与索引建议

最小表：

`organizations`、`organization_memberships`、`spaces`、`space_memberships`、`experts`、`expert_revisions`、`environments`、`environment_revisions`、`sessions`、`session_members`、`messages`、`turns`、`attempts`、`workers`、`tool_calls`、`files`、`file_versions`、`artifacts`、`automations_projection`、`events`、`subscriptions`、`subscription_deliveries`、`approvals`、`commands`、`outbox_events`、`audit_events`、`idempotency_records`、`retention_jobs`。

关键索引：

- `sessions (organization_id, space_id, archived_at, last_activity_at desc, id desc)`。
- `sessions (organization_id, created_by, visibility, last_activity_at desc)`。
- `turns (session_id, ordinal)` unique；`attempts (turn_id, number)` unique。
- `session_events (session_id, sequence)` unique。
- `events (organization_id, source, external_id)` unique。
- `subscription_deliveries (subscription_id, event_id)` unique。
- `files` 按各 scope 建 partial unique index；`file_versions (file_id, version)` unique。
- `artifacts (organization_id, provider, external_id, type)` partial unique。
- `idempotency_records (organization_id, actor_id, method, path, key_hash)` unique。

所有 Space 表启用数据库 Row-Level Security 或等价 tenant guard；测试必须覆盖跨 Organization 相同 ID/path/external ID 的隔离。

## 14. API 与事件验收条件

1. 同一 `Idempotency-Key` 并发启动 Session 只产生一个 Session、一个首条 Message 和一个 Turn。
2. Session 创建后固定 Published Expert Revision 与 Ready Environment Revision；配置更新不改变其快照。
3. Agent 忙时连续发送三条消息按 Session sequence/FIFO 创建三个 Turn，SSE 重连不漏不乱。
4. Pause 在安全点停止，Resume 不重复已成功 ToolCall；Retry 只新增 Attempt。
5. 同一外部 Event 重放不会创建第二个 Session；Subscription 命中只为现有 Session 新增 Turn。
6. File 每次 Agent 写入都产生不可变 Version，并可追溯 Session、Turn、ToolCall；用户公共 API 无直接写入口。
7. Private Session 不出现在无授权成员列表中；Share/撤销后实时连接权限立即变化。
8. 两名审批人并发决定同一 Approval 时只有一个 CAS 成功，ToolCall 最多释放一次。
9. Archive/restore 不改变 Session 对话与 Artifact；普通用户无法永久删除。
10. 所有高风险动作产生脱敏 AuditEvent，Secret 不出现在 API、SSE、日志或审计内容中。

## 15. 实施分期

### Phase 1：Session 主链

Organization/Space、Expert/Environment immutable revision、Session/Message/Turn/Attempt、SSE、幂等、RBAC、基础 Audit。

### Phase 2：执行与协作

ToolCall、Worker tree、Approval、Share grants、附件、Artifacts、Files 三 scope 与版本。

### Phase 3：Automation 与治理

Event router、Expert Trigger/Automation projection、Subscription、Webhook delivery、Retention、配额、合规导出和删除。

每个阶段都必须先通过 tenant isolation、幂等、状态机和审计集成测试，再接入真实模型、仓库或外部写工具。

## 16. 生产后端发布门槛

| ID | 必须条件 | 验收方法 |
| --- | --- | --- |
| BE-GA01 | 所有领域 endpoint 默认需鉴权，actor/Organization/Space 由 token 与 membership 解析 | 401/403/404 concealment 契约测试；每个 operationId 对应 permission |
| BE-GA02 | Private/Space 可见性、Share grant、合规访问和服务账户 scope 服务端强制 | 权限矩阵 + 跨 Organization/Space 负向集成测试；未授权读写为 0 |
| BE-GA03 | Session 创建原子写 Session/Message/Turn/Command/Outbox/幂等响应 | 并发、断连、事务回滚和 worker 重放测试；重复 Session/Turn/外部副作用为 0 |
| BE-GA04 | Expert/Environment 不可变 revision 由服务端解析并固定 | 禁用/更新/并发发布情况下的集成测试；客户端伪造快照字段被拒绝 |
| BE-GA05 | 领域状态只能通过受权命令转换，每次转换产生有序事件和脱敏 AuditEvent | [Session 生命周期矩阵](./data-model-permissions-session-lifecycle.md) 全转移覆盖和非法转移测试 |
| BE-GA06 | PostgreSQL migration 可前向扩展、可恢复，备份和 deletion ledger 已启用 | 空库 + 上一版本升级、PITR/备份恢复、回滚/前滚演练记录 |
| BE-GA07 | 队列、worker lease/heartbeat、背压、限额、重试和死信处理可观测 | 负载/soak、worker 崩溃、provider 超时和 poison command 演练 |
| BE-GA08 | Secret、OAuth、Webhook、附件和工具出站满足最小权限与内容隔离 | 威胁建模、SAST/DAST/依赖与镜像扫描、渗透、SSRF/prompt injection 专项测试 |
| BE-GA09 | 可用性、延迟、持久性、RPO/RTO 有 SLO 和 error budget | [生产架构基线](./production-architecture.md) 指标在预发容量测试与故障演练中达标 |
| BE-GA10 | OpenAPI 与运行契约无未批准漂移，且仅公开已实现 operation | CI lint/bundle、generated type diff、consumer contract 和部署后 smoke test |

上述任一项未通过都是生产发布阻断项，不可用“先上线后补齐”豁免 tenant isolation、鉴权、幂等、审计或恢复能力。
