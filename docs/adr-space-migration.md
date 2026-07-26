# ADR: Space 资源迁移状态机与执行切片

> 状态：已采纳（2026-07-26）
> 关联：`docs/cosmos-evidence-matrix.md` §Spaces、迁移 089、任务「定义 Space 可恢复迁移状态机与首个执行切片」

## 背景

Space 删除前必须把资源移交到目标 Space。此前只有 `GET /migration-preview`（影响计数 + 阻塞条件），执行被明确门禁。本 ADR 定义可执行、可验证、可重试的迁移工作流，并交付第一个资源切片。

## 状态机

```
                    ┌────────────┐
  POST /migrations  │  pending   │   作业行创建（幂等键防重复提交）
                    └─────┬──────┘
                          │ advisory lock 获取（fencing）
                    ┌─────▼──────┐
                    │ executing  │   SECURITY DEFINER 函数内单事务重写
                    └─────┬──────┘
              成功        │        失败（任何一步）
        ┌─────────────────┴──────────────┐
  ┌─────▼──────┐                  ┌──────▼─────┐
  │ completed  │                  │   failed   │ → 重新 POST 重试（新作业行）
  └────────────┘                  └────────────┘
```

- **freeze**：执行期间以 `pg_advisory_xact_lock(hashtext(org‖source‖target‖resource))` 实现互斥；并发第二个执行者阻塞至第一个提交后重查，发现源空间已无该类资源 → `completed`（迁移 0 行），不会双迁。
- **preview** 保持独立端点；执行前在服务端复检全部阻塞条件（Default Space、双方 active、目标存在），预览结果不作为执行凭据。
- **execute**：整个资源类重写发生在**一个数据库事务**内（主表 + audit + outbox 的 `space_id` 同步更新，FK 改为 `DEFERRABLE` 后在函数内延迟校验）。任何失败（含目标空间同名冲突）→ 事务回滚 → 数据零变化，作业行记 `failed` + 错误信息。
- **verify**：函数返回迁移行数写入作业行（`resourceTotal`/`resourceMigrated` 恒等或作业失败）；集成测试断言迁移后源空间计数为 0、目标空间计数增加、子表租户列一致。
- **rollback**：单事务语义使"回滚"即事务中止；不存在部分完成的持久状态，因此无需补偿性反向迁移。
- **archive**：作业行永久保留（审计），`cosmos_space_migrations` 无删除路径。

## 第一切片：Webhooks

选择依据：Webhooks 无外键出边被其他资源引用（automation 事件仅松引用 webhookId 于 payload；expert 无绑定），子表只有本目录的 audit/outbox 两张，是引用面最小的资源类。

- 迁移集合：`cosmos_webhooks`（主）、`cosmos_webhook_audit_events`、`cosmos_webhook_outbox_events` 的 `space_id`。
- ID 保持不变（主键 `(org, space, id)` 中仅 space 段变化）；租户 `organization_id` 恒定，跨租户迁移在函数内显式禁止。
- 目标空间同名活跃 webhook → 冲突失败（整体回滚）。

## 非目标（后续切片）

Sessions、Experts、Environments、Automations、Files 各有更深的引用图（execution snapshot、revision FK、事件流），逐类扩展 `resource_type` 并复用同一状态机与作业表。

## Web 语义

Spaces 页的迁移区先预览后执行；作业列表逐行显示 `completed`/`failed`，预览结果与进行中状态永不渲染为成功。
