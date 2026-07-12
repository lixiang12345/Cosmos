# Relay Agent Platform

Relay 是一个面向研发组织的 AI 软件交付编排与治理产品。当前仓库在完整交互原型之上，以共享契约驱动的前后端分离架构实现了带权威配置解析的 Session 创建/读取与 Expert/Environment 只读 Catalog 纵向链路。

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

开发脚本会显式选择仅允许绑定 loopback 的固定本地身份，并开启带 seed 的 demo 模式；生产构建不允许 development 身份，也不会读取 demo Session、Expert 或控制面缓存。生产 Web 使用 OIDC Authorization Code + PKCE，access token 仅驻留 JavaScript 内存，只有一次性授权 state 与 PKCE 数据保存在当前标签页的 `sessionStorage`；401、过期和登出会立即清除身份。需要验证持久化链路时启动本地 PostgreSQL：

```bash
pnpm db:up
DATABASE_URL=postgres://relay:relay-local-only@127.0.0.1:55432/relay pnpm dev:api
TEST_DATABASE_URL=postgres://relay:relay-local-only@127.0.0.1:55432/relay pnpm test:integration
```

开发环境默认自动执行版本化 SQL migration；也可显式运行 `AUTH_MODE=development DATABASE_URL=... pnpm db:migrate`。staging/production 禁止 API 启动时迁移，发布流程必须先以独立 migration job 运行同一镜像的 `node dist/migrate.js`。`/api/health` 是唯一公开的进程存活探针；`/api/ready` 受鉴权保护并真实检查数据库依赖。生产 API 必须显式设置 `NODE_ENV=production`、`AUTH_MODE=oidc`、`DATABASE_URL`、`CORS_ORIGIN`、`OIDC_ISSUER`、`OIDC_AUDIENCE` 和 `OIDC_JWKS_URI`；生产 Web 必须设置 `VITE_AUTH_MODE=oidc` 与 OIDC public-client 配置，Organization/Space 由受鉴权的 `/api/v1/me` membership discovery 返回，缺失身份配置时显示错误而非进入 demo。

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
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions/:sessionId`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/experts`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/experts/:expertId`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/environments`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/environments/:environmentId`
- 创建 Session 使用 `Idempotency-Key`；相同请求可安全重放，不同请求复用同一 key 返回 `409`。
- 创建时只把 `expertId` 和允许的 `advancedOverrides` 作为选择输入；服务端解析当前 Published ExpertRevision、Active/Ready EnvironmentRevision 和 Repository binding，并把不可变 ID 与展示快照固定到 Session。
- `start=true` 在同一 PostgreSQL 事务中写入 Session、首条 Message、Turn、Command、Outbox 和完整幂等响应；返回状态为 `queued`，不冒充 Agent 已执行。
- 单 Session 响应和创建响应返回版本 `ETag`；Web 规范详情路由为 `/sessions/:sessionId`，旧 `/runs/:id` 只做兼容重定向。
- API 成功响应与结构化错误均由 `@relay/contracts` 校验。
- Expert/Environment Catalog 使用 keyset cursor 分页；详情返回资源版本 `ETag`。在真实执行面接通前，生产 Web 只开放查询和从已发布 Expert 保存 Session 草稿，不提供本地假编辑或伪执行。
- `start=false` 会原子持久化 draft Session 与首条 Message，但不会创建 Turn、Command 或 Outbox；用户输入不会被静默丢弃，也不会误入执行队列。

配置 `DATABASE_URL` 后，Expert/Environment identity 与 immutable revision、Repository binding、Session 和幂等记录写入 PostgreSQL；未配置时仅开发环境使用进程内存 repository。API 已实现 OIDC access token 校验、actor membership discovery、Organization/Space 角色交集写限制、Private creator 隔离、权威配置解析、只读 Catalog 和 actor/路径级幂等；Expert/Environment 写 API、Private 分享、RLS/统一 tenant guard、审计、任务队列 consumer 和真实 Agent runtime 尚未实现，因此当前版本仍不能直接暴露到公网。这些能力按 [软件交付计划](./docs/software-delivery-plan.md) 继续演进。

## 原型范围

- Session 管理原型：显式 demo 模式提供活跃、收藏、归档、搜索、重命名、恢复和删除，状态写入隔离的 `relay.demo.sessions`；生产模式不会读取该缓存，也不显示未接 API 的管理动作。
- Session 工作台：demo 模式提供阶段轨道、事件时间线、追加指令、终端回放、文件 Diff 和审批决策；生产模式允许保存草稿并只显示 canonical Session metadata 与权威配置引用，明确标记执行面尚未接通。
- 控制平面：demo 模式包含运行记录、自动化、代码仓库、集成、治理中心和事件日志；生产 capability allowlist 当前仅开放 Sessions、Experts 和 Environments，其他直达路由不渲染模拟操作。
- 关键交互：新建任务、切换证据视图、批准或退回、失败步骤重试、侧栏折叠和移动端抽屉。
- 全局偏好：浅色/深色主题与中文/英文切换，偏好跨页面、跨刷新保持一致。
- 视觉系统：中性 Graphite 基底、受控绿色主色和语义状态色；Lucide 细线图标，4–8px 圆角，无装饰性渐变。
- 响应式：桌面使用紧凑数据表和 Inspector，390px 小屏使用 Session/Run 信息卡与紧凑阶段条。

完整产品与工程蓝图见 [docs/product-blueprint.md](./docs/product-blueprint.md)。
