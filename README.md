# Relay Agent Platform

Relay 是一个面向研发组织的 AI 软件交付编排与治理产品。当前仓库在完整交互原型之上，开始以共享契约驱动的前后端分离架构实现 Session 创建纵向链路。

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

API 使用版本化 SQL migration 自动升级数据库；也可显式运行 `DATABASE_URL=... pnpm db:migrate`。`/api/health` 是唯一公开的进程存活探针；`/api/ready` 受鉴权保护并真实检查数据库依赖。生产 API 必须显式设置 `AUTH_MODE=oidc`、`DATABASE_URL`、`CORS_ORIGIN`、`OIDC_ISSUER`、`OIDC_AUDIENCE` 和 `OIDC_JWKS_URI`；生产 Web 必须设置 `VITE_AUTH_MODE=oidc`、Organization、Space 与 OIDC public-client 配置，缺失时显示配置错误而非进入 demo。

质量检查：

```bash
pnpm check
```

也可单独执行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 或 `pnpm build`。根命令会先构建 `@relay/contracts`，确保 API 与 Web 使用同一份生成类型。

## 当前后端范围

- `GET /api/health`
- `GET /api/ready`（需鉴权）
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- 创建 Session 使用 `Idempotency-Key`；相同请求可安全重放，不同请求复用同一 key 返回 `409`。
- `start=true` 在同一 PostgreSQL 事务中写入 Session、首条 Message、Turn、Command、Outbox 和完整幂等响应；返回状态为 `queued`，不冒充 Agent 已执行。
- API 成功响应与结构化错误均由 `@relay/contracts` 校验。

配置 `DATABASE_URL` 后，Session 与幂等记录写入 PostgreSQL；未配置时仅开发环境使用进程内存 repository。API 已实现 OIDC access token 校验、Organization/Space membership、viewer 写限制、Private Session creator 隔离和 actor/Space 级幂等；Private 分享、RLS/统一 tenant guard、审计、任务队列和真实 Agent runtime 尚未实现，因此当前版本仍不能直接暴露到公网。这些能力按 [软件交付计划](./docs/software-delivery-plan.md) 继续演进。

## 原型范围

- Session 管理原型：显式 demo 模式提供活跃、收藏、归档、搜索、重命名、恢复和删除，状态写入隔离的 `relay.demo.sessions`；生产模式不会读取该缓存。
- Run 工作台：阶段轨道、事件时间线、追加指令、终端回放、文件 Diff、审批决策。
- 控制平面：运行记录、自动化、专家库、代码仓库、集成、治理中心和事件日志。
- 关键交互：新建任务、切换证据视图、批准或退回、失败步骤重试、侧栏折叠和移动端抽屉。
- 全局偏好：浅色/深色主题与中文/英文切换，偏好跨页面、跨刷新保持一致。
- 视觉系统：中性 Graphite 基底、受控绿色主色和语义状态色；Lucide 细线图标，4–8px 圆角，无装饰性渐变。
- 响应式：桌面使用紧凑数据表和 Inspector，390px 小屏使用 Session/Run 信息卡与紧凑阶段条。

完整产品与工程蓝图见 [docs/product-blueprint.md](./docs/product-blueprint.md)。
