# Load/Soak 与依赖故障演练 Runbook

本文定义 Cosmos 当前可重复执行的有界 HTTP smoke、Session 生命周期 journey 和本地依赖 readiness 故障演练。它们用于发布回归和建立基线，不等同于生产容量、长时间 soak、多区故障或外部 provider/object-store 灾难恢复证据。

## HTTP 并发 smoke

默认只允许 loopback `GET /api/v1/me`，最多 10,000 请求、并发 100、单请求 60 秒；不会读取响应正文，也不会输出 URL、credential 或客户 payload：

```bash
LOAD_REQUESTS=500 \
LOAD_CONCURRENCY=25 \
LOAD_MAX_P95_MS=500 \
LOAD_MAX_ERROR_PERCENT=0 \
pnpm load:smoke
```

OIDC 环境从 Secret Manager 临时注入 `LOAD_AUTH_TOKEN`。远端目标还必须显式设置 `LOAD_ALLOW_REMOTE=true`，且 `LOAD_URL` 必须是 HTTPS；脚本拒绝无意中向远端发压。输出只包含请求/并发数量、成功/失败、错误率、p50/p95/p99/max 和 HTTP status counts。

每次发布 smoke 记录环境、release、请求/并发、route、阈值、结果和运行者。不要只测试 health/metrics，也不要把一次低流量 GET smoke 当成 Session create/send、数据库写、SSE 或 Worker 执行容量。

## Session 生命周期 journey

`pnpm soak:session` 必须显式设置 `JOURNEY_ALLOW_WRITES=true`。默认只访问 loopback development tenant，每个 journey 真实执行 draft create、相同幂等键重放、detail/messages/events 读取、CAS rename、过期 ETag 拒绝、archive/restore，并在结束时再次 archive，避免把 fixture 留在活跃列表：

```bash
JOURNEY_ALLOW_WRITES=true \
JOURNEY_COUNT=5 \
JOURNEY_CONCURRENCY=2 \
pnpm soak:session
```

单次最多 100 个 journey、并发最多 10、请求超时最多 60 秒。远端运行还要求 HTTPS、`JOURNEY_ALLOW_REMOTE=true`、显式 Organization/Space/Expert ID，以及从 Secret Manager 临时注入的 `JOURNEY_AUTH_TOKEN`。输出只包含完成 journey 数和已观察 Event 数，不包含 URL、Session ID、请求/响应正文或 credential。

该模式故意保存 draft 而不启动 Agent，用于证明 PostgreSQL 写路径、RLS/RBAC、幂等、CAS、timeline 与归档事务。Session start/send、SSE live、Worker lease 和 provider 行为必须在独立、显式批准的 staging execution soak 中验证，不能通过此命令推断。

## Worker readiness 故障演练

`pnpm drill:worker-readiness` 只接受 loopback API，执行以下闭环：

1. 确认 Worker 正常且 `/api/v1/capabilities` 的 execution enabled。
2. `docker compose stop worker`，等待数据库 heartbeat 超过 freshness window。
3. 确认 execution capability 关闭，同时 `/api/health` 和受认证 `/api/ready` 保持成功。
4. 重启 Worker，等待 capability 恢复。
5. 任一步失败或收到信号时，trap 都尝试重新启动 Worker。

默认转换等待上限 60 秒，可用 `DRILL_TRANSITION_TIMEOUT_SECONDS` 在 5-300 秒内调整。非 development 身份可从 Secret Manager 临时注入 `DRILL_AUTH_TOKEN`，但脚本仍拒绝非 loopback 目标，避免误停生产 Worker。

## PostgreSQL readiness 故障演练

`pnpm drill:database-readiness` 仅作用于本地 Compose。它先确认 health/ready 均为 200，再停止 PostgreSQL，验证进程 health 继续 200 而依赖 ready 在有界时间内 fail-closed 为 503；随后重启 PostgreSQL并等待 ready 恢复 200。EXIT/signal trap 会尽力恢复数据库容器。

该演练不等同于生产连接池耗尽、主备切换或跨区故障。目标环境必须通过编排平台执行等价但受变更窗口保护的演练，并保留发布、时间线、告警、RTO 和数据完整性证据。

## 2026-07-22 本地基线

- API GET smoke：500 requests、concurrency 25、0 errors、p50 23.90ms、p95 73.86ms、p99 84.05ms、max 97.31ms。
- Session journey：2 journeys、concurrency 2；完成 draft create/idempotency replay/detail/messages/events/CAS conflict/archive/restore/final archive，合计观察 4 个 create timeline events。
- Worker drill：heartbeat 过期后 capability disabled；API health/ready 未关闭；重启后 capability enabled。
- PostgreSQL drill：数据库停止时 API health 200、ready 503；API 容器 ID 不变且 restart count 保持 0；数据库恢复后 ready 200。
- Compose API、Worker、Web、PostgreSQL 在演练结束后均为 healthy。

这些数字只描述当次开发机与合成 fixture，不可外推生产客户数、写吞吐、数据库规格或 SLO 达成。目标 staging/production 还必须覆盖 Session create/send、SSE 连接/撤权、queue backlog、provider 429/timeout、对象存储 5xx、数据库连接耗尽、Worker lease fencing、滚动升级和至少数小时 soak。
