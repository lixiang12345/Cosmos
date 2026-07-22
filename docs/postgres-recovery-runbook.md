# PostgreSQL 备份与恢复 Runbook

本文覆盖 Relay PostgreSQL 权威数据的逻辑全量备份与隔离恢复验证。它是发布和季度演练的最低基线，不替代托管数据库的加密连续归档、跨区域副本或 PITR。

## 责任与目标

- 数据库 owner 负责备份策略、密钥、保留期和恢复审批；值班工程师执行演练并保存证据。
- 当前目标为 RPO 不超过 5 分钟、RTO 不超过 60 分钟。仅靠本仓库的周期性 `pg_dump` 无法满足 5 分钟 RPO，生产必须同时启用 PostgreSQL WAL 连续归档或托管 PITR。
- 备份必须存入加密、版本化、不可变且与生产账号隔离的对象存储；本地磁盘仅可作为传输暂存区。
- 每季度以及 PostgreSQL 大版本、关键 schema 或恢复基础设施变更后执行一次完整恢复演练。

## 前置条件

1. 使用与服务端相同或更新 major 版本的 `pg_dump`、`pg_restore` 和 `psql`；新集群须先由 IaC 创建 migration、`relay_api_runtime` 与 `relay_worker_runtime` 角色，dump 会保留对象 ACL 但不会创建全局角色。
2. 从 Secret Manager 注入连接串，不写入 shell 历史、仓库、日志或 CI artifact。
3. 为每份备份生成唯一绝对路径；脚本拒绝覆盖已有文件。
4. 恢复只指向预先创建的隔离数据库。脚本要求连接后的真实数据库名精确匹配 `EXPECTED_DATABASE_NAME`，并要求显式确认值 `restore-approved`。

## 创建并转移备份

```bash
export DATABASE_URL='postgresql://...'
export BACKUP_PATH="/secure-staging/relay-$(date -u +%Y%m%dT%H%M%SZ).dump"
pnpm db:backup
```

成功时同时生成 custom-format dump 和 `.sha256`。脚本在发布文件前运行 `pg_restore --list`，以原子 rename 发布，不接受覆盖。随后将两份文件上传到受控对象存储，核验远端 checksum，再安全删除暂存副本。

## 隔离恢复演练

由数据库平台先创建空的隔离目标库，禁止使用 `postgres`、`template0` 或 `template1`：

```bash
export RESTORE_DATABASE_URL='postgresql://.../relay_restore_2026q3'
export EXPECTED_DATABASE_NAME='relay_restore_2026q3'
export BACKUP_PATH='/secure-staging/relay-20260713T160000Z.dump'
export ALLOW_DESTRUCTIVE_RESTORE='restore-approved'
pnpm db:restore
```

脚本先验证 SHA-256、custom archive 目录和目标库名，再以单事务、`--clean --if-exists` 恢复。失败会回滚恢复事务并返回非零状态。完成后至少验证：

1. `relay_schema_migrations` 与源库版本和数量一致，应用 migration readiness 对 pending/unknown 版本均通过，API/Worker runtime 角色 ACL 可用。
2. Organization、Session、Message、FileVersion、ToolCall、AuditEvent 的计数与抽样 hash 符合演练清单。
3. API 以恢复库启动后 `/api/ready` 成功，跨租户负向验证仍被 FORCE RLS 拒绝。
4. Worker 能领取合成命令并写终态，且不会联系真实 provider 或外部集成。
5. 记录 dump 时间、恢复起止时间、RPO/RTO、PostgreSQL 版本、artifact checksum、验证人和所有偏差。

## 真实事故恢复

1. 宣布事件并冻结写流量；保全日志、审计和数据库时间线。
2. 由事件负责人确定恢复点。数据损坏优先使用 forward repair；需要时间点恢复时，在新实例上执行 PITR，不覆盖唯一生产副本。
3. 在隔离网络完成 checksum、migration、关键计数、授权和应用 smoke 验证。
4. 通过变更审批切换连接；先只读，再逐步开放写入并观察错误率、queue age 和审计写入。
5. 保留旧实例直到业务 owner 签署，随后按保留策略下线。复盘实际 RPO/RTO 并修正 Runbook。

禁止把逻辑 dump 的成功等同于灾备完成：必须有可读取的远端副本、可重复的隔离恢复、应用级验证和有时限的演练证据。

## FileVersion 对象存储配置

生产 API 和 Worker 还必须从 Secret Manager 注入 `OBJECT_STORAGE_ENDPOINT`、`OBJECT_STORAGE_REGION`、`OBJECT_STORAGE_BUCKET`、`OBJECT_STORAGE_ACCESS_KEY_ID` 和 `OBJECT_STORAGE_SECRET_ACCESS_KEY`；可选的 `OBJECT_STORAGE_FORCE_PATH_STYLE=true` 仅用于 S3-compatible 开发端点。服务在 staging/production 缺少任一项时拒绝启动。对象 key 不含客户路径，恢复演练必须同时核验对象 checksum、FileVersion metadata 和授权下载。
