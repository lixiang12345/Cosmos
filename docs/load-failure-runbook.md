# Load Smoke 与 Worker 故障演练 Runbook

本文定义 Relay 当前可重复执行的有界 HTTP smoke 和本地 Worker readiness 故障演练。它们用于发布回归和建立基线，不等同于生产容量、长时间 soak、多区故障或外部 provider/object-store 灾难恢复证据。

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

## Worker readiness 故障演练

`pnpm drill:worker-readiness` 只接受 loopback API，执行以下闭环：

1. 确认 Worker 正常且 `/api/v1/capabilities` 的 execution enabled。
2. `docker compose stop worker`，等待数据库 heartbeat 超过 freshness window。
3. 确认 execution capability 关闭，同时 `/api/health` 和受认证 `/api/ready` 保持成功。
4. 重启 Worker，等待 capability 恢复。
5. 任一步失败或收到信号时，trap 都尝试重新启动 Worker。

默认转换等待上限 60 秒，可用 `DRILL_TRANSITION_TIMEOUT_SECONDS` 在 5-300 秒内调整。非 development 身份可从 Secret Manager 临时注入 `DRILL_AUTH_TOKEN`，但脚本仍拒绝非 loopback 目标，避免误停生产 Worker。

## 2026-07-22 本地基线

- API GET smoke：500 requests、concurrency 25、0 errors、p50 23.90ms、p95 73.86ms、p99 84.05ms、max 97.31ms。
- Worker drill：heartbeat 过期后 capability disabled；API health/ready 未关闭；重启后 capability enabled。
- Compose API、Worker、Web、PostgreSQL 在演练结束后均为 healthy。

这些数字只描述当次开发机与合成 fixture，不可外推生产客户数、写吞吐、数据库规格或 SLO 达成。目标 staging/production 还必须覆盖 Session create/send、SSE 连接/撤权、queue backlog、provider 429/timeout、对象存储 5xx、数据库连接耗尽、Worker lease fencing、滚动升级和至少数小时 soak。
