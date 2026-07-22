# 下一阶段交付计划

> 文档状态：当前执行基线
>
> 更新日期：2026-07-22
>
> 基线提交：Advisor 受控执行交付后更新

## 结论

Space 管理与 Advisor 受控执行已完成。下一条垂直切片是 **生产硬化**：补齐对象存储、配额、PITR/恢复、限流、实时撤权、通知/SLO 和负载/故障演练证据。

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
| Files | Worker 内部 append 与只读浏览已存在，provider 写入和对象存储未完成 | 代码修改闭环不能对外承诺 |
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

## M4 排序

后续按以下顺序推进：

1. **Automation 权威模型（M4-A 已完成）**：已交付 Trigger 唯一资源、Event 去重/脱敏/匹配、ServiceAccount Session dispatch 与同源 Run History；上述延期项在后续 Automation hardening 收口。
2. **Space 管理（M4-B 已完成）**：已交付 Default、默认 Expert/Environment、删除迁移预览和真实 scope 切换；实际迁移执行保持 capability-gated。
3. **Advisor 受控执行（M4-C 已完成）**：plan/diff/confirm、受控工具、失败恢复和审计；OAuth/Secret 只返回人工步骤，不伪造完成。
4. **生产硬化（下一步）**：对象存储、配额、PITR/恢复、限流、实时撤权、通知/SLO、负载与故障演练。

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
