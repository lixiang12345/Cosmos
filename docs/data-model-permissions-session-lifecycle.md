# Relay 数据模型、权限与 Session 生命周期权威规格

> 状态：实施权威规格（Current/Target 双轨）
> 版本：1.0（2026-07-13）
> 适用范围：Session 聚合、租户隔离、权限、生命周期命令、实时事件、审计与保留
> 配套文档：[产品需求](./product-requirements.md)、[后端需求](./backend-requirements.md)、[生产架构](./production-architecture.md)、[目标 API 契约](./api-contract.yaml)

## 1. 目的与规范用语

本文把 Session 领域中容易产生越权、重复执行、乱序或数据丢失的规则固定为可实现、可测试的规范。实现、数据库迁移、OpenAPI 和测试如与本文冲突，必须先通过 ADR 修改本文，不能在代码中形成隐式例外。

本文中的“必须”“不得”“应”分别对应 RFC 2119 的 MUST、MUST NOT、SHOULD。状态标签含义如下：

- **Current**：截至 2026-07-13 已由代码和自动化测试证明的行为。
- **Target**：生产发布前必须实现并通过本文验收矩阵的行为；不是当前能力。
- **Blocked**：未达到 Target 前必须阻止生产发布或阻止相应操作。

`docs/api-contract.yaml` 描述目标 HTTP 表面，`packages/contracts` 描述当前运行时表面。只有标记为 implemented 且部署后合同测试通过的 operation 才能宣称可用。

## 2. Current 与 Target 边界

| 能力 | Current | Target / 发布门槛 |
| --- | --- | --- |
| Session API | 已实现 tenant-scoped list/create/get/rename/archive/restore/draft-start/send/pause/resume/cancel/retry、ShareGrant 与 Artifact 管理、Session/Artifact list cursor/filter、Message/Event cursor 分页和可恢复 SSE；强版本写返回 ETag | Pin、合规访问与后续 File/Tool 表面 |
| 创建/启动/发送事务 | `start=true` create 原子写 Session、首条 Message、首个 Turn、`session.start` Command、Outbox、3 条连续 SessionEvent、1 条脱敏 AuditEvent 和完整幂等响应；`start=false` 写 draft Session、Message、2 条 Event 与 1 条 Audit，不创建执行记录；draft start 复用首条 Message；send 在 Session 行锁内原子追加连续 Message/Turn、`session.send` Command、Outbox、3 条 Event、1 条 Audit 和幂等响应；重放不重复账本 | 其余后续命令也统一使用领域事务、SessionEvent、Command、Outbox、幂等响应和必要审计 |
| 配置固定 | 新 Session 由服务端固定 Published ExpertRevision、Ready EnvironmentRevision 和 Repository binding | 增加不可变 ExecutionSnapshot；legacy `configurationResolutionVersion=0` 在修复前只读 |
| 可见性 | `private` creator 与有效 User/Group ShareGrant 可见；`space` 对有效 Organization + Space member 可见；查询中动态重检 membership、Group membership、grant 状态与 expiry；单资源统一 conceal | 实时撤权通知与合规访问 |
| ServiceAccount | JWT audience、当前 Organization/Space membership、active credential 和无通配 exact binding 取交集；仅允许绑定 Expert 的 `session.create` 及绑定 Session 的 `session.send`/`session.archive`，并在写事务内重检；其他 Session/Catalog 请求 fail closed | 受控身份面之外的凭据/绑定管理 API、Automation delegation chain 与命令领取时重检 |
| 并发 | 所有 Session 命令和 ShareGrant 写的幂等记录按 organization + actor + method + canonical path + key 隔离；强版本写使用 `If-Match`；send 使用 Session 行锁分配连续 Message sequence/Turn ordinal；Worker 只 claim 最早的非终态 Turn；PostgreSQL 并发 CAS、重放与 FIFO 已测试 | 跨 Session 调度仍需配额与权重 |
| 数据隔离 | 25 张租户表启用 FORCE RLS；API/Worker 使用分离的 NOLOGIN/NOBYPASSRLS 角色，API 查询以 transaction-local actor/org/space context 验证当前 membership，Worker 仅对执行表有跨租户策略；复合 tenant FK 与显式 tenant SQL 仍保留 | 后续新增实体必须同时纳入 RLS 表矩阵；生产规模 rollout 与第三方安全复核 |
| 生命周期 | draft start 与 protocol-1 create 均进入 queued；send 在 active/waiting/paused 追加 FIFO，在 completed/failed 重新进入 queued；pause/cancel 以安全点 Command 异步收敛，resume/retry 追加新执行记录；archive/restore 与执行状态正交；Worker 可驱动 queued -> active -> completed/failed/canceled，租约过期可恢复 | ToolCall/Approval 等完整运行时状态机 |
| 实时与审计 | create/start/send/rename/archive/restore/pause/resume/cancel/retry/share/revoke/execution 写连续、不可 UPDATE/DELETE 的 allowlist SessionEvent；Message/Event 有分页读 API，Event 支持 `Last-Event-ID` SSE；对应成功路径写脱敏 AuditEvent；账本表不授予运行角色 UPDATE/DELETE | 所有拒绝/失败的可靠 append-only 审计 |
| 保留/删除 | 没有 Session retention job；普通 API 没有删除 Session | legal hold、幂等 retention job、deletion ledger、备份恢复后重放删除 |

当前准确名称是“权威 Session、只读 Catalog 与基础对话执行纵向切片”。上表 Target 未全部通过前不得标记生产可用或 GA。

## 3. Session 聚合与不可变边界

Session 是持续对话的聚合根。以下实体属于同一 Session 聚合：

```text
Session
├── Message (immutable accepted timeline item)
├── Turn (FIFO unit of Agent work)
│   └── Attempt (append-only execution try)
├── Command (durable requested action)
├── SessionEvent (append-only ordered fact; SSE source)
├── Worker / ToolCall / Approval
├── ShareGrant
└── Artifact / workspace File reference
```

固定配置字段 `expertRevisionId`、`environmentRevisionId`、`repositoryId` 和未来的 `executionSnapshotId` 一旦 Session 创建后不得由普通 PATCH 改写。Expert 或 Environment 更新、禁用、归档不改写历史 Session 快照。

`Session.version` 是聚合根的乐观并发版本，初值 1，每次实际改变 Session 行的成功事务恰好加 1。它不等同于 Message sequence、Turn ordinal、Attempt number、SessionEvent sequence 或 Expert revision。

### 3.1 Target Session 字段约束

| 字段 | 约束 |
| --- | --- |
| `organizationId`, `spaceId`, `id` | 聚合租户复合身份；均不可修改 |
| `createdBy` | User 或 ServiceAccount actor；不可修改 |
| `title` | trim 后 1..240 字符；异步建议标题不能覆盖用户后续重命名 |
| `visibility` | `private \| space`；权限规则见第 8 节 |
| `status` | 第 5 节唯一允许的执行状态 |
| `archivedAt` | nullable UTC 时间；与 `status` 正交 |
| `waitingReason` | `status=waiting` 时必填，其他状态必须为空 |
| `activeTurnId` | `active\|waiting` 时必填；`draft\|completed\|failed\|canceled` 时必须为空 |
| `pendingLifecycleAction` | `pause \| cancel` 或 null；接受异步安全点命令时设置，命令完成/失败时清空 |
| `pendingLifecycleCommandId` | 与 `pendingLifecycleAction` 同时为空或非空；指向唯一非终态生命周期 Command |
| `lastActivityAt` | Message、Turn、Attempt、ToolCall 或执行状态发生业务活动时更新；rename/pin/archive 不得伪造活动排序 |
| `completedAt` | 仅 `status=completed` 时非空；终态 Session 被新消息重开时清空，历史完成事实保留在 SessionEvent |
| `retentionUntil` | 保留策略计算结果；archive 不得缩短此时间 |
| `legalHold` | 为 true 时任何永久清除作业必须跳过 |

Pin 和 pin folder 是 actor 级偏好，不是 Session 共享状态。Target 必须把当前 OpenAPI `SessionPatch.pinned/pinFolderId` 拆到用户偏好资源；Pin 不增加 `Session.version`，也不改变其他用户视图。

## 4. Tenant 复合键与数据库防线

### 4.1 复合身份

所有 Space-scoped 表必须持久化 `organization_id` 和 `space_id`。所有父子引用必须包含完整 tenant key，不得只用 `session_id`、`turn_id` 或其他单 ID 建关联或授权查询。

Target 最小键约束如下；实现可保留 UUID `id` 的辅助唯一索引，但不得依赖其全局唯一性完成隔离：

| 表 | 主/唯一键 | 必需复合外键 |
| --- | --- | --- |
| `spaces` | `(organization_id, id)` | `organization_id -> organizations` |
| `sessions` | `(organization_id, space_id, id)` | `(organization_id, space_id) -> spaces` |
| `messages` | `(organization_id, space_id, session_id, id)`；`(..., session_id, sequence)` unique | `(..., session_id) -> sessions` |
| `turns` | `(organization_id, space_id, session_id, id)`；`(..., session_id, ordinal)` unique | Session FK；`(..., session_id, input_message_id) -> messages` |
| `attempts` | `(organization_id, space_id, session_id, turn_id, id)`；`(..., turn_id, number)` unique | `(..., session_id, turn_id) -> turns` |
| `commands` | `(organization_id, space_id, id)` | Session FK；resource FK 由命令类型校验 |
| `session_events` | `(organization_id, space_id, session_id, sequence)`；`event_id` tenant unique | Session FK；resource IDs 只能引用同 tenant 资源 |
| `session_share_grants` | `(organization_id, space_id, session_id, id)`；active principal grant partial unique | Session FK；principal 必须属于同 Organization |
| `audit_events` | `(organization_id, id)` | nullable Space/Session target 仍必须同 Organization |

同一 Organization/Space 下的 counter 分配必须锁定复合 Session 行，或使用具备相同串行化语义的原子 `UPDATE ... RETURNING`。禁止 `SELECT max(sequence)+1`。

任何查询、UPDATE、DELETE、JOIN、队列 claim、retention job 和后台修复必须显式携带 tenant key。代码审查中发现 `WHERE id = ?` 单独访问 Space 资源属于发布阻断缺陷。

### 4.2 RLS / 统一 tenant guard

Current 采用 API 授权 + PostgreSQL 防线两层校验，两者不能互相替代：

1. API repository 在执行领域 SQL 前使用 `set_config(..., true)` 设置 `relay.organization_id`、`relay.space_id` 和 `relay.actor_id`；operation scope、visibility、ShareGrant 与 ServiceAccount binding 仍由应用/仓储授权查询校验。
2. 未设置、空值、格式错误或 scope 不匹配时策略必须 fail closed，返回 0 行或拒绝写入；不得回退到“全部 tenant”。
3. 所有租户表启用 `ENABLE ROW LEVEL SECURITY` 和 `FORCE ROW LEVEL SECURITY`。`relay_api_runtime` 与 `relay_worker_runtime` 均为 NOLOGIN/NOINHERIT/NOBYPASSRLS 且不是表 owner；进程启动会验证 `current_user`。
4. API RLS `USING/WITH CHECK` 同时检查 Organization、Space 和当前 actor membership；Session visibility/ShareGrant 是额外应用层条件。Worker 不设置用户 context，只通过单独的最小执行表策略跨 tenant claim。
5. Membership、ShareGrant、Group membership 和 ServiceAccount binding 在每次请求/命令领取/SSE 授权时按当前事实重检；JWT 中的 role 只作身份声明，不作最终权限事实。
6. migration owner 与受控运维角色如需绕过 RLS，必须与应用凭据分离，操作有审批、时限和 AuditEvent。
7. `SECURITY DEFINER` 函数必须固定安全 `search_path`、校验 tenant 参数且不可授予应用任意执行；不得用它规避 RLS。

连接池归还前必须结束事务；transaction-local context 不得泄漏到下一个请求。集成测试必须在复用同一物理连接、交替 tenant 的条件下验证无泄漏。

## 5. Session 执行状态机与 archive 正交状态

### 5.1 合法 Session 转换

| From | 动作/事实 | To | 同事务副作用 |
| --- | --- | --- | --- |
| `draft` | `start` | `queued` | 复用已保存 Message，创建 Turn、Command、SessionEvent、Outbox；首次固定执行快照 |
| `queued` | worker 开始前台 Turn | `active` | Attempt 开始或继续；`activeTurnId` 设置 |
| `active` | 等待工具/审批/用户/外部事件 | `waiting` | `waitingReason` 设置 |
| `waiting` | 等待条件满足 | `active` | `waitingReason` 清空 |
| `queued\|active\|waiting` | pause 到达安全点 | `paused` | 未成功副作用不盲目重放；产生 `session.paused` |
| `paused` | `resume` | `queued` | 创建 resume Command；已有成功 ToolCall ledger 保留 |
| `active\|waiting` | 当前工作成功且无排队 Turn | `completed` | `activeTurnId` 清空、`completedAt` 设置 |
| `queued\|active\|waiting\|paused` | 不可恢复执行失败且无可运行 Turn | `failed` | 当前 Attempt/Turn 先进入对应终态 |
| `draft\|queued\|active\|waiting\|paused` | cancel 完成 | `canceled` | 当前和排队 Turn canceled；默认 Subscription 关闭 |
| `completed\|failed` | 新 `send` | `queued` | 新 Message/Turn/Command；`completedAt` 清空 |
| `failed` | 合法 `retryTurn` | `queued` | 原 Turn 重新 queued，并只追加新 Attempt |

补充规则：

- `canceled` 不可 resume、retry 或 send；继续工作必须创建新 Session，并显式关联来源。
- `send` 在 `active|waiting` 时只追加 FIFO Turn，Session 保持当前状态；在 `paused` 时接受并排队但保持 paused，直到显式 resume。
- pause/cancel API 返回 202 仅表示 Command 已持久接受；到达安全点前 Session 不得伪装为 paused/canceled。
- pause/cancel 接受事务必须设置 `pendingLifecycleAction` 和 `pendingLifecycleCommandId`、增加 Session version 并产生 `session.pause_requested`/`session.cancel_requested`。同类非终态 Command 存在时，不同 Idempotency-Key 返回 409 `COMMAND_ALREADY_PENDING`；相同 key 只重放。
- `cancel` 优先级高于尚未完成的 pause。调用者用 pause 后的新 ETag 请求 cancel 时，服务端在同一事务把旧 pause Command 标记 canceled，并绑定唯一 cancel Command；反向覆盖不允许。
- 当前 Turn 终止且仍有排队 Turn 时，Session 转为 queued，而不是 completed/failed。
- 所有未列出的转换返回 `409 INVALID_STATE_TRANSITION`，problem details 包含当前状态、动作和允许动作，但不泄露隐藏资源存在性。

### 5.2 Archive 正交状态

Session 展示状态定义为：

```text
archiveState = current  <=> archivedAt IS NULL
archiveState = archived <=> archivedAt IS NOT NULL
```

Archive/restore 不改变 `status`、Turn、Attempt、Message、Artifact、File、Subscription 或执行资源。任意 Session status 都可归档或恢复：

| 执行状态 | archive 后 | 是否继续执行/SSE | 是否允许授权用户 send |
| --- | --- | --- | --- |
| `draft\|queued\|active\|waiting\|paused` | status 原值 + `archivedAt` | 是；UI 必须显示真实运行状态 | 按第 5.1 节 |
| `completed\|failed` | status 原值 + `archivedAt` | 无运行工作；SSE 可继续接收治理事件 | 是，会按规则重开且仍保持 archived |
| `canceled` | status 原值 + `archivedAt` | 无执行；SSE 仍可接收治理事件 | 否 |

`archive` 对已归档 Session、`restore` 对当前 Session 是成功 no-op：返回 200、当前 ETag，不增加 version，不重复写业务事件。相同 Idempotency-Key 重放仍返回保存的原始响应。Archive 不是删除，不启动永久清除倒计时，不关闭 SSE，也不改变分享。

## 6. Message、Turn、Attempt、Command 与 Event 顺序

### 6.1 五个独立序列

| 序列 | 作用域 | 初值/分配 | 规则 |
| --- | --- | --- | --- |
| `Message.sequence` | Session | 1；Session 行锁内递增 | accepted timeline 顺序；Message 创建后不可修改/删除 |
| `Turn.ordinal` | Session | 1；与输入 Message 同事务分配 | FIFO 工作顺序；一个输入最多创建一个前台 Turn |
| `Attempt.number` | Turn | 1；Turn 行锁内递增 | retry 只追加，不覆盖历史 Attempt |
| `Command.acceptedAt + id` | 调度域 | 服务端时间 + UUIDv7 | 调度仍以 Organization quota -> Space weight -> Session FIFO 决定；时间不是领域顺序 |
| `SessionEvent.sequence` | Session | 1；Session 行锁内连续递增 | SSE 和领域事实唯一权威顺序；不同 Session 无全局顺序承诺 |

这些数字不得相互复用或比较。`Message.sequence=7` 不代表 `SessionEvent.sequence=7`。

客户端的 draft/sending/failed 状态是本地提交状态，不写入权威 Message 表。服务端只有成功提交后才返回 immutable accepted Message；请求失败时不产生半条 Message。队列和执行状态由 Turn/Command 表达，避免第二套 Message 状态机。

### 6.2 Send 事务

每次 `sendSessionMessage` 必须在一个 PostgreSQL 事务中按以下顺序完成，任一步失败全部回滚：

1. 重新鉴权并 `SELECT ... FOR UPDATE` 锁定复合 Session 行。
2. 验证 status、archive/visibility、If-Match（如该命令要求）和 Idempotency-Key。
3. 分配并插入一个 immutable user/event Message。
4. 分配并插入一个 queued Turn，复合 FK 指向同 Session 的输入 Message。
5. 插入 accepted Command；payload 只保存权威 ID、配置快照引用和内容 reference，不复制 Secret。
6. 依次写 `message.created`、`turn.queued`，以及实际发生状态变化时的 `session.updated` SessionEvent；sequence 必须连续。
7. Outbox 只引用已持久化的 Command/SessionEvent，不维护一份可漂移的领域事实。
8. 保存完整幂等响应和关键响应头后提交，再返回 202。

Agent 忙时连续三次 send 必须产生连续 Message sequence、连续 Turn ordinal 和 Session FIFO；不能因 worker 并发改变 Turn 开始顺序。

### 6.3 Attempt 与 retry

- 初次执行的 Attempt 1 由 worker 在领取 queued Turn 的事务中创建并从 queued 进入 starting；只有 `retryTurn` API 可在领取前显式创建后续 queued Attempt。其他组件不得创建 Attempt。
- Attempt 合法转换：`queued -> starting -> running <-> waiting|paused -> succeeded|failed|canceled`。
- 一个 Turn 同时最多一个非终态 Attempt。`(tenant, turn_id, number)` 唯一。
- `retryTurn` 仅允许 failed Turn；在同一事务追加 `number+1` Attempt、把 Turn 和必要的 Session 转回 queued、创建 Command/Event/Outbox。completed 或 canceled Turn 不可 retry。
- 已 succeeded ToolCall 由 side-effect ledger 标记；retry/resume 不得再次执行。provider 结果未知时先查证，不得盲目重放。

### 6.4 Command 与 SessionEvent

Command 状态为 `accepted -> queued -> running -> succeeded|failed|canceled`。至少一次投递要求 handler 以 `commandId` 幂等；lease 丢失不代表命令失败。

SessionEvent 是 append-only 领域事实，最少包含 `eventId`、tenant composite key、`sessionId`、`sequence`、`type`、`resourceType`、`resourceId`、redacted payload、`actorId`、`commandId`、`requestId`、`occurredAt`。更新或删除已提交事件必须由数据库权限阻止。

同一个数据库事务可以产生多个事件，但必须连续分配 sequence。Outbox relay 重试不得新增 SessionEvent；它重复发布同一个 `eventId`。

## 7. ETag、If-Match 与幂等

### 7.1 乐观并发

- GET Session 返回 `ETag: "<version>"`、`Cache-Control: private, no-store` 和 `Vary: Authorization`。
- rename、archive、restore、pause、resume、cancel、start 和 retry 必须带强 `If-Match`；格式只接受引号包裹的正整数。`*` 不接受。
- create、send 和新建 ShareGrant 是追加操作，不要求 Session If-Match；它们必须使用 Idempotency-Key，并在复合 Session 行锁内重新鉴权和排序，避免多协作者正常追加互相产生虚假 412。
- 缺少 If-Match 返回 `428 PRECONDITION_REQUIRED`；格式错误返回 400；与当前 version 不同返回 `412 PRECONDITION_FAILED`，不得产生领域写入、Command、Event、Outbox 或 Audit success。
- 实际状态改变后 version 恰好加 1，并在响应返回新 ETag。相同值 rename、重复 archive/restore no-op 不加 version。
- 授权检查必须先于返回 412，避免用 ETag 探测隐藏 Private Session。

当前 OpenAPI 尚未为所有成功 mutation 响应声明 ETag/Idempotency-Replayed，也未声明 428；实现这些 Target operation 前必须同步修订契约和合同测试。

Current `SessionCreate` 对 `start=true|false` 都要求 message：queued Session 原子创建 Message/Turn/Command/Outbox；draft Session 只持久化 Session 与首条 Message。后续 `/start` 必须复用该 Message 创建首个 Turn，禁止复制正文或重复 sequence。若未来改为“空 draft + `/start` 提供 message”，必须通过新契约版本和迁移显式演进，不能恢复为静默丢弃输入。

### 7.2 Idempotency-Key

所有资源创建、命令 POST、ShareGrant 变更和外部副作用必须要求 1..128 可见 ASCII 字符的 `Idempotency-Key`。

幂等身份是：

```text
(organization_id, authenticated_actor_id, HTTP method, canonical path, SHA-256(key))
```

记录保存 canonical request hash、状态码、response body、Location/ETag 等关键 headers 和有效期至少 24 小时。规则如下：

- 相同 key + 相同 canonical request：重放原响应并返回 `Idempotency-Replayed: true`。
- 相同 key + 不同 request：409 `IDEMPOTENCY_KEY_REUSED`。
- 并发相同请求：只有一个事务执行，其他调用等待并重放完整结果。
- authorization、membership、ShareGrant 和 ServiceAccount scope 必须在读取保存响应前重新检查；撤权后不得借幂等缓存读取原响应。
- 5xx 且事务回滚的请求不得保存成功占位；已提交但响应丢失的请求必须可重放。
- canonical path 使用对外 `/v1` 语义；边缘 `/api/v1` rewrite 不形成第二个幂等域。

## 8. 权限、Private concealment 与 ShareGrant

最终授权为：

```text
authenticated identity
∩ current Organization membership
∩ current Space membership
∩ role operation permission
∩ Session visibility / active ShareGrant
∩ Organization + Space + Expert policy
∩ ServiceAccount binding (when applicable)
```

### 8.1 rename/archive/restore 权限矩阵

“允许”仍要求有效 Organization + Space membership、匹配 tenant 和 If-Match。Private 行的额外条件见表中说明。

| Actor / 资源关系 | rename | archive | restore | 读取内容 |
| --- | --- | --- | --- | --- |
| Session creator (`member+`) | 允许 | 允许 | 允许 | 允许 |
| active ShareGrant `collaborator` | 允许 | 不允许 | 不允许 | 允许并可 send |
| active ShareGrant `viewer` | 不允许 | 不允许 | 不允许 | 只读 |
| Space manager，`visibility=space` | 允许 | 允许 | 允许 | 允许 |
| Space manager，Private 且无 grant | conceal 404 | conceal 404 | conceal 404 | conceal 404 |
| Organization admin/owner，`visibility=space` | 按 Space membership 允许 | 按 Space membership 允许 | 按 Space membership 允许 | 允许 |
| Organization admin/owner，Private 且无 grant | conceal 404 | conceal 404 | conceal 404 | 普通访问 conceal 404 |
| Approver，仅因关联 Approval | 不允许 | 不允许 | 不允许 | 仅最小决策证据，不自动获得 Session 正文 |
| Compliance actor + 独立 permission + reason | 不允许普通 mutation | 不允许普通 mutation | 不允许普通 mutation | break-glass 只读并强制审计 |
| ServiceAccount | 默认拒绝 | 仅 exact Session binding 的 `session.archive` scope | 默认拒绝 | 默认拒绝；不提供 list/get/SSE |

Session title 是共享元数据，因此 collaborator rename 会影响所有授权用户并产生 AuditEvent。Pin 是个人偏好，不使用本矩阵。

### 8.2 Private concealment

- 未授权 Private Session 不出现在列表、搜索、Recent、Artifact 反向查询、Event stream、计数或导出中。
- 对具体 ID 的 GET/mutation/SSE/share 请求统一返回 404；不得以 403、ETag、耗时或不同错误正文暴露存在性。
- Organization admin/owner 身份本身不自动授予 Private 正文访问。合规访问必须使用独立 permission、理由、短期授权和 AuditEvent。
- 从 `space` 改为 `private` 或反向切换不属于当前 SessionPatch；在单独的分享/可见性政策和撤权语义落地前禁止实现。

### 8.3 ShareGrant

ShareGrant 只支持同 Organization 的 User/Group principal、`viewer|collaborator` 和可选 `expiresAt`：

- principal 在创建时必须存在，且对 Space 的基础访问满足政策；grant 不得跨 Organization/Space 建立。
- active 定义为未撤销且 `expiresAt IS NULL OR expiresAt > transaction_timestamp()`。
- 同一 Session/principal 同时最多一个 active grant。改变 role 使用 If-Match/CAS 或 revoke + create，必须审计。
- Group membership 每次请求按当前事实解析。撤销、过期或移出 Group 后，新请求立即失权；已建立 SSE 最迟在下一次授权检查时关闭。
- grant 只授予 Session 协作表面，不扩大 Expert、Environment、Secret、Tool、File Organization scope 或 Approval 权限。
- Share URL 只携带不可枚举 Session ID，不是 bearer credential；所有请求仍需认证。

Current ShareGrant 单资源具有 version/ETag；revoke 要求 If-Match 并使用事务内 CAS。创建、撤销、过期与 Group membership 变化都会在读取和写入时按当前事实重新鉴权，撤权后的幂等重放不返回旧响应。

## 9. ServiceAccount 规则

Current ServiceAccount credential 绑定 `organizationId` 与 `audience`；operation binding 绑定 `spaceId`、允许的 scope 以及 Expert 或 Session exact resource。权限是当前 Organization/Space membership、credential 状态、audience 与 operation binding 的交集，数据库约束拒绝 `*` resource。

- 自动化可用 `session.create`、`session.send` 和按 Trigger 配置的 `session.archive`；不能 rename、restore、share、作人工 Approval 或进行 compliance access。
- worker 使用短期 delegation token，只能操作绑定 Session/Turn/Attempt，不能枚举其他 Session。
- create/send/archive 在应用策略预检后，于同一 PostgreSQL 写事务内重新锁定并检查 membership、credential、audience 和 exact binding；撤权后的幂等重放不返回旧响应。
- ServiceAccount 活动的 Turn 使用 `initiatorType=event`，AuditEvent 记录 service account actor 与命中的 policy reason，不把它伪装成人类 actor。
- 其他 Session 路由与 Catalog 继续 fail closed。ServiceAccount credential/binding 当前只由受控数据库/身份面配置，没有公开管理 API；Automation/Command delegation chain 和命令领取时重检仍是 Target。

## 10. Rename、archive 与 restore 命令契约

| 动作 | Target endpoint | 请求条件 | 成功结果 |
| --- | --- | --- | --- |
| rename | `PATCH /v1/organizations/{org}/spaces/{space}/sessions/{id}` | merge patch 只含 `title`；If-Match；不得接受 pin 字段 | 200 Session + 新/当前 ETag；变化时 `session.renamed` + AuditEvent |
| archive | `POST .../sessions/{id}/archive` | If-Match + Idempotency-Key；空 body | 200 Session + ETag + replay header；变化时 `archivedAt=now`、`session.archived` + AuditEvent |
| restore | `POST .../sessions/{id}/restore` | If-Match + Idempotency-Key；空 body | 200 Session + ETag + replay header；变化时 `archivedAt=NULL`、`session.restored` + AuditEvent |

三者必须在单事务内完成 authorization、CAS、必要的 Session update、SessionEvent 和 AuditEvent。archive/restore 还必须原子保存幂等响应；rename 依靠 If-Match/CAS，不创建幂等记录。三者都不使用异步 Command，也不得等待 Agent runtime，因为它们不改变执行状态。

## 11. SSE 恢复与实时撤权

Target endpoint 为 `GET /v1/organizations/{organizationId}/spaces/{spaceId}/sessions/{sessionId}/events`，媒介类型 `text/event-stream`。

Current runtime 的流式路径是 `.../events/stream`，未来游标在建流前返回 `400 VALIDATION_FAILED`；分页 Event endpoint 也使用同一当前错误语义。下列 `409 INVALID_EVENT_CURSOR` 与 `410 EVENT_CURSOR_EXPIRED` 是保留窗口和目标 problem contract 落地后的 Target，客户端在 OpenAPI 切换前不得按 Target 错误码推断当前行为。

### 11.1 恢复规则

- SSE `id` 等于持久化 `SessionEvent.sequence`；`event` 是稳定类型；`data.eventId` 用于至少一次交付去重。
- 缺少 `Last-Event-ID` 或值为 0 时，从最早仍保留的事件开始；客户端取得完整当前状态仍必须先 GET Session/相关资源，不能把 SSE 当快照 API。
- 有效 N 从 `sequence > N` 严格升序重放，追到最新后进入 live stream。N 等于最新值时直接等待新事件。
- N 大于当前最新 sequence 返回 409 `INVALID_EVENT_CURSOR`。N 早于可恢复窗口返回 410 `EVENT_CURSOR_EXPIRED`，响应包含不敏感的 `minimumAvailableSequence`，客户端重新 GET 快照后建立新流。
- heartbeat 至少每 15 秒发送 comment，不带 `id`，不推进 sequence。交付至少一次；客户端按 `eventId` 去重、按 sequence 检测 gap，发现 gap 必须断开并恢复，不能跳过。
- 同一 Session 的已提交事件不得乱序；跨 Session 不承诺顺序。

SessionEvent 保留期不得短于产品承诺的离线恢复窗口。该窗口和容量尚未由负载测试确定前，生产不得清除 SessionEvent；不得凭空填写一个无法验证的天数。

### 11.2 授权与内容

- 建流前执行与 GET Session 相同的 tenant、membership、visibility/share 和 ServiceAccount scope 检查。
- 网关至少在 heartbeat、policy invalidation 和每批重放前重检授权。token 到期、membership/grant 撤销、Organization suspend 或 scope 撤销时立即停止发送并关闭连接。
- Private 未授权初始请求返回 404；建立后撤权只关闭连接，后续重连返回 404，不在流中泄露原因。
- Archive 不关闭连接。事件 payload 不含 Secret、OAuth token、完整 prompt、File 内容、原始附件或大型 ToolCall input/output；只返回授权后可再拉取的 reference 和脱敏摘要。

## 12. 审计、保留与删除

### 12.1 AuditEvent

AuditEvent append-only，至少记录 actor/delegation chain、tenant、action、target、result、requestId、Idempotency-Key hash、IP/UA 摘要、字段级 before/after diff、policy decision、reason 和 occurredAt。

Session 范围必须审计：create、rename、archive、restore、share/revoke、visibility policy 决策、compliance access、ServiceAccount 命令、高风险 ToolCall、retention/legal hold、导出和永久删除。失败/拒绝也记录，但对未知或 concealed ID 不得在普通响应中泄露审计结果。

AuditEvent 禁止包含 Secret 明文、OAuth code/token、完整 prompt/Message、File/附件内容、未脱敏外部 payload 或 Idempotency-Key 明文。业务管理员无 UPDATE/DELETE 权限。

### 12.2 默认保留

| 数据 | Target 默认 | 删除条件 |
| --- | --- | --- |
| Session/Message/Turn/Attempt/Artifact metadata | 无限期 | 客户策略明确缩短、无 legal hold、合规作业 |
| Archive 状态 | 与 Session 同寿命 | restore 或 Session 合规删除 |
| Workspace snapshot | 终态后 24 小时 | 已同步交付物、无调查 hold |
| ToolCall 大 input/output | 30 天 | 摘要/hash/reference 规则保留 |
| AuditEvent | 至少 365 天 | Enterprise 可配置更长/外部归档 |
| Idempotency record | 至少 24 小时 | Event 去重另随原 Event 保留 |
| SessionEvent | 不短于承诺恢复窗口 | 见第 11.1 节；窗口未批准前不清除 |

Archive 不是 retention 信号。永久删除没有普通用户 endpoint，只由合规 deletion job 执行。作业必须幂等、可暂停、检查 legal hold、分批删除数据库/对象存储/搜索投影、写 tombstone/deletion ledger，并在备份恢复后重放 ledger。普通用户请求删除不得破坏共享 Organization File 的合法归属。

## 13. 迁移策略

当前数据库迁移为 `001..047`，仍不是完整 Target。生产迁移必须继续遵循 expand -> backfill -> validate -> switch -> contract：

### 13.1 Expand

1. 只增加 nullable/有安全默认值的 Session 生命周期列、counter、复合 unique index 和新表：Attempt、SessionEvent、ShareGrant、AuditEvent、retention/deletion ledger。
2. 复合 FK 先以 `NOT VALID` 添加；大索引使用 `CREATE INDEX CONCURRENTLY`，不在高流量事务中锁全表。
3. 添加 RLS policy 但先在 staging 以受限运行角色验证；生产启用 `FORCE RLS` 前应用必须已设置 transaction-local context。
4. 新代码先双写旧/新所需字段，并保持旧版本可读；功能旗标不能代替授权。

### 13.2 Backfill 与 validate

1. 按 tenant + 主键小批量回填 child tenant key、counter、version、archive 字段和复合引用；每批可重入并记录水位。
2. legacy `configurationResolutionVersion=0` Session 保持可读，未解析权威 revision 前 start/send/retry 返回 409 `LEGACY_CONFIGURATION_UNRESOLVED`，不得猜测配置。
3. 对既有 SessionEvent 不能伪造历史细节；切换时可追加一个明确标记 `migration.baseline` 的 redacted 基线事件，之后 sequence 从该事实连续增长。
4. 验证 orphan、cross-tenant FK、重复 ordinal/number/sequence、非法状态组合和空 tenant 数均为 0，再 `VALIDATE CONSTRAINT` 和设置 NOT NULL。
5. 在与生产规模相当的数据上记录锁等待、复制延迟、批量耗时和回滚阈值。

### 13.3 Switch 与 contract

1. 先切读到新约束/表，运行 shadow comparison 和本文全部 tenant/lifecycle 测试，再启用写 operation。
2. 使用非 owner、无 BYPASSRLS 的生产应用角色启用并强制 RLS；canary 验证后逐步放量。
3. 至少跨一个稳定发布窗口后才删除旧列、单列 FK/索引和双写代码。数据迁移不使用破坏性 down migration；失败时回滚应用或 forward repair/PITR。
4. OpenAPI、共享 contracts、Web adapter 与服务端同批通过 generated diff/consumer contract，未实现 operation 保持不可路由。

## 14. 精确验收矩阵

下列用例全部自动化；`DB` 表示 PostgreSQL 集成测试，`API` 表示 HTTP 合同测试，`E2E` 表示浏览器关键旅程，`OPS` 表示预发演练。任何 P0 失败都是生产 No-Go。

| ID | 层 | Given | When | Then |
| --- | --- | --- | --- | --- |
| SL-ISO-01 | DB/API | Org A 与 Org B 有相同 space/session ID | B 以该 ID list/get/update | 0 行或 404；无 timing/body 区分；A 数据不变 |
| SL-ISO-02 | DB | child payload 使用 A 的 org/space 和 B 的 session/turn ID | INSERT Message/Turn/Attempt/Event | 复合 FK 或 RLS 拒绝；无孤儿行 |
| SL-ISO-03 | DB | 同一连接先处理 A 再处理 B | 复用 pool connection | B 只能见 B；事务外无残留 `app.*` context |
| SL-ISO-04 | DB | 应用遗漏 tenant WHERE | 在受限生产角色查询 Space 表 | FORCE RLS 仍隔离；运行角色无 BYPASSRLS/owner 能力 |
| SL-AUTH-01 | API | Private Session，调用者无 grant | list/search/get/mutation/SSE | 列表无项目；单资源统一 404；无 ETag/计数泄露 |
| SL-AUTH-02 | API/SSE | collaborator 正在读取 Private Session | creator revoke grant | 新请求立即 404；现有 SSE 在下一授权检查前关闭 |
| SL-AUTH-03 | API | Space manager 无 Private grant | rename/archive/restore 私有 Session | 全部 404，Audit 可内部记录 denial |
| SL-AUTH-04 | API | viewer grant | rename/archive/restore/send | 写操作拒绝且无领域行；读取成功 |
| SL-AUTH-05 | API | collaborator grant | rename、send、archive | 前两项成功；archive 拒绝；version/event 符合规则 |
| SL-SA-01 | API/DB | ServiceAccount 无绑定 scope | 任一 Session domain request | 边缘/API 拒绝；无幂等/Command/审计 success 行 |
| SL-SA-02 | API/DB | Automation SA 仅有绑定 Session 的 archive scope | archive 绑定与非绑定 Session | 绑定成功并审计 delegation；非绑定 conceal/拒绝 |
| SL-CAS-01 | API/DB | 两客户端持有相同 ETag | 并发 rename 为不同标题 | 恰一项 200；另一项 412；version 只加 1 |
| SL-CAS-02 | API | mutation 缺少/格式错误/过期 If-Match | 调用 endpoint | 分别 428/400/412；无 SessionEvent/Command/Audit success |
| SL-IDEM-01 | API/DB | 相同 actor/key/body | 并发 create/send/archive | 只产生一组领域副作用；其余完整重放且 header=true |
| SL-IDEM-02 | API | 相同 actor/key，不同 canonical body | 第二次写 | 409 `IDEMPOTENCY_KEY_REUSED`；原结果不变 |
| SL-IDEM-03 | API | 原请求成功后 actor 被撤权 | 用原 key/body 重放 | 不返回缓存正文；按当前权限 conceal/拒绝 |
| SL-STATE-01 | API/DB | draft Session | start | queued；一个 Message/Turn/Command；连续 Event；单事务提交 |
| SL-STATE-01A | API/DB | 创建 `start=false` draft | message 省略/误带 message | 省略时只建 draft；误带时 400；随后 start 恰好保存一条首 Message |
| SL-STATE-02 | API/DB | active Session | 连续 send 三次 | Message sequence 与 Turn ordinal 各连续；worker FIFO 开始 |
| SL-STATE-03 | API/DB | paused Session | send 后 resume | send 只排队且保持 paused；resume 后 queued；无成功 ToolCall 重放 |
| SL-STATE-04 | API/DB | completed/failed Session | send | queued、`completedAt` 清空、新 Turn；历史终态 Event 保留 |
| SL-STATE-05 | API | canceled Session | send/resume/retry | 409 `INVALID_STATE_TRANSITION`；无写入 |
| SL-STATE-06 | DB | active Turn 失败但仍有 queued Turn | worker 提交失败 | Session 转 queued 而非 failed；下一 Turn 可领取 |
| SL-STATE-07 | API/DB | active Session，无 pending action | pause 后以新 key 再 pause，再用新 ETag cancel | 首次只标 pause requested；第二次 409；cancel 原子替换为唯一 pending cancel |
| SL-TRY-01 | API/DB | failed Turn，已有 Attempt 1 | 并发 retry 同 key | 仅新增 Attempt 2；Turn/Session queued；一个 Command |
| SL-TRY-02 | API | completed 或 canceled Turn | retry | 409；Attempt 数不变 |
| SL-ARCH-01 | API/DB | active Session | archive | status/Turn 不变；`archivedAt` 设置；SSE/执行继续 |
| SL-ARCH-02 | API/DB | archived completed Session | send | 新 Turn queued；Session 仍 archived |
| SL-ARCH-03 | API/DB | 已 archived/当前 Session | fresh archive/restore no-op | 200；ETag/version 不变；无重复业务 Event |
| SL-ARCH-04 | E2E | Session 已归档且有 Message/Artifact | restore | 内容和关联不变；current 列表出现，archived 列表消失 |
| SL-SEQ-01 | DB | 50 个并发领域更新同一 Session | 提交 | Event sequence 唯一、连续、无 `max+1` race |
| SL-SEQ-02 | DB | Outbox publish 失败后重试 | relay 重发 | 相同 eventId/sequence；不新增 SessionEvent |
| SL-SSE-01 | API/SSE | 已有 sequence 1..100，客户端从 40 重连 | `Last-Event-ID: 40` | 严格收到 41..100 后 live；无 gap；重复可按 eventId 去重 |
| SL-SSE-02 | API | cursor 大于 latest / 早于恢复窗口 | 建立 SSE | 分别 409/410；不开始 200 半截 stream |
| SL-SSE-03 | SSE | 无新事件 | 连接保持 | 15 秒内 heartbeat comment；不推进 Last-Event-ID |
| SL-AUD-01 | DB/API | rename/archive/restore/share/revoke/compliance access | 成功或拒绝 | append-only AuditEvent 含 scope/result/requestId，无正文/Secret |
| SL-RET-01 | DB/OPS | retention 到期但 legalHold=true | retention job 重跑两次 | 两次均跳过数据；结果可审计；无部分删除 |
| SL-RET-02 | OPS | 已完成 deletion ledger 后恢复旧备份 | 重放 ledger | 被删除 tenant 数据再次清除，搜索/对象存储无残留 |
| SL-MIG-01 | DB/OPS | 空库和 `001..015` legacy schema | 执行 `016..049` forward migrations | 两条路径 schema 等价；约束 validate；无 orphan/重复/非法状态；运行角色受限且 25 张租户表 FORCE RLS |
| SL-MIG-02 | API/DB | legacy configuration v0 Session | start/send/retry | 409 `LEGACY_CONFIGURATION_UNRESOLVED`；仍可授权读取/导出 |
| SL-MIG-03 | OPS | backfill 中断、应用回滚 | 重启批次/旧版本读 | backfill 幂等续跑；旧版本仍可读；无破坏性 down migration |

## 15. 完成定义

本规格达到 Target 只有同时满足：

1. 第 14 节全部 P0 用例在 CI 和预发通过，且数据库集成测试不得因缺少环境变量在发布流水线 skip。
2. OpenAPI、生成类型、`packages/contracts` 和实际 HTTP 响应无未批准漂移；仅已实现 operation 可达。
3. FORCE RLS、复合 tenant FK、Private concealment、ServiceAccount scope 由负向测试和第三方安全复核证明。
4. Session mutation、Command、SessionEvent、Outbox、幂等响应与必要 AuditEvent 的事务原子性已通过故障注入。
5. SSE 断线恢复、实时撤权、worker lease 丢失、备份恢复、migration 中断和 deletion ledger 已在预发演练。
6. 未实现或模拟的 Workbench 内容在生产禁用或明确标记 Simulation，不得作为客户事实。

任一项未满足时，产品只能用于内部或明确隔离的设计合作伙伴环境，不能称为生产版本。
