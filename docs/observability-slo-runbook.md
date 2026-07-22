# Observability、SLO 与告警 Runbook

本文定义 Cosmos 当前可执行的 API 指标、告警路由和处置边界。它不把仓库内规则等同于已部署 dashboard/on-call；目标环境仍须保存 Prometheus/Alertmanager 配置、通知送达和演练证据。

## 指标抓取

API 仅在配置 `METRICS_SCRAPE_TOKEN` 时开放 `GET /api/metrics`。token 必须由 Secret Manager 注入，每个环境独立轮换，长度 32-256 个可见 ASCII 字符；不写入 URL、镜像、Git、日志或指标 label。抓取端使用：

```bash
curl --fail --silent --oauth2-bearer "$METRICS_SCRAPE_TOKEN" https://cosmos.internal/api/metrics
```

没有配置 token 时端点返回 404；错误 token 返回统一 401。端点只输出：

- `cosmos_http_requests_total`：固定 HTTP method、Fastify route template 和 status class，禁止 actor/tenant/resource ID label。
- `cosmos_http_request_duration_ms`：固定延迟桶；聚合器从 bucket 计算 p95/p99。
- `cosmos_sse_connections_active` / `cosmos_sse_connections_limit`：当前实例的活跃 SSE 数和配置上限。
- `cosmos_execution_enabled` / `cosmos_worker_execution_ready`：执行开关和基于数据库最新 heartbeat 的 Worker readiness；只在受保护 scrape 时查询，不改变 `/api/ready` 的控制面语义。

这些值是进程内、重启归零的 scrape 指标。Prometheus 必须抓取每个 API replica，并按 `cluster/environment/service/instance/release` 外部标签聚合；不得把单实例 counter 当成全局权威或账单数据。

## 独立数据库运维指标

跨租户 queue、lease、heartbeat 和 Outbox 统计不能由普通 API/Worker tenant role 查询。migration `074_observer_runtime_metrics.sql` 创建 `cosmos_observer_runtime` NOLOGIN、NOINHERIT、NOBYPASSRLS 角色，仅授予状态/时间列的 SELECT；它没有 payload、actor、tenant ID、resource ID 或写权限。部署平台从 Secret Manager 注入 `OBSERVABILITY_DATABASE_URL`，以该角色执行：

```bash
pnpm metrics:database
```

采集器只输出固定低基数系列：命令 `accepted|queued|running`、Environment provisioning `queued|running`、Outbox `session|environment|automation|space`，以及 Worker `fresh|stale`；`OBSERVABILITY_WORKER_FRESHNESS_SECONDS` 默认 30 秒且限制在 5-300 秒。推荐将 stdout 接入独立 Prometheus textfile/sidecar 链路，不把结果转发到 tenant API。采集器查询失败必须让采集任务失败，不输出部分或伪造的零值。

## SLO 与规则

规则文件为 `ops/observability/cosmos-alerts.yaml`，部署前执行 `promtool check rules`。当前代码门禁只验证 YAML 结构、必需告警和低基数表达式；目标环境必须再验证 Prometheus 版本兼容、规则加载和至少一次合成通知送达。

- 可用性目标沿用 SLO-01：月度 99.9%。`CosmosApiAvailabilityFastBurn` 使用 14.4 倍 error-budget burn（5m + 1h）并要求最低流量，避免空闲实例误报。
- 延迟门禁覆盖控制面混合流量的 p95 500ms 初始阈值；按 cached GET/command route 分拆 SLO 前，不宣称已经满足 SLO-02/SLO-03。
- SSE 容量在单实例 90% 持续 10 分钟时创建 ticket；跨实例连接配额和撤权 p95 仍需负载/故障切片。
- `/api/health` 与 `/api/metrics` 不进入用户请求错误率和延迟计算，目标下线由 `up{job="cosmos-api"}` 独立告警。

## 通知与升级

部署平台按 `severity` 路由，不在仓库保存 receiver URL、OAuth token、电话或个人地址：

| Severity | 送达目标 | ACK 目标 | 行为 |
| --- | --- | --- | --- |
| `page` | 24x7 primary + secondary on-call | 15 分钟 | 5 分钟内开始通知；无人 ACK 自动升级 Incident Commander |
| `ticket` | 服务 owner 队列 | 1 个工作日 | 分析趋势、容量或发布相关性；达到用户影响时升级 page |

每季度和通知/值班配置变更后运行合成 page：验证 Alertmanager 收到规则、primary/secondary 实际收到、ACK 与升级时间，并在变更系统记录时间、环境、rule、receiver、结果和偏差。记录不得包含 scrape/receiver credential 或客户数据。

## CosmosApiTargetDown

1. 从独立探针确认 `/api/health`、Pod/container 状态和最近发布，不用 `/api/ready` 代替 liveness。
2. 若仅 scrape 网络失败，修复 service discovery、NetworkPolicy 或 token rotation；不要为恢复 metrics 放宽公网访问。
3. 若 API 进程不可用，按发布回滚路径处理，并确认 PostgreSQL、IdP 和对象存储是否为共同故障域。

## CosmosApiAvailabilityFastBurn

1. 按 `release`、route template、status class 和 instance 分解错误；禁止添加 tenant/resource ID 到持久 metrics label。
2. 检查 PostgreSQL pool/query timeout、OIDC/JWKS、对象存储、provider、共享 quota 和最近 migration/release。
3. 可回滚应用时先停止 canary 扩张；数据问题使用 forward repair/PITR，不执行破坏性 schema rollback。

## CosmosApiLatencyP95High

1. 分 route/instance/release 检查延迟桶和流量，区分排队、数据库、外部 provider 与客户端长连接。
2. 查看 DB pool、statement timeout、queue age 和 event/outbox lag；避免通过提高无界 timeout 掩盖饱和。
3. 记录受影响旅程、峰值、持续时间和恢复动作，为后续 route-specific SLO 校准提供证据。

## CosmosSseConnectionCapacityHigh

1. 检查 instance 是否负载不均、断线重连风暴或客户端未释放连接，并核对 429 `SSE_CONNECTION_LIMIT_EXCEEDED`。
2. 先恢复负载均衡/客户端 backoff；提高上限前必须有连接内存、file descriptor 和撤权延迟压测证据。
3. 告警恢复后确认活跃 gauge 回落、重连成功且 Session event sequence 无 gap。

## CosmosWorkerExecutionUnavailable

1. 确认 API health/ready 仍可用，并检查 Worker container/process、最新 heartbeat、数据库连接和 lease age。
2. 执行关闭时该告警必须静默；执行已启用时不要通过关闭告警规则掩盖 Worker 全部失联。
3. Worker 恢复后确认 capability 重新变为 enabled、新命令可被领取、过期 lease 由 fencing 规则恢复且没有重复外部副作用。

## CosmosCommandQueueAgeHigh

1. 按 active status 区分 accepted、queued、running，检查 Worker poll、数据库连接/锁等待和 lease expiry；不要把 terminal command 历史量当作 backlog。
2. 若 Worker 全部失联，按 `CosmosWorkerExecutionUnavailable` 处理；若仅 queue age 上升，先限制新入口并采集数据库/Worker 现场证据。
3. 恢复后确认 oldest age 回落、command lease/fencing 没有重复副作用，并记录受影响 Session 数量而非写入 metrics label。

## CosmosOutboxLagHigh

1. 按固定 stream 定位 unpublished backlog，检查发布器权限、数据库锁、网络和下游 receiver；禁止读取或打印 payload。
2. 重启/重放必须保持 event ID 幂等，先在隔离批次验证再扩容；不得直接 UPDATE/DELETE append-only ledger。
3. 恢复后确认每个 stream 的 oldest age 和 pending count 回落，并保存不含正文的 event/时间线证据。

## CosmosObserverWorkerHeartbeatStale

1. 核对 observer freshness window、Worker ID 数量和最近发布；stale heartbeat 是运维信号，不等于当前 execution capability，后者以 API gauge 为准。
2. 检查 Worker 容器、数据库连接和 lease；不要通过删除 heartbeat 或放宽 freshness window 掩盖故障。
3. 所有 Worker 恢复 fresh 后确认告警消退，并执行一次 bounded command/Session journey 验证领取链路。
