# Approval 门控 Webhook 工具 Runbook

## 目的与边界

`approved_webhook_delivery` 是生产 Worker 的可选高风险工具，用于向运维方预先配置的 HTTPS receiver 发送一个最小验证事件。它证明 Provider ToolCall、独立人类 Approval、精确 input hash、幂等外部写和 SideEffect ledger 可以形成真实执行链路，但不提供任意 HTTP client、Shell、代码写入或 Secret 读取。

工具未完整配置时不会出现在 Provider catalog。模型只能提交 `label`，格式为 1–64 位 `[A-Za-z0-9._:-]`；目的地、认证、Header 和 JSON 结构全部由 Worker 固定。浏览器和 Session 消息永远不接触 receiver credential。

## 服务端配置

以下三项必须由部署平台的 Secret Manager / runtime configuration 同时注入：

- `APPROVED_WEBHOOK_URL`：固定 HTTPS URL；拒绝 userinfo、query 和 fragment。
- `APPROVED_WEBHOOK_BEARER_TOKEN`：16–4096 个非空白字符的 receiver credential。
- `APPROVED_WEBHOOK_APPROVER_IDS`：1–20 个逗号分隔的独立人类 actor ID；请求者不能在其中。

可选有界参数：

- `APPROVED_WEBHOOK_APPROVAL_TTL_MS`：默认 600000，范围 60000–3600000。
- `APPROVED_WEBHOOK_REQUEST_TIMEOUT_MS`：默认 10000，范围 100–60000。

任何 authority 字段缺失、URL 非 HTTPS、URL 携带 credential/query/fragment、Token 过短、approver 重复或 ID 不安全都会让 Worker 启动 fail-closed。不要把这些值写入 `.env.example`、Compose、镜像、URL、日志、截图或 Git。

## Receiver contract

Worker 固定发送：

```http
POST <APPROVED_WEBHOOK_URL>
Authorization: Bearer <server-side value>
Content-Type: application/json
Idempotency-Key: <attempt + provider tool call fence>
X-Cosmos-Event: approved_webhook_delivery
```

```json
{"type":"cosmos.approved_webhook_delivery","label":"staging-smoke-20260727"}
```

Receiver 必须按 `Idempotency-Key` 去重，并且响应正文不得作为 Cosmos 结果或日志输入。Worker 只使用 HTTP status：

- `2xx`：SideEffect `succeeded`，ToolCall 可完成。
- `4xx`：SideEffect `failed`，ToolCall 失败但结果确定。
- `3xx`、`5xx`、网络错误或 timeout：SideEffect `unknown`，Session fail-closed，运维方必须先按 receiver idempotency ledger 对账，不能盲目重放。

## 执行与审批

1. 使用隔离 Organization / Space 和非 approver 请求者创建真实 Provider Session。
2. 要求 Expert 调用 `approved_webhook_delivery`，只传非敏感 label。
3. Worker 创建 high-risk ToolCall 与 pending Approval；Attempt / Turn / Session 进入 waiting，Command lease 继续心跳。
4. 指定 reviewer 在 `/approvals` 核对 action、reasons、label、requester、expiry 和 receiver 变更窗口。
5. reviewer 选择 approve / reject；请求者自批、viewer、非成员或重复决定均被拒绝。
6. approve 后同一 ToolCall 变回 queued，Worker 校验 Approval 的 exact input hash，再准备 SideEffect 并发送一次 POST。
7. 通过 Session timeline、ToolCall、Approval、SideEffect、AuditEvent、Outbox 和 receiver idempotency ledger 交叉核验；随后创建不含 Secret 的 `test_report` Artifact。

无人决定时，Worker 到期将 Approval 标为 expired、ToolCall 标为 canceled，并恢复父执行；新 Worker 每轮先清理已到期 Approval，再执行 lease recovery，避免进程崩溃留下永久 waiting。拒绝和过期绝不发送 HTTP 请求。

## Staging 验证清单

- [ ] 镜像 digest、migration job 和 Worker runtime config 已记录；不记录 Secret value。
- [ ] requester 与 reviewer 是两个真实、短期 OIDC 身份，均位于隔离 tenant。
- [ ] approve：receiver 仅收到一次，SideEffect / ToolCall succeeded，Session completed。
- [ ] reject：receiver 收到零次，Approval rejected，ToolCall canceled，Session 给出安全结果。
- [ ] expiry：receiver 收到零次，Approval expired，父执行恢复，事件与审计连续。
- [ ] 4xx：SideEffect failed，结果不标成功。
- [ ] 5xx / timeout：SideEffect unknown，Session fail-closed；对账后再决定人工恢复。
- [ ] 相同 receiver idempotency key 不产生重复副作用。
- [ ] Artifact 只记录聚合结果、status、时间与 commit，不包含 URL、Token、响应正文或客户数据。

本地 mock client、loopback receiver 或数据库 fixture 只能作为代码/运行态证据，不能替代受控 Staging 的外部 receiver、OIDC 和 Secret Manager 证据。
