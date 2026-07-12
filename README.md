# Relay Agent Platform Prototype

Relay 是一个面向研发组织的 AI 软件交付编排与治理原型。首版围绕任务触发、专家执行、代码与测试证据、人工审批和交付结果构建可点击闭环。

## 本地运行

```bash
pnpm install
pnpm dev
```

质量检查：

```bash
pnpm check
```

## 原型范围

- Session 管理：活跃、收藏、归档视图，搜索与状态筛选，重命名、收藏、归档、恢复和删除；状态写入 `localStorage`，刷新后保留。
- Run 工作台：阶段轨道、事件时间线、追加指令、终端回放、文件 Diff、审批决策。
- 控制平面：运行记录、自动化、专家库、代码仓库、集成、治理中心和事件日志。
- 关键交互：新建任务、切换证据视图、批准或退回、失败步骤重试、侧栏折叠和移动端抽屉。
- 全局偏好：浅色/深色主题与中文/英文切换，偏好跨页面、跨刷新保持一致。
- 视觉系统：中性 Graphite 基底、受控绿色主色和语义状态色；Lucide 细线图标，4–8px 圆角，无装饰性渐变。
- 响应式：桌面使用紧凑数据表和 Inspector，390px 小屏使用 Session/Run 信息卡与紧凑阶段条。

完整产品与工程蓝图见 [docs/product-blueprint.md](./docs/product-blueprint.md)。
