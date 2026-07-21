# 下一阶段交付计划

> 文档状态：当前执行基线
>
> 更新日期：2026-07-21
>
> 基线提交：随本次 Environment 生命周期交付更新

## 结论

Environment 生命周期与配置写入已完成。下一条垂直切片是 **Automation 权威模型**：把确定性 Web prototype 收敛为服务端唯一事实链，确保 Trigger、Event、Run 与 Session 创建之间具备租户隔离、幂等与审计关系。

```text
Environment revision → Expert published revision → Session execution snapshot
```

Environment 已具备 Cloud/Daemon 类型、immutable revision、provisioning worker、retry/disable/archive、CAS/幂等、RBAC/RLS、审计/outbox、Expert 发布约束与 Session execution snapshot。没有 provider credential 或在线 Daemon pool 时，worker 返回安全的 unavailable failure，不会伪造 ready。

## 当前基线

已完成：

- Docker Compose 的 PostgreSQL、API、Worker、Web 运行态健康。
- `/context` 的 ContextEngine-plugin 代理、权限校验和结果展示。
- Session 创建、启动、续聊、归档、恢复、分享、Artifact、Worker、Tool Call、Approval 的受控服务端链路。
- Expert 的 Custom/Managed 生命周期、immutable revision、发布后的 draft clone、`If-Match` 和幂等写入。
- Environment 的创建、更新、retry、disable、archive、immutable revision、provisioning timeline 与 Session execution snapshot。
- 黑白主题、中文/英文、桌面/390px 小屏的主要页面验收。

仍是缺口或受限能力：

| 领域 | 当前状态 | 影响 |
| --- | --- | --- |
| Environment provider | 控制面和 worker 编排已完成；Compose 未配置 Cloud provider credential 或在线 Daemon pool | 新 Environment 会真实进入 failed/unavailable，可配置 provider 后 retry |
| Automation | UI 为确定性 prototype，没有权威服务端模型 | Trigger、Event Log、Run History 不能形成唯一事实链 |
| Files | Worker 内部 append 与只读浏览已存在，provider 写入和对象存储未完成 | 代码修改闭环不能对外承诺 |
| Agent execution | 基础对话和只读 Workspace tools 可用，coding sandbox/外部写工具未开放 | 不能把执行结果当成完整代码交付能力 |
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

## M4 排序

Environment 完成后按以下顺序推进：

1. **Automation 权威模型**：Expert Trigger 唯一写模型，Event payload/headers/idempotency/match explanation 可追溯，重复 Event 不重复创建 Session。
2. **Space 管理**：Default、默认 Expert/Environment、删除迁移预览和真实 scope 切换。
3. **Advisor 受控执行**：plan/diff/confirm、受控工具、失败恢复和审计；OAuth/Secret 只返回人工步骤，不伪造完成。
4. **生产硬化**：对象存储、配额、PITR/恢复、限流、实时撤权、通知/SLO、负载与故障演练。

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
