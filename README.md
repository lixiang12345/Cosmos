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

Vite 会把浏览器发往 `/api` 的请求代理到本地 API。也可以分别运行 `pnpm dev:web` 和 `pnpm dev:api`；如需连接其他 API，设置前端环境变量 `VITE_API_BASE_URL`。

如果默认 API 端口被占用，可同时覆盖 API 监听端口和 Vite 的开发代理目标：

```bash
PORT=8790 VITE_API_PROXY_TARGET=http://127.0.0.1:8790 pnpm dev
```

质量检查：

```bash
pnpm check
```

也可单独执行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 或 `pnpm build`。根命令会先构建 `@relay/contracts`，确保 API 与 Web 使用同一份生成类型。

## 当前后端范围

- `GET /api/health`
- `GET /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- `POST /api/v1/organizations/:organizationId/spaces/:spaceId/sessions`
- 创建 Session 使用 `Idempotency-Key`；相同请求可安全重放，不同请求复用同一 key 返回 `409`。
- API 成功响应与结构化错误均由 `@relay/contracts` 校验。

当前 Session repository 是进程内存实现，仅用于打通首条纵向链路；API 重启后数据会丢失，也尚未实现鉴权、PostgreSQL、任务队列和真实 Agent runtime。这些能力按 [软件交付计划](./docs/software-delivery-plan.md) 继续演进。

## 原型范围

- Session 管理：活跃、收藏、归档视图，搜索与状态筛选，重命名、收藏、归档、恢复和删除；状态写入 `localStorage`，刷新后保留。
- Run 工作台：阶段轨道、事件时间线、追加指令、终端回放、文件 Diff、审批决策。
- 控制平面：运行记录、自动化、专家库、代码仓库、集成、治理中心和事件日志。
- 关键交互：新建任务、切换证据视图、批准或退回、失败步骤重试、侧栏折叠和移动端抽屉。
- 全局偏好：浅色/深色主题与中文/英文切换，偏好跨页面、跨刷新保持一致。
- 视觉系统：中性 Graphite 基底、受控绿色主色和语义状态色；Lucide 细线图标，4–8px 圆角，无装饰性渐变。
- 响应式：桌面使用紧凑数据表和 Inspector，390px 小屏使用 Session/Run 信息卡与紧凑阶段条。

完整产品与工程蓝图见 [docs/product-blueprint.md](./docs/product-blueprint.md)。
