# 下一阶段交付计划

> 文档状态：当前执行基线
>
> 更新日期：2026-07-22
>
> 基线提交：Advisor 受控执行交付后更新

## 结论

Space 管理与 Advisor 受控执行已完成。生产硬化代码切片已覆盖对象存储、配额、PITR/恢复、限流、实时撤权、通知/SLO、负载/Session journey 和本地依赖故障演练；下一阶段仍需目标环境 execution soak、外部依赖证据与剩余 P1 产品延期项审计。

```text
Organization → Space defaults → Expert published revision + Environment ready revision → Session execution snapshot
```

Environment 已具备 Cloud/Daemon 类型、immutable revision、provisioning worker、retry/disable/archive、CAS/幂等、RBAC/RLS、审计/outbox、Expert 发布约束与 Session execution snapshot。Automation 已具备权威 Trigger、受限 Filter、test/enable/pause、Event 去重与脱敏、ServiceAccount Session dispatch、Event Log 和 Run History 同源投影。没有 provider credential 或在线 Daemon pool 时，worker 返回安全的 unavailable failure，不会伪造 ready。

## 当前基线

已完成：

- Docker Compose 的 PostgreSQL、API、Worker、Web 运行态健康。
- `/context` 的 ContextEngine-plugin 代理、权限校验和结果展示。
- Session 创建、启动、续聊、归档、恢复、分享、Artifact、Worker、Tool Call、Approval 的受控服务端链路。
- Expert 的 Custom/Managed 生命周期、immutable revision、发布后的 draft clone、`If-Match` 和幂等写入。
- Environment 的创建、更新、retry、disable、archive、immutable revision、provisioning timeline 与 Session execution snapshot。
- Automation 的创建、更新、测试、启停、Event 接收/去重/匹配、ServiceAccount Session 创建、Event Log 与 Run History。
- Space 的权威列表/创建/更新、Default Space、默认 Expert/Environment 校验、真实 scope 切换与删除迁移影响预览。
- 黑白主题、中文/英文、桌面/390px 小屏的主要页面验收。

仍是缺口或受限能力：

| 领域 | 当前状态 | 影响 |
| --- | --- | --- |
| Environment provider | 控制面和 worker 编排已完成；Compose 未配置 Cloud provider credential 或在线 Daemon pool | 新 Environment 会真实进入 failed/unavailable，可配置 provider 后 retry |
| Automation 外部入口 | 当前是受认证 manager/internal test Event ingress；仅保存脱敏 payload/headers | 外部 webhook 验签、原文密文存储、异步 router worker 与 replay/dead-letter 尚未完成 |
| Automation 生命周期 | `autoArchive` 已持久化；Trigger 使用 CAS 直接更新并回到 paused | 自动归档执行、delete/archive，以及随 Expert draft revision 发布切换仍未完成 |
| Space 删除迁移 | 已计算源/目标与 Sessions/Experts/Environments/Automations/Files 影响，并阻止 Default Space 迁移 | 逐资源迁移执行、恢复/回滚与最终 archive/delete 仍 capability-gated |
| Files | Worker 内部 append 与只读浏览已存在；FileVersion 已支持 checksum 校验的 S3-compatible object backend 与 inline 历史兼容 | 生产 bucket/IAM/retention、orphan GC 和对象备份恢复证据仍未完成 |
| Agent execution | 基础对话和只读 Workspace tools 可用，coding sandbox/外部写工具未开放 | 不能把执行结果当成完整代码交付能力 |
| Advisor model provider | 控制面 plan/diff/confirm 闭环已完成；本地配置的兼容 provider `/models` 可访问，但 `/chat/completions` 对当前客户端返回 403 | Worker 会安全记录 `provider_http_error`；不会伪造 plan 或执行成功，需 provider 放行后再做在线模型 smoke |
| Production hardening | 高可用、PITR、容量和负载恢复证据未完成 | 仍不适合直接承载公网客户数据 |

## M3-E：Environment 生命周期（已完成）

### 交付结果

- Contracts/API/OpenAPI 对齐 create/update/retry/disable/archive、revision 与安全 provisioning error。
- PostgreSQL migrations `062`-`065` 建立 revision checksum、provisioning lease/fencing、append-only audit、outbox、execution snapshot 与 manager-only RLS。
- Worker 有有限重试、过期 lease 恢复和 fencing completion；没有 provider/daemon 能力时明确失败。
- Web 提供 Cloud/Daemon 创建与编辑、仓库绑定、Secret reference、Hooks、network policy、状态进度、revision diff、retry/disable/archive。
- Expert 发布与 Session 启动继续只接受 active Ready revision；Session 创建持久化 immutable execution snapshot。

### 验证证据

- Contracts 51 tests、API 207 tests、Web 196 tests 通过。
- PostgreSQL integration 24 files / 137 tests 通过，包含跨 tenant、member 写拒绝、幂等、CAS、immutable revision、worker failure/retry/success。
- `pnpm check`、`pnpm openapi:lint`、Docker rebuild/health 与桌面/390px 浏览器 smoke 为交付门禁。

### 用户结果

Space Admin 可以在统一、克制的 Cosmos 风格控制面中：

1. 创建 Cloud 或 Self-hosted/Daemon 类型 Environment。
2. 配置镜像、repository bindings、默认分支、环境变量引用、Hooks、sharing 和 network policy。
3. 看到 provisioning、ready、updating、failed、disabled 的真实状态和可恢复错误。
4. 以 immutable revision 更新配置；正在被已发布 Expert 或 Session 引用的 revision 不被原地覆盖。
5. 对失败 provisioning 执行受权限保护的 retry/disable；删除前检查引用并给出迁移提示。
6. 将 active Environment revision 绑定到 Expert 发布和 Session execution snapshot，刷新页面后仍保持一致。

### 实施顺序

1. **Contracts 与数据模型**：补齐 Create/Update/Retry/Disable 请求、revision、provisioning 阶段、safe error DTO；新增迁移（沿用当前 migration 顺序，不重写历史迁移），约束 tenant、状态转移、revision 唯一性和 active 引用。
2. **API 与权限**：实现 `POST /environments`、`PATCH /environments/:id`、`POST /environments/:id/retry`、`POST /environments/:id/disable` 和受保护的删除/归档语义；所有写入使用 `Idempotency-Key`、`If-Match`、RBAC、append-only audit 和结构化错误。
3. **Provisioning worker**：把接受请求与实际 provisioning 解耦；使用 lease/fencing、有限重试、失败原因脱敏、幂等 outbox。没有 provider/daemon 凭据时必须明确返回 unavailable，不得显示“已成功”。
4. **Web 控制面**：保留当前黑白、紧凑、信息优先的视觉语言；补齐创建向导、详情 Inspector、配置 revision diff、状态时间线、错误恢复和权限禁用态。移动端优先查看/重试，复杂配置在桌面完成。
5. **Expert/Session 联动**：发布前校验 Environment 可用性；Session 创建只接受真实 Environment ID，服务端固定 active revision 与 safe snapshot，不信任前端展示字段。
6. **验证与上线**：覆盖 contracts、API route、迁移、RLS/跨 tenant、幂等/CAS、worker 恢复、浏览器桌面/移动端和 Docker migration smoke；再进入下一条 M4 Automation 切片。

### 退出条件

- PRD-P1-03、PRD-P1-04 的 Given/When/Then 全部有自动化或人工证据。
- Cloud 与 Daemon 的类型和运行关系在 UI、API、审计和 Session snapshot 中一致，不把 Daemon 假装成 Cloud。
- 未 ready/disabled 的 Environment 不能被新 Expert revision 发布或新 Session 启动；已有 Session 仍可读并显示限制。
- 并发更新返回明确 `409`，重复 Idempotency-Key 只重放原响应，不产生第二个 Environment/revision/provisioning job。
- 跨 Organization/Space 读取和写入均被拒绝，并有负向集成测试。
- API/OpenAPI/Contracts 一致，`pnpm check`、`pnpm openapi:lint`、PostgreSQL integration、Docker health 和浏览器 smoke 全部通过。
- 不记录 Secret 明文、完整私密 prompt、Authorization header 或 provider 响应原文。

## M4-A：Automation 权威模型（已完成）

### 交付结果

- Contracts/API/OpenAPI 对齐权威 Trigger、受限 JSONLogic、Event、Run History 与 Automation 来源 Session。
- PostgreSQL migrations `066`-`067` 建立 Trigger、Event、append-only audit/outbox、FORCE RLS、外部 Event ID 去重和旧开发 fixture 兼容修复。
- 创建默认 paused；成功 Test event 后才能 enable；更新与启停使用 `If-Match`、`Idempotency-Key`、manager RBAC、CAS 和审计。
- Event 在服务端脱敏后持久化，匹配 active Trigger，并通过绑定的精确 ServiceAccount/Expert policy 创建唯一 Session；重复 external ID 重放原 Event，不创建第二个 Session。
- 生产 `/automations`、`/automations/events`、`/automations/history` 从同一服务端事实链读取，并覆盖加载、空、错误、权限、创建、编辑、测试、启停、去重、失败和打开 Session 状态。

### 验证证据

- Contracts 54 tests、API 210 tests、Web 202 tests 通过。
- PostgreSQL integration 25 files / 139 tests 通过，覆盖跨 tenant、member 写拒绝、幂等、CAS、Event 去重、ServiceAccount binding 和 Event → Session 关系。
- `pnpm check`、`pnpm openapi:lint`、Docker rebuild/health 为交付门禁。
- 浏览器真实闭环验证创建、测试、启用、Event dispatch、重复 Event 去重、Event Log/Run History 同源；桌面与 `390×844` 无横向溢出。Session 后续 Agent execution 若 provider 失败会显示真实 failed，不把 Event dispatch 冒充模型执行成功。

### 明确延期

- 外部 provider webhook 验签、原始 headers/payload 密文存储和 provider-specific schema 脱敏。
- 独立异步 Event router worker、replay/dead-letter、Subscription fan-in；当前匹配与 Session dispatch 在受认证 API 请求内完成。
- `autoArchive` 执行器与 Trigger delete/archive；当前只持久化 auto-archive 设置。
- Trigger update 随 Expert draft revision 发布切换；当前 `relay_expert_triggers` 是 CAS versioned 权威资源，更新后回到 paused。

## M4-B：Space 管理（已完成）

### 交付结果

- Migrations `068`-`069` 为 Organization/Space 增加 Default Space、slug、description、status、默认 Expert/Environment、settings、CAS version 与更新时间，并建立审计/outbox/组织级幂等、FORCE RLS 和旧 fixture 插入兼容。
- API/OpenAPI/Contracts 实现 list/get/create/update/set-default/migration-preview；创建只允许 Organization owner/admin，更新允许 Space manager，Default Space 不可改名。
- 默认 Expert 必须是同 Space 的 published Expert，默认 Environment 必须是同 Space 的 ready Environment；跨 tenant ID 不能作为默认值。
- `/me` 返回权威 `isDefault`，无有效本地偏好时 WorkspaceProvider 选择服务端 Default Space；本地选择仍按 actor + Organization + Space membership 重检。
- 生产 `/spaces` 支持真实 scope 切换、创建、编辑、默认切换、权限禁用态和非破坏性迁移影响预览；不会把尚未实现的资源移动/删除伪装成成功。

### 验证证据

- Contracts 57 tests、API 212 tests、Web 206 tests 通过。
- PostgreSQL integration 26 files / 141 tests 通过，Space 专项覆盖 restricted runtime role、RLS、幂等、CAS、Default invariant、跨 tenant concealment 与迁移计数。
- `pnpm check`、`pnpm openapi:lint`、Docker rebuild/health 与桌面/390px 浏览器 smoke 为交付门禁。

### 明确延期

- 实际跨 Space 迁移、逐资源 ID/FK 重写、暂停新写入、可恢复 job、回滚和最终 archive/delete；当前只开放权威影响预览。
- Space membership、邀请与批量角色管理；当前继续由身份/membership 数据源提供。
- settings 的产品化字段与 Organization 级治理策略；当前只提供有界 JSON authority。

## M4-C：Advisor 受控执行（已完成）

### 交付结果

- 内置 Advisor 作为普通 Session Expert；通过受控 `advisor_plan_propose` tool 生成结构化 plan，并持久化 before/after diff、风险、依赖和执行状态。
- 用户显式确认后才执行控制面写入；当前支持 `space.update` 与 `organization.set_default_space`，沿用 Space authority 的 CAS、幂等、RLS、审计和 outbox 事实链。
- OAuth/Secret 仅生成 `action_required` 人工步骤，不读取、保存或伪造凭据；Environment/Expert/Automation Advisor 动作继续 capability-gated。
- failed plan 可安全 retry；版本冲突不会重放过期 before state，需重新生成 plan。每个控制步骤使用确定性 `advisor:{planId}:{stepId}` 幂等键。
- Web Session workbench 展示 plan、diff、依赖、风险、确认/拒绝、失败重试和人工步骤，并覆盖 loading/empty/error/permission 与移动端布局。

### 验证证据

- Contracts 60 tests、API 214 tests、Web 207 tests 通过；OpenAPI lint 通过，生产构建成功。
- PostgreSQL integration 27 files / 144 tests 通过，覆盖 Advisor proposal 去重、跨 tenant concealment、CAS/confirm、Space authority 写入、审计计数和人工 OAuth action-required。
- Docker rebuild 后 API、Worker、Web、PostgreSQL 均 healthy；`/api/health` 200、Web 200、migration `070_advisor_controlled_execution.sql` 已应用，日志 fatal/panic/unhandled 扫描干净。
- 浏览器验证 Advisor 生产 catalog/session、失败/空计划态；桌面 1280px 与 `390×844` 均无横向溢出。在线模型 smoke 受 provider `/chat/completions` 403 限制，未把失败伪装成成功。

### 明确延期

- 真实模型 provider 放行前，不承诺在线 Advisor 自动生成 plan；控制面和 Web 在 provider unavailable 时继续显示安全失败。
- `environment.*`、`expert.*`、`automation.*` 等更高风险 Advisor 操作需单独 capability、schema、迁移与人工确认设计。

## 生产硬化-1：FileVersion 对象存储（已完成代码切片）

### 交付结果

- Migration `071_object_storage_file_versions.sql` 为 FileVersion 增加 `storage_backend` 与 opaque `object_key`；历史 inline `bytea` 行保持可读，新 object 行不在 PostgreSQL 保存内容副本。
- S3-compatible adapter 使用条件创建、SHA-256 checksum、大小/hash 读取校验和安全的 provider 错误；对象 key 只含 tenant hash 与版本 ID，不含客户路径。
- File 读取先完成现有 tenant/RBAC/ShareGrant 授权，再拉取对象；对象缺失、校验失败或 provider 不可用返回可重试 `503 OBJECT_STORAGE_UNAVAILABLE`，不泄露 bucket/key/provider 原文。
- staging/production API 与 Worker 缺少完整 Object Storage 配置会 fail-closed；development/test 可继续使用 inline 兼容路径。

### 验证证据

- API 26 files / 217 tests、Web 20 files / 207 tests 通过；PostgreSQL integration 27 files / 145 tests 通过，其中 File 专项 7 tests 覆盖 migration、metadata-only object 写入、授权读取、完整性校验、配额与不可变账本。
- `@aws-sdk/client-s3` 依赖通过 frozen lockfile/supply-chain policy；S3-compatible 运行态接入保留为部署配置，不把本地 credential 写入仓库。

### 明确延期

- 生产 bucket/IAM/KMS、生命周期/retention、跨区域复制和对象备份恢复演练。
- 现有 Worker 仍只通过受控 File repository 读对象；coding sandbox、外部写工具和大输出对象化另有 capability 边界。

## 生产硬化-2：Object retention 与 orphan GC（已完成）

### 交付结果

- `ObjectStore` 增加有界分页 list；GC 只扫描 `organizations/` prefix，按 PostgreSQL `relay_file_versions.object_key` 权威引用集保护仍在使用的对象。
- `pnpm object-storage:gc` 要求显式 `dry_run|apply`，最小保护窗 24 小时、单次对象上限有界，并用全局 advisory lock 阻止并发运行。
- Migration `072_object_storage_gc_runs.sql` 建立 append-only、count-only 运维账本，不保存 object key、客户路径或凭据；partial/failed 使用安全错误码。
- Runbook 明确 bucket 版本化、KMS、公开访问阻断、最小 IAM、生命周期与恢复抽样要求；GC 不由 API/Worker 静默触发。

### 验证证据

- Contracts 60 tests、API 217 tests、Web 207 tests 与生产构建通过；PostgreSQL integration 28 files / 147 tests 通过。
- GC 专项验证 dry-run 不删除、apply 只删除超龄 orphan、引用对象保持可读、运行证据不可 UPDATE/DELETE。

### 明确延期

- 真实云 bucket/IAM/KMS/跨区域复制的部署和季度恢复演练必须在目标环境执行，仓库代码不能替代云侧证据。
- 下一条生产硬化切片转向 Organization 配额权威模型与限流共享状态。

## 生产硬化-3：Organization 配额与共享限流（已完成）

### 交付结果

- Migration `073_organization_quotas_and_rate_limits.sql` 为每个 Organization 建立默认 File storage 上限、API 窗口/请求上限和单行共享窗口；新 Organization 自动创建默认 quota。
- FileVersion writer 读取数据库 quota 权威值并在 advisory lock 下计算使用量；测试 override 仅用于受控 fixture，生产不依赖进程常量。
- API 保留第一层 per-instance IP burst limiter，并在鉴权后的 scoped route 使用 PostgreSQL Organization window 原子 upsert；跨 API 实例共享计数、窗口滚动、429 headers 和首次越界安全审计一致。
- quota/window 表使用 FORCE RLS；API 只可访问当前 membership，Worker 只读 quota，普通控制面不允许修改商业/运维 quota。
- limiter 数据库不可用时 fail-closed 返回可重试 503；未知 Organization 不产生计数，继续由既有授权层返回统一 concealment。

### 验证证据

- API 26 files / 218 tests、Web 20 files / 207 tests 通过；PostgreSQL integration 29 files / 149 tests 通过。
- 专项覆盖 Organization window 原子计数、首次/重复拒绝、窗口滚动、outsider concealment、DB File quota、RLS 和安全表保护数量（50 tenant tables）。

### 明确延期

- quota 的 billing/商业管理 UI、跨区域限流 broker、Edge/WAF 全局规则和容量压测仍需目标生产环境配置与证据。

## 生产硬化-4：PITR 与恢复门禁（已完成代码切片）

### 交付结果

- 新增 `pnpm db:pitr-preflight`：自建 PostgreSQL 校验版本、WAL/full-page-write、archive 配置、RPO 内 `archive_timeout`，并可经显式批准强制 WAL switch、等待 `pg_stat_archiver` 证明端到端归档成功。
- 托管 PITR 模式要求注入 provider、证据 ID 和 retention，保留云平台证据边界；仓库检查不会把“声明已配置”冒充真实时间点恢复。
- 隔离恢复从“存在 migration”升级为精确 release migration 数量/版本、关键表、FORCE RLS、API/Worker ACL、Organization quota 完整性和 FileVersion inline/object 约束验证。
- Required checks 在真实 PostgreSQL 17 上执行逻辑备份/隔离恢复，并启动启用连续归档的独立 PostgreSQL 实例完成 live WAL archive preflight。

### 明确延期

- 生产托管数据库 PITR 开关、加密跨账号归档、最早恢复点和季度真实恢复记录必须由目标环境/IaC 与变更系统提供；仓库 CI 只能证明脚本和恢复契约可执行。
- 下一条生产硬化切片转向 SSE 实时撤权，确保 membership/ShareGrant 被撤销后长连接在有界时间内停止私有事件投递。

## 生产硬化-5：SSE 实时撤权（已完成）

### 交付结果

- SSE 首次建流、连续分页和无事件轮询都通过当前 PostgreSQL timeline policy 查询；每次查询重新检查 Organization membership、Space membership、Private visibility、ShareGrant active 状态和 Group membership，不依赖已签发 token 中的角色或旧授权快照。
- ShareGrant 通过受保护的 HTTP revoke 后，现有流在下一次有界轮询返回 concealment 并关闭；Space membership 被移除后同样关闭，后续重连走统一 404 concealment，不发送撤权后的私有事件。
- 新增真实 PostgreSQL SSE 集成证据，覆盖 HTTP ShareGrant revoke、membership 删除、撤权后 owner 写入新事件以及连接关闭上限；已有 heartbeat token 失效、连续 backlog 重认证和连接预算测试继续保留。
- Web SSE consumer 将服务端 `reconnect` 作为恢复信号；一旦重连得到 404/401/403，清空私有 timeline 并进入 concealment 状态，不把断开的连接继续显示为已授权。

### 明确延期

- 当前撤权传播依赖每轮/每批 timeline 查询，生产默认 `pollMs=1000`；跨区域 pub/sub policy invalidation、全局 SSE 连接配额、撤权 p95 指标和告警仍需目标环境的通知/SLO 切片。

## 生产硬化-6：通知与 SLO 代码门禁（已完成代码切片）

### 交付结果

- 新增受保护的 `GET /api/metrics` Prometheus exposition；没有 `METRICS_SCRAPE_TOKEN` 时 conceal 为 404，错误 bearer 返回 401，token 只从服务端环境/Secret Manager 注入且不进入输出、日志或 label。
- API 记录固定 method、Fastify route template、status class 的 request counter、固定 request-duration histogram，以及成对维护的 SSE active/configured-limit gauge；不使用 actor、tenant、Session、resource ID 等高基数或私密 label。
- `ops/observability/relay-alerts.yaml` 提供按 cluster/environment/service 聚合的 99.9% availability fast-burn、target down、p95 latency 和单实例 SSE capacity 规则；结构与禁止高基数 label 由代码测试门禁。
- `docs/observability-slo-runbook.md` 定义 scrape token、安全聚合、page/ticket 路由、15 分钟 ACK/升级、合成通知演练和五类告警处置步骤。

### 验证证据

- Contracts 60、API 28 files / 223 tests、Web 20 files / 207 tests 与生产构建通过；OpenAPI lint 通过；PostgreSQL integration 29 files / 149 tests 通过。
- Docker rebuild 后 API、Worker、Web、PostgreSQL 均 healthy，health/ready 200，日志 fatal/panic/unhandled 扫描为空。
- 隔离非 root API 容器验证 metrics 未配置 404、无/错误 token 401、正确的临时 token 200；响应包含低基数 HTTP counter 与 SSE limit 且不回显 token。

### 明确延期

- 仓库不能证明目标环境已部署 Prometheus/Alertmanager、dashboard、receiver 和 24x7 on-call；上线前仍须执行 `promtool check rules`、合成 page 送达/ACK/升级演练，并保存不含凭据的证据。
- 当前指标覆盖 API HTTP 与 SSE 容量；DB pool、queue age、worker lease、provider/object-store error、outbox/audit lag 和业务旅程指标在下一负载/故障与 worker telemetry 切片继续补齐。

## 生产硬化-7：Worker telemetry 与有界负载/故障演练（已完成代码切片）

### 交付结果

- metrics scrape 通过既有数据库 heartbeat readiness 查询输出 `relay_execution_enabled` 与 `relay_worker_execution_ready`；只有执行已启用且全部 Worker heartbeat 失效时才触发 `RelayWorkerExecutionUnavailable` page。
- 新增 `pnpm load:smoke`：默认只打 loopback read path，严格限制 request/concurrency/timeout，远端必须显式批准且只允许 HTTPS；credential 只从环境读取，输出不含 URL、token 或响应正文。
- 新增 `pnpm drill:worker-readiness`：本地停止 Worker、等待 heartbeat 过期、验证 execution capability 关闭而 health/ready 保持，再重启并确认恢复；EXIT/signal trap 保证尽力恢复 Worker。
- `pnpm test:ops` 将 PostgreSQL/故障脚本语法和 load harness 的边界、percentile、threshold、credential 不回显纳入 `pnpm check`。

### 验证证据

- 本地真实 API 运行 500 requests / concurrency 25：500 success、0 error、p95 73.86ms、p99 84.05ms、max 97.31ms。
- Worker 停止后 execution capability 在 freshness window 内关闭，API health/ready 保持；Worker 重启后 capability 恢复，演练结束 Compose 四服务 healthy。

### 明确延期

- 当前数字只是开发机 GET smoke，不能证明生产容量或 SLO；staging 仍须运行 Session create/send、SSE、queue backlog、provider/object-store/DB fault、lease fencing、rolling deploy 和数小时 soak。
- DB pool、queue depth/age、lease age、outbox/audit lag 的低基数 runtime metrics 仍需独立监控权限/采集链路，不能让普通 tenant API role 获得跨租户运营查询。

## 生产硬化-8：Session journey 与数据库 readiness 故障演练（已完成代码切片）

### 交付结果

- 新增 `pnpm soak:session`，默认只允许显式批准的 loopback 写入；远端必须使用 HTTPS、再次显式批准、提供精确 Organization/Space/Expert ID，并从 Secret Manager 注入短期 OIDC token。
- 每个 journey 真实覆盖 draft create、相同 `Idempotency-Key` 完整重放、detail/messages/events、CAS rename、过期 ETag 412、archive/restore，并最终归档 fixture；输出不含 URL、Session ID、正文或 credential。
- 新增 `pnpm drill:database-readiness`：本地停止 PostgreSQL，验证 API health 保持而 ready fail-closed，随后恢复数据库与 runtime；EXIT/signal trap 保证尽力恢复。
- 演练发现并修复 `pg.Pool` 与 active client error 未监听会终止 API/Worker 的缺陷；共享运行时连接池现在要求显式脱敏 handler，API/Worker 只记录固定事件名而不序列化连接错误。

### 验证证据

- 本地 2 journeys / concurrency 2 完成全部写路径并观察 4 个 create timeline events；fixture 最终归档，未触发 Worker 或模型 provider。
- PostgreSQL 停止后 API health 200、ready 503；API 容器 ID 保持不变且 restart count 从 0 到 0；PostgreSQL 恢复后 ready 200，Compose 四服务恢复 healthy。
- Contracts 60、API 29 files / 224 tests、Web 20 files / 207 tests、ops 6 tests、PostgreSQL 29 files / 149 tests、`pnpm check` 与 `pnpm openapi:lint` 通过。

### 明确延期

- 当前 journey 故意使用 draft，不能证明 Session start/send、SSE live、queue backlog、Worker lease 或 provider 行为；这些必须在有预算、隔离 tenant 和短期 OIDC credential 的 staging execution soak 中执行。
- 本地单 PostgreSQL stop/recovery 不能证明生产连接池耗尽、托管数据库 failover、跨区 RTO/RPO 或数据完整性；目标环境仍需受变更窗口保护的演练和外部告警证据。
- staging URL/identity、Prometheus/Alertmanager、云对象存储和 provider 故障注入控制当前未提供，仓库不会伪造其执行结果。

## M4 排序

后续按以下顺序推进：

1. **Automation 权威模型（M4-A 已完成）**：已交付 Trigger 唯一资源、Event 去重/脱敏/匹配、ServiceAccount Session dispatch 与同源 Run History；上述延期项在后续 Automation hardening 收口。
2. **Space 管理（M4-B 已完成）**：已交付 Default、默认 Expert/Environment、删除迁移预览和真实 scope 切换；实际迁移执行保持 capability-gated。
3. **Advisor 受控执行（M4-C 已完成）**：plan/diff/confirm、受控工具、失败恢复和审计；OAuth/Secret 只返回人工步骤，不伪造完成。
4. **生产硬化（进行中）**：对象存储、orphan GC、Organization 配额/共享限流、PITR/恢复门禁、SSE 实时撤权、通知/SLO、Worker telemetry、有界负载、Session journey 和本地依赖故障演练代码切片已完成；下一项是独立运维指标采集权限/链路、目标环境 execution soak，以及剩余产品延期项审计。

Pinned Sessions、Artifact 高级搜索和高级启动覆盖属于 P2，在上述 P1 控制面闭环之后处理。

## 模型 Key 与插件边界

Environment 生命周期本身不需要新增模型 API Key。只有 Worker 真实调用对话模型时，才从服务端 Secret Manager/环境变量读取已有 provider key；ContextEngine-plugin 只需要 Relay API 侧的 `CONTEXT_ENGINE_BASE_URL`、`CONTEXT_ENGINE_API_KEY` 等服务端配置，浏览器永远不接触插件密钥。

Environment 的 variables、provider credentials、webhook signing token 等只能保存为 Secret reference，不能把明文值写入 DTO、日志、URL、Web bundle 或 Git。

## 每次交付的固定流程

以后每完成一个可交付切片，自动执行以下流程，不再等待额外提醒：

1. `git status --short --branch`，确认范围并保留无关改动。
2. 运行相关快速检查，完成后运行 `pnpm check` 与 `pnpm openapi:lint`；涉及运行时则执行 PostgreSQL integration、Docker rebuild/health 和关键浏览器流程。
3. 更新本计划或对应领域文档，记录实际验证证据与明确延期项。
4. 检查 diff 中没有 token、API key、Authorization header 或 secret value。
5. 直接提交到 `main`，提交信息使用简短 Conventional Commit。
6. `git push origin main`。
7. `git fetch origin main`，确认 `git rev-parse main` 与 `git rev-parse origin/main` 完全相同。
8. 交付回复必须说明：提交、推送结果、检查结果、Docker/浏览器状态、未完成项和是否需要模型 Key。

推送前如果验证失败，必须修复或明确报告阻塞原因，不得以“本地看起来正常”替代质量门；任何密钥均不得打印、截图或提交。
