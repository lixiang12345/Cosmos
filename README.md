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

`pnpm dev` 启动完整 Docker Compose runtime（PostgreSQL、API、Worker、Web），访问：

- Web：<http://127.0.0.1:5173>
- API 健康检查：<http://127.0.0.1:8787/api/health>

Compose 会等待 PostgreSQL 健康后启动 API，API 完成 migration 后才启动 Worker 和 Web；Web 通过 nginx 将同源 `/api/*` 反向代理到 API。Worker 所需的 Provider、Context Engine 等敏感配置从未提交的 `.env.local` 注入，不会进入浏览器构建产物。首次使用可从 `.env.example` 复制并填写 Provider 配置；没有 Provider 凭据时 Worker 会保持失败并由健康检查标记为不可用，但 API 控制面仍可访问。

只想运行带 seed 数据的前端原型时，显式使用 `pnpm dev:demo`；该模式不代表真实 PostgreSQL/Worker 运行态。也可以分别运行 `pnpm dev:web` 和 `pnpm dev:api`；如需连接跨域 HTTPS API，同时设置 `VITE_API_BASE_URL` 和逗号分隔的 `VITE_API_ALLOWED_ORIGINS`，否则浏览器会在发送 Bearer token 前拒绝请求。

如果默认 API 端口被占用，可同时覆盖 API 监听端口和 Vite 的开发代理目标：

```bash
PORT=8790 VITE_API_PROXY_TARGET=http://127.0.0.1:8790 pnpm dev
```

`pnpm dev:demo` 会显式选择仅允许绑定 loopback 的固定本地身份并开启带 seed 的 demo 模式；Compose runtime 仅在本地 development 环境通过 `ALLOW_NON_LOOPBACK_DEVELOPMENT_AUTH=true` 允许容器内 API 监听 `0.0.0.0`，Web production bundle 也必须显式设置 `VITE_ALLOW_PRODUCTION_DEVELOPMENT_AUTH=true` 且只能从 loopback origin 运行。其他环境仍拒绝 development auth，production bundle 始终拒绝 demo 模式。生产 Web 使用 OIDC Authorization Code + PKCE，access token 仅驻留 JavaScript 内存，只有一次性授权 state 与 PKCE 数据保存在当前标签页的 `sessionStorage`；401、过期和登出会立即清除身份。API 拒绝生命周期超过 300 秒的 access token，把无法即时 introspect 的 JWT 撤销残余窗口硬限制为 5 分钟；接入支持 introspection 或 `jti` denylist 的企业 IdP 后可进一步缩短。需要仅验证本地 PostgreSQL 时启动：

```bash
pnpm db:up
DATABASE_URL=postgres://relay:relay-local-only@127.0.0.1:55432/relay pnpm dev:api
TEST_DATABASE_URL=postgres://relay:relay-local-only@127.0.0.1:55432/relay pnpm test:integration
```

开发环境默认自动执行版本化 SQL migration；也可显式运行 `AUTH_MODE=development DATABASE_URL=... pnpm db:migrate`。staging/production 禁止 API 启动时迁移，发布流程必须先以独立 migration job 运行同一镜像的 `node dist/migrate.js`。migration 身份必须拥有目标 schema 及创建/加固 `relay_api_runtime`、`relay_worker_runtime` NOLOGIN 角色所需的 `CREATEROLE`；API/Worker 登录身份只授予对应角色 membership，不能拥有表 ownership、superuser 或 `BYPASSRLS`。运行进程会 `SET ROLE` 并在启动时验证实际 `current_user`，角色或 migration 不正确时 fail closed。`/api/health` 是唯一公开的进程存活探针；`/api/ready` 受鉴权保护并检查 API 的 PostgreSQL 与 migration 依赖，但不会因执行 Worker 下线而关闭只读控制面。内部 `/api/metrics` 仅在配置 Secret Manager 注入的 `METRICS_SCRAPE_TOKEN` 时开放，输出低基数 HTTP/SSE 指标；规则与通知处置见 [Observability、SLO 与告警 Runbook](./docs/observability-slo-runbook.md)。生产 API 必须显式设置 `NODE_ENV=production`、`AUTH_MODE=oidc`、`DATABASE_URL`、`CORS_ORIGIN`、`OIDC_ISSUER`、`OIDC_AUDIENCE`、`OIDC_JWKS_URI` 和来自 Secret Manager 的 `SECURITY_AUDIT_HMAC_KEY`；生产 Web 必须设置 `VITE_AUTH_MODE=oidc` 与 OIDC public-client 配置，Organization/Space 由受鉴权的 `/api/v1/me` membership discovery 返回，缺失身份配置时显示错误而非进入 demo。

`SECURITY_AUDIT_HMAC_KEY` 必须配套稳定、非 Secret 的 `SECURITY_AUDIT_HMAC_KEY_ID`，轮换时先发布新 ID/key，再按保留策略保管旧 key 以便合规关联。migration job 只需要数据库连接与超时配置，不接收 OIDC、provider 或安全审计 HMAC 凭据；API readiness 会同时拒绝 pending 与未知 migration 历史，避免静默接受已改名或缺失的 schema 版本。

要运行 protocol-1 基础对话 Worker，还需配置 `.env.example` 中的 Worker 与 OpenAI-compatible provider 变量，并在 migration 完成后启动独立进程：

要启用代码库上下文检索，可部署 [ContextEngine-plugin](https://github.com/lixiang12345/ContextEngine-plugin) 作为内网服务，并在 API 侧成组配置 `CONTEXT_ENGINE_BASE_URL`、`CONTEXT_ENGINE_API_KEY`、`CONTEXT_ENGINE_WORKSPACES_JSON` 和可选的 `CONTEXT_ENGINE_TIMEOUT_MS`。Compose 中访问宿主机插件可使用 `http://host.docker.internal:8790`，并仅在本地 `.env.local` 设置 `CONTEXT_ENGINE_ALLOW_INSECURE_HTTP=true`；staging/production 始终要求 HTTPS。浏览器只访问 Relay 的 `/api/v1/organizations/:organizationId/spaces/:spaceId/context-engine/*` 代理，不接触插件密钥。Relay 会先验证当前 Space 的 active Environment revision 是否绑定请求仓库，再允许状态查询、混合检索和上下文打包；Home 启动器可在真实部署中预检证据，用户确认后才将其以“非可信仓库证据”附加到 Session 首条消息。

```bash
pnpm --filter @relay/api build
pnpm --filter @relay/api start:worker
```

生产必须为每个 Worker 设置唯一且稳定的 `WORKER_ID`，并从 Secret Manager 注入 `AGENT_PROVIDER_GPT_API_KEY`、`AGENT_PROVIDER_CLAUDE_API_KEY` 和 `AGENT_PROVIDER_GROK_API_KEY`，不能使用 `.env.example` 的本地占位值；`AGENT_PROVIDER_API_KEY` 仅保留为单密钥兼容回退。Worker 只接受共享目录中的五个模型，并按模型族选择凭据。Worker 会周期性写 PostgreSQL 心跳，容器 `HEALTHCHECK` 通过 `dist/worker-health.js` 核验当前 `WORKER_ID` 的新鲜心跳。API 只有在 `EXECUTION_ENABLED=true` 且至少一个 Worker 的心跳未超过 `WORKER_READINESS_MAX_AGE_MS` 时才向 Web 宣告执行能力并接受新的 `start=true` 或后续消息；既有成功请求仍可按相同 `Idempotency-Key` 重放。Worker 下线时 Web 仍可读取控制面并保存 draft，不把未运行的 Session 表示成执行成功。

当前模型目录固定为 `gpt-5.6-sol`、`claude-fable-5`、`claude-opus-4-8`、`claude-sonnet-5` 和 `grok-4.5`。目录由 `@relay/contracts` 共享给 Expert 编辑器与 Worker；不在目录中的 pinned model 会在任何 Provider 网络请求之前失败关闭。

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

API 与 Web 运行镜像均使用非 root 用户并包含健康检查。Web 容器在启动时把同源 `/api/*` 反向代理到 `RELAY_API_UPSTREAM`（默认 `http://api:8787`）；部署时必须按服务发现地址覆盖该变量，并用 `RELAY_CSP_CONNECT_SRC`、`RELAY_CSP_FRAME_SRC` 明确列出 IdP/API 所需 HTTPS origin，例如 `RELAY_CSP_CONNECT_SRC="'self' https://identity.example.com"`。TLS、WAF、全局限流和镜像签名仍由生产 Edge/IaC 落地。API 默认把数据库连接、客户端查询和 PostgreSQL statement 超时分别限制为 5s/20s/15s，并启用每实例有界限流、安全响应头和 1 MiB body 边界；只有显式列入 `TRUST_PROXY` 的 IP/CIDR 才能影响客户端地址。所有边界都可通过 `.env.example` 中的变量收紧但不能禁用。

质量检查：

```bash
pnpm check
pnpm openapi:lint
pnpm openapi:bundle
```

也可单独执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:ops` 或 `pnpm build`。根命令会先构建 `@relay/contracts`，确保 API 与 Web 使用同一份生成类型。Pull Request 和主分支推送必须通过 `.github/workflows/required-checks.yml`：Node 22 + pnpm 11.7.0 冻结锁文件安装、生产依赖审计、全量检查、PostgreSQL 17 集成测试、OpenAPI lint/bundle、带 checksum 和 release/RLS/ACL/数据约束验证的逻辑备份与隔离恢复、连续 WAL 归档 live preflight、生产 migration/API/Web 容器与同源代理 smoke、CycloneDX SBOM、HIGH/CRITICAL 镜像扫描、空白错误检查和脱敏 Secret 扫描。生产恢复边界与季度演练步骤见 [PostgreSQL 备份与恢复 Runbook](./docs/postgres-recovery-runbook.md)；有界负载、Session journey 与依赖故障步骤见 [Load/Soak 与依赖故障演练 Runbook](./docs/load-failure-runbook.md)。

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
- `PATCH /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/{archive|restore|pause|resume|cancel}`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/turns/:turnId/retry`
- `GET|POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/shares`
- `DELETE /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId/shares/:shareId`
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
- 当前 Agent provider 可产出受大小限制的对话 Message，或调用 `workspace_files_list` / `workspace_file_read` 两个严格参数、单次 64 KiB 上限的只读工具；Worker 在同一租约内以最多 8 轮的模型续接执行，并把每次调用写入 ToolCall/Event/Audit。provider endpoint 的 301/302/303/307/308 重定向不会被跟随，并按终止型配置错误处理。SessionEvent 以单调 sequence 持久化，并可通过 cursor 分页或 `Last-Event-ID` 恢复 SSE。SSE heartbeat 会重新认证；每轮/每批 timeline 查询都会重检当前 membership、ShareGrant 和 Group membership，撤权后在下一次检查关闭连接。

配置 `DATABASE_URL` 后，Expert/Environment identity 与 immutable revision、Repository binding、Session、Attempt、SessionWorker、ToolCall/Approval/SideEffect、Artifact 引用、三作用域 File/FileVersion、事件和幂等记录写入 PostgreSQL；未配置时仅开发环境使用进程内存 repository。API 已实现 OIDC、membership discovery、User/Group ShareGrant、ServiceAccount exact create/send/archive binding、完整 Session 生命周期命令、Artifact 管理、Session Worker tree、ToolCall 查询、Approval 查询/决策、只读 File 浏览/版本/内容下载、复合 tenant FK 和 tenant FORCE RLS；API/Worker 使用分离的受限数据库角色。所有共享 API 错误响应通过独立事务写入只允许 API INSERT 的 append-only 安全账本，actor、tenant、target、IP、UA 与 Idempotency-Key 仅保存 keyed HMAC 指纹，生产 HMAC key 必须由 Secret Manager 注入。Organization API quota 与 PostgreSQL shared rate-limit window 已成为跨实例权威；FileVersion 单版本限制 1 MiB、单 Organization 默认写入配额 100 MiB，支持带 SHA-256 校验的 S3-compatible object backend 与 inline 历史兼容；Worker 内部 repository 原子推进父子执行状态、写不可变文件版本、精确 input hash 审批、双人批准、外部副作用状态和脱敏 Event/Audit/Outbox。对话 provider 已接入一个仅开放 Session Workspace 文件列举/文本读取的受控 Tool Broker；文件写入、外部写工具与 Shell 均未向模型开放。Expert/Environment 写 API、合规访问、coding sandbox、审批后的模型写工具、生产 bucket/IAM/retention、PITR/远端备份以及负载证据仍未完成，因此当前版本仍不能直接暴露到公网。这些能力按 [软件交付计划](./docs/software-delivery-plan.md) 继续演进。

## 原型范围

- Session 管理：显式 demo 模式提供活跃、收藏、归档、搜索、重命名、恢复和删除，状态写入隔离的 `relay.demo.sessions`；生产模式不会读取该缓存，列表使用服务端 cursor 分页，并开放带 CAS/幂等保护的重命名、归档和恢复。收藏与删除仍只在 demo 模式显示。
- Session 工作台：demo 模式提供阶段轨道、事件时间线、追加指令、终端回放、文件 Diff 和审批决策；生产模式显示 canonical Session metadata、Message、Attempt/Session/ToolCall/Approval 事件与真实执行终态，并在执行能力可用时通过幂等 API 发送后续消息。Conversation、Session Workspace Files 与 Worker tree 使用精确 Session scope 的权威页面；Workspace 文件可带安全的预填消息返回对应 Session 请求修改，不把路径或草稿写入 URL。独立 Tool、Terminal 和 Changes 操作尚未服务化，不会冒充生产事实。
- 控制平面：demo 模式包含运行记录、自动化、代码仓库、集成、治理中心和事件日志；生产 capability allowlist 当前开放 Sessions、Approvals、Experts、Environments 和只读 Files，其他直达路由不渲染模拟操作。
- 关键交互：新建任务、切换证据视图、批准或退回、失败步骤重试、侧栏折叠和移动端抽屉。
- 全局偏好：浅色/深色主题与中文/英文切换，偏好跨页面、跨刷新保持一致。
- 视觉系统：中性 Graphite 基底、受控绿色主色和语义状态色；Lucide 细线图标，4–8px 圆角，无装饰性渐变。
- 响应式：桌面使用紧凑数据表和 Inspector，390px 小屏使用 Session/Run 信息卡与紧凑阶段条。

完整产品与工程蓝图见 [docs/product-blueprint.md](./docs/product-blueprint.md)。下一条垂直切片、当前真实缺口和固定交付/推送流程见 [docs/next-delivery-plan.md](./docs/next-delivery-plan.md)。
