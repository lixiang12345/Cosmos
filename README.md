# Relay Agent Platform

Relay 是一个面向研发组织的 AI 软件交付编排与治理产品。当前仓库在完整交互原型之上，以共享契约驱动的前后端分离架构实现了权威 Session、Expert/Environment 只读 Catalog，以及可恢复的基础对话执行纵向链路。

## 工程结构

```text
apps/
  web/          React + Vite 前端
  api/          Fastify + TypeScript API
packages/
  contracts/    前后端共享的 Zod DTO 与运行时校验
docs/           产品、前端、后端、API 契约和交付计划
```

## 本地运行

```bash
pnpm install
pnpm dev
```

启动后访问：

- Web：<http://127.0.0.1:5173>
- API 健康检查：<http://127.0.0.1:8787/api/health>

Vite 会把浏览器发往 `/api` 的请求代理到本地 API。也可以分别运行 `pnpm dev:web` 和 `pnpm dev:api`；如需连接跨域 HTTPS API，同时设置 `VITE_API_BASE_URL` 和逗号分隔的 `VITE_API_ALLOWED_ORIGINS`，否则浏览器会在发送 Bearer token 前拒绝请求。

如果默认 API 端口被占用，可同时覆盖 API 监听端口和 Vite 的开发代理目标：

```bash
PORT=8790 VITE_API_PROXY_TARGET=http://127.0.0.1:8790 pnpm dev
```

开发脚本会显式选择仅允许绑定 loopback 的固定本地身份，并开启带 seed 的 demo 模式；生产构建不允许 development 身份，也不会读取 demo Session、Expert 或控制面缓存。生产 Web 使用 OIDC Authorization Code + PKCE，access token 仅驻留 JavaScript 内存，只有一次性授权 state 与 PKCE 数据保存在当前标签页的 `sessionStorage`；401、过期和登出会立即清除身份。API 拒绝生命周期超过 300 秒的 access token，把无法即时 introspect 的 JWT 撤销残余窗口硬限制为 5 分钟；接入支持 introspection 或 `jti` denylist 的企业 IdP 后可进一步缩短。需要验证持久化链路时启动本地 PostgreSQL：

```bash
pnpm db:up
DATABASE_URL=postgres://relay:relay-local-only@127.0.0.1:55432/relay pnpm dev:api
TEST_DATABASE_URL=postgres://relay:relay-local-only@127.0.0.1:55432/relay pnpm test:integration
```

开发环境默认自动执行版本化 SQL migration；也可显式运行 `AUTH_MODE=development DATABASE_URL=... pnpm db:migrate`。staging/production 禁止 API 启动时迁移，发布流程必须先以独立 migration job 运行同一镜像的 `node dist/migrate.js`。`/api/health` 是唯一公开的进程存活探针；`/api/ready` 受鉴权保护并检查 API 的 PostgreSQL 与 migration 依赖，但不会因执行 Worker 下线而关闭只读控制面。生产 API 必须显式设置 `NODE_ENV=production`、`AUTH_MODE=oidc`、`DATABASE_URL`、`CORS_ORIGIN`、`OIDC_ISSUER`、`OIDC_AUDIENCE` 和 `OIDC_JWKS_URI`；生产 Web 必须设置 `VITE_AUTH_MODE=oidc` 与 OIDC public-client 配置，Organization/Space 由受鉴权的 `/api/v1/me` membership discovery 返回，缺失身份配置时显示错误而非进入 demo。

要运行 protocol-1 基础对话 Worker，还需配置 `.env.example` 中的 Worker 与 OpenAI-compatible provider 变量，并在 migration 完成后启动独立进程：

```bash
pnpm --filter @relay/api build
pnpm --filter @relay/api start:worker
```

生产必须为每个 Worker 设置唯一且稳定的 `WORKER_ID`，并从 Secret Manager 注入 `AGENT_PROVIDER_API_KEY`，不能使用 `.env.example` 的本地占位值。Worker 会周期性写 PostgreSQL 心跳，容器 `HEALTHCHECK` 通过 `dist/worker-health.js` 核验当前 `WORKER_ID` 的新鲜心跳。API 只有在 `EXECUTION_ENABLED=true` 且至少一个 Worker 的心跳未超过 `WORKER_READINESS_MAX_AGE_MS` 时才向 Web 宣告执行能力并接受新的 `start=true` 或后续消息；既有成功请求仍可按相同 `Idempotency-Key` 重放。Worker 下线时 Web 仍可读取控制面并保存 draft，不把未运行的 Session 表示成执行成功。

生产容器从仓库根目录构建：

```bash
docker build -f apps/api/Dockerfile -t relay-api .
docker build -f apps/web/Dockerfile -t relay-web \
  --build-arg VITE_OIDC_AUTHORITY=https://identity.example.com/ \
  --build-arg VITE_OIDC_CLIENT_ID=relay-web \
  --build-arg VITE_OIDC_AUDIENCE=relay-api \
  --build-arg VITE_OIDC_REDIRECT_URI=https://relay.example.com/auth/callback \
  --build-arg VITE_OIDC_POST_LOGOUT_REDIRECT_URI=https://relay.example.com/ \
  --build-arg VITE_OIDC_SILENT_REDIRECT_URI=https://relay.example.com/auth/silent-callback .
```

API 与 Web 运行镜像均使用非 root 用户并包含健康检查。Web 容器在启动时把同源 `/api/*` 反向代理到 `RELAY_API_UPSTREAM`（默认 `http://api:8787`）；部署时必须按服务发现地址覆盖该变量，并用 `RELAY_CSP_CONNECT_SRC`、`RELAY_CSP_FRAME_SRC` 明确列出 IdP/API 所需 HTTPS origin，例如 `RELAY_CSP_CONNECT_SRC="'self' https://identity.example.com"`。TLS、WAF、镜像签名仍由生产 Edge/IaC 落地。API 默认把数据库连接、客户端查询和 PostgreSQL statement 超时分别限制为 5s/20s/15s，可通过 `.env.example` 中的变量收紧但不能禁用。

质量检查：

```bash
pnpm check
pnpm openapi:lint
pnpm openapi:bundle
```

也可单独执行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 或 `pnpm build`。根命令会先构建 `@relay/contracts`，确保 API 与 Web 使用同一份生成类型。Pull Request 和主分支推送必须通过 `.github/workflows/required-checks.yml`：Node 22 + pnpm 11.7.0 冻结锁文件安装、全量检查、PostgreSQL 17 集成测试、OpenAPI lint/bundle、生产 migration/API/Web 容器与同源代理 smoke、空白错误检查和脱敏 Secret 扫描。

## 当前后端范围

- `GET /api/health`
- `GET /api/ready`（需鉴权）
- `GET /api/v1/me`（当前 actor 及可访问的 Organization/Space membership）
- `GET /api/v1/capabilities`（当前部署可用的运行时能力）
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/messages`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/events`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/events/stream`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/start`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/messages`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/experts`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/experts/:expertId`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/environments`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/environments/:environmentId`
- 创建、draft start 和后续消息使用 `Idempotency-Key`；相同请求可安全重放，不同请求复用同一 key 返回 `409`。
- 创建时只把 `expertId` 和允许的 `advancedOverrides` 作为选择输入；服务端解析当前 Published ExpertRevision、Active/Ready EnvironmentRevision 和 Repository binding，并把不可变 ID 与展示快照固定到 Session。
- `start=true` 在同一 PostgreSQL 事务中写入 Session、首条 Message、Turn、Command、Outbox、连续 SessionEvent、脱敏 create success AuditEvent 和完整幂等响应；返回状态为 `queued`，不冒充 Agent 已执行。相同 key 重放不重复领域或审计事实。
- 单 Session 响应和创建响应返回版本 `ETag`；Web 规范详情路由为 `/sessions/:sessionId`，旧 `/runs/:id` 只做兼容重定向。
- API 成功响应与结构化错误均由 `@relay/contracts` 校验。
- Expert/Environment Catalog 使用 keyset cursor 分页；详情返回资源版本 `ETag`。生产 Web 只使用服务端 Published Expert 启动或保存 Session；当部署未显式开启基础执行时仅保存 draft，不提供本地假编辑或伪执行。
- `start=false` 会原子持久化 draft Session、首条 Message、2 条连续 SessionEvent 与 1 条脱敏成功审计，但不会创建 Turn、Command 或 Outbox；用户输入不会被静默丢弃，也不会误入执行队列。
- draft start 要求 `If-Match` 和 `Idempotency-Key`，复用已保存的首条 Message，并在单一事务中把 Session 更新为 `queued`、创建首个 Turn/Command/Outbox、追加连续 SessionEvent 与脱敏 AuditEvent；不会重复 Message 或执行事实。
- 后续消息在 Session 行锁内分配连续 Message sequence 与 Turn ordinal，并原子写 `session.send` Command、Outbox、连续 SessionEvent、脱敏 AuditEvent 和幂等响应。`active|waiting` 保持当前状态，`paused` 保持暂停，`completed|failed` 重新进入 `queued`；draft 必须先 start，canceled 不可继续。Worker 在前一 Turn 终止前不会领取后续 Turn，当前 Turn 结束且仍有队列时 Session 回到 `queued`。
- protocol-1 Worker 使用 PostgreSQL 并发 claim、数据库权威租约、heartbeat、fencing、有限重试和过期租约恢复；每个进程另写可过期的就绪心跳，API 以此动态关闭新执行入口而不影响只读控制面；每次 Attempt 保留历史，撤销写权限会取消尚未开始或正在运行的链路。
- 当前 Agent provider 只产出受大小限制的对话 Message；provider endpoint 的 301/302/303/307/308 重定向不会被跟随，并按终止型配置错误处理。SessionEvent 以单调 sequence 持久化，并可通过 cursor 分页或 `Last-Event-ID` 恢复 SSE。SSE 心跳期间会重新认证并重检 membership。

配置 `DATABASE_URL` 后，Expert/Environment identity 与 immutable revision、Repository binding、Session、Attempt、事件和幂等记录写入 PostgreSQL；未配置时仅开发环境使用进程内存 repository。API 已实现 OIDC access token 校验、actor membership discovery、Organization/Space 角色交集写限制、ServiceAccount Session fail-closed、Private creator 隔离、权威配置解析、只读 Catalog、actor/路径级幂等、Session 子表复合 tenant FK、Session 重命名/归档/恢复、基础对话 Worker 和可恢复 timeline。Expert/Environment 写 API、Private 分享、FORCE RLS/受限 runtime role、拒绝与失败审计、coding sandbox、Tool Broker、附件对象存储和生产运维证据仍未实现，因此当前版本仍不能直接暴露到公网。这些能力按 [软件交付计划](./docs/software-delivery-plan.md) 继续演进。

## 原型范围

- Session 管理：显式 demo 模式提供活跃、收藏、归档、搜索、重命名、恢复和删除，状态写入隔离的 `relay.demo.sessions`；生产模式不会读取该缓存，列表使用服务端 cursor 分页，并开放带 CAS/幂等保护的重命名、归档和恢复。收藏与删除仍只在 demo 模式显示。
- Session 工作台：demo 模式提供阶段轨道、事件时间线、追加指令、终端回放、文件 Diff 和审批决策；生产模式显示 canonical Session metadata、Message、Attempt/Session 事件与真实执行终态，并在执行能力可用时通过幂等 API 发送后续消息。尚未服务化的 Tool、Terminal、Files、Changes 和审批操作不会冒充生产事实。
- 控制平面：demo 模式包含运行记录、自动化、代码仓库、集成、治理中心和事件日志；生产 capability allowlist 当前仅开放 Sessions、Experts 和 Environments，其他直达路由不渲染模拟操作。
- 关键交互：新建任务、切换证据视图、批准或退回、失败步骤重试、侧栏折叠和移动端抽屉。
- 全局偏好：浅色/深色主题与中文/英文切换，偏好跨页面、跨刷新保持一致。
- 视觉系统：中性 Graphite 基底、受控绿色主色和语义状态色；Lucide 细线图标，4–8px 圆角，无装饰性渐变。
- 响应式：桌面使用紧凑数据表和 Inspector，390px 小屏使用 Session/Run 信息卡与紧凑阶段条。

完整产品与工程蓝图见 [docs/product-blueprint.md](./docs/product-blueprint.md)。
