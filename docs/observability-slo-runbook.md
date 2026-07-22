# Observability、SLO 与告警 Runbook

本文定义 Relay 当前可执行的 API 指标、告警路由和处置边界。它不把仓库内规则等同于已部署 dashboard/on-call；目标环境仍须保存 Prometheus/Alertmanager 配置、通知送达和演练证据。

## 指标抓取

API 仅在配置 `METRICS_SCRAPE_TOKEN` 时开放 `GET /api/metrics`。token 必须由 Secret Manager 注入，每个环境独立轮换，长度 32-256 个可见 ASCII 字符；不写入 URL、镜像、Git、日志或指标 label。抓取端使用：

```bash
curl --fail --silent --oauth2-bearer "$METRICS_SCRAPE_TOKEN" https://relay.internal/api/metrics
```

没有配置 token 时端点返回 404；错误 token 返回统一 401。端点只输出：

- `relay_http_requests_total`：固定 HTTP method、Fastify route template 和 status class，禁止 actor/tenant/resource ID label。
- `relay_http_request_duration_ms`：固定延迟桶；聚合器从 bucket 计算 p95/p99。
- `relay_sse_connections_active` / `relay_sse_connections_limit`：当前实例的活跃 SSE 数和配置上限。

这些值是进程内、重启归零的 scrape 指标。Prometheus 必须抓取每个 API replica，并按 `cluster/environment/service/instance/release` 外部标签聚合；不得把单实例 counter 当成全局权威或账单数据。

## SLO 与规则

规则文件为 `ops/observability/relay-alerts.yaml`，部署前执行 `promtool check rules`。当前代码门禁只验证 YAML 结构、必需告警和低基数表达式；目标环境必须再验证 Prometheus 版本兼容、规则加载和至少一次合成通知送达。

- 可用性目标沿用 SLO-01：月度 99.9%。`RelayApiAvailabilityFastBurn` 使用 14.4 倍 error-budget burn（5m + 1h）并要求最低流量，避免空闲实例误报。
- 延迟门禁覆盖控制面混合流量的 p95 500ms 初始阈值；按 cached GET/command route 分拆 SLO 前，不宣称已经满足 SLO-02/SLO-03。
- SSE 容量在单实例 90% 持续 10 分钟时创建 ticket；跨实例连接配额和撤权 p95 仍需负载/故障切片。
- `/api/health` 与 `/api/metrics` 不进入用户请求错误率和延迟计算，目标下线由 `up{job="relay-api"}` 独立告警。

## 通知与升级

部署平台按 `severity` 路由，不在仓库保存 receiver URL、OAuth token、电话或个人地址：

| Severity | 送达目标 | ACK 目标 | 行为 |
| --- | --- | --- | --- |
| `page` | 24x7 primary + secondary on-call | 15 分钟 | 5 分钟内开始通知；无人 ACK 自动升级 Incident Commander |
| `ticket` | 服务 owner 队列 | 1 个工作日 | 分析趋势、容量或发布相关性；达到用户影响时升级 page |

每季度和通知/值班配置变更后运行合成 page：验证 Alertmanager 收到规则、primary/secondary 实际收到、ACK 与升级时间，并在变更系统记录时间、环境、rule、receiver、结果和偏差。记录不得包含 scrape/receiver credential 或客户数据。

## RelayApiTargetDown

1. 从独立探针确认 `/api/health`、Pod/container 状态和最近发布，不用 `/api/ready` 代替 liveness。
2. 若仅 scrape 网络失败，修复 service discovery、NetworkPolicy 或 token rotation；不要为恢复 metrics 放宽公网访问。
3. 若 API 进程不可用，按发布回滚路径处理，并确认 PostgreSQL、IdP 和对象存储是否为共同故障域。

## RelayApiAvailabilityFastBurn

1. 按 `release`、route template、status class 和 instance 分解错误；禁止添加 tenant/resource ID 到持久 metrics label。
2. 检查 PostgreSQL pool/query timeout、OIDC/JWKS、对象存储、provider、共享 quota 和最近 migration/release。
3. 可回滚应用时先停止 canary 扩张；数据问题使用 forward repair/PITR，不执行破坏性 schema rollback。

## RelayApiLatencyP95High

1. 分 route/instance/release 检查延迟桶和流量，区分排队、数据库、外部 provider 与客户端长连接。
2. 查看 DB pool、statement timeout、queue age 和 event/outbox lag；避免通过提高无界 timeout 掩盖饱和。
3. 记录受影响旅程、峰值、持续时间和恢复动作，为后续 route-specific SLO 校准提供证据。

## RelaySseConnectionCapacityHigh

1. 检查 instance 是否负载不均、断线重连风暴或客户端未释放连接，并核对 429 `SSE_CONNECTION_LIMIT_EXCEEDED`。
2. 先恢复负载均衡/客户端 backoff；提高上限前必须有连接内存、file descriptor 和撤权延迟压测证据。
3. 告警恢复后确认活跃 gauge 回落、重连成功且 Session event sequence 无 gap。
