# Cosmos 软件交付计划

> 文档状态：执行基线（Draft for implementation）  
> 版本：1.0  
> 日期：2026-07-12  
> 输入：[product-requirements.md](./product-requirements.md)、[frontend-requirements.md](./frontend-requirements.md)、[cosmos-evidence-matrix.md](./cosmos-evidence-matrix.md)

## 1. 交付目标

用可回滚、可验证的增量，把现有本地 React 原型演进为领域关系正确、交互完整、可接真实后端的 Cosmos 产品原型。交付优先修正主流程和对象语义，不以页面数量或视觉相似度代替完成度。

### 1.1 成功指标

| 指标 | 发布门槛 |
| --- | --- |
| P0 需求覆盖 | 100% 有测试/人工验收证据，阻断缺陷为 0 |
| P1 需求覆盖 | 关键控制面闭环完成；非阻断项有 owner 和目标里程碑 |
| 自动化质量 | `pnpm check` 通过；关键 E2E 通过率 100% |
| 视觉质量 | 5 视口 × 2 主题 × 2 语言关键截图无未批准差异 |
| 可访问性 | 核心流程无严重/高等级自动化问题；键盘路径人工通过 |
| 数据安全 | 无 Secret/私密正文进入日志、URL 或 localStorage 新字段 |
| 可靠性 | Session/Event 创建幂等；刷新/断线/重试不产生重复实体 |

## 2. 交付原则

1. 证据先行：每项对标能力引用 `Official`、`Inferred` 或 `Cosmos extension`。
2. 垂直切片：每个里程碑包含 UI、状态、错误、权限、测试和文档，不交付孤立静态页面。
3. 兼容迁移：旧 route/localStorage 通过适配层迁移，不在页面里双写两套模型。
4. 小 PR：每个 PR 对应一个可验证目标，避免视觉、领域模型和大规模格式化混在一起。
5. 默认安全：写操作等待确认；Secret 不回显；模拟结果不冒充真实结果。
6. 可回滚：schema、route 和功能发布均保留回退路径或 feature flag。

## 3. 工作流与责任

| 角色 | 责任 |
| --- | --- |
| Product owner | 需求优先级、证据等级、验收和范围变更 |
| Product design | IA、prototype、tokens、交互状态、视觉验收 |
| Frontend owner | route/component/state/data adapter、可访问性和前端测试 |
| Backend owner | 领域模型、API、实时事件、权限、幂等、审计和迁移 |
| QA owner | 测试策略、E2E、视觉矩阵、回归和发布签署 |
| Security/Platform | Secret、OAuth、Environment/Daemon、审计和威胁评审 |

单人原型阶段可兼任多个角色，但每个签署项仍需显式记录，不因兼任而省略。

## 4. Definition of Ready

工作项进入实现前必须满足：

- 有需求 ID、来源等级、用户价值和优先级。
- 有 happy path、loading/empty/error/permission 状态和可验收结果。
- 有明确对象 owner/source of truth，避免 Automation/Trigger 等双写。
- 视觉稿或低保真交互覆盖桌面/小屏和最长中英文文案。
- API/schema 变化有 contract、幂等、权限和迁移方案。
- 依赖、feature flag、测试层级和回滚条件明确。
- 未决问题不会实质改变实现；否则保持 blocked 而不是边做边猜。

## 5. 里程碑与退出条件

里程碑以依赖和质量门排序，不承诺未经团队估算的具体日历日期。每个里程碑建议作为一个独立迭代；发现领域/API 风险时先做短期 spike。

### M0：事实、架构与质量基线

**范围**

- 冻结三份需求文档和证据矩阵。
- 建立 route map、领域词汇和 `Run → Session/Attempt` 迁移 ADR。
- 建立 feature repository/service 接口；页面不直接依赖 localStorage。
- 固定 seed、时钟、ID 和 simulation 行为，消除测试随机性。
- 建立 CI 基线、E2E/视觉测试工具和截图视口。

**退出条件**

- `pnpm check` 在干净环境通过。
- 现有主路由冒烟测试通过。
- 数据迁移可重复执行且有回退 fixture。
- 所有 P0 工作项达到 Definition of Ready。

### M1：App Shell、Home 与 Session 启动（P0）

**范围**

- 修正 Sidebar 布局、顺序、touch hover、drawer 和 Pinned/Recent 位置。
- `/`、品牌和 Cmd+K 进入 Home；不新增未经证实的 Home 侧栏文字项。
- Home 以 Expert picker + composer 为首屏。
- 统一 SessionLauncher，支持附件、visibility、Enhance 和幂等启动。
- 启动失败保留输入并提供修复入口。

**退出条件**

- PRD-P0-01、02、03、10 通过。
- 所有 New Session 入口只创建一个 Session。
- 5 视口、两主题、双语视觉验收通过。
- Drawer/launcher 完成键盘和 focus 验收。

### M2：Sessions、Conversation、Files 与 Artifacts（P0）

**范围**

- Sessions 当前/归档、搜索、visibility、Pin 与 legacy 数据迁移。
- Session detail 改为 Conversation 主视图；消息 queue、slash、attachment、enhance。
- Tool Call、Artifacts、Worker tree 和 Attempt history。
- 全局 Organization/User Files 只读浏览；Session Workspace/User/Organization。
- 将现有代码 Diff 重命名并迁移为 Changes；条件式 Approval/Terminal。

**退出条件**

- PRD-P0-04 至 09 全部通过。
- Home→Session→queue→resume→Artifact/Files 主 E2E 通过。
- Files 页面无普通用户直接写入口。
- Retry 创建新 Attempt，旧记录仍可查看。

### M3：Experts 与 Environments（P1）

**范围**

- Built-in、Managed Template、Custom Expert 分流。
- Managed 基础配置/upstream version 与团队追加 revision 分离。
- Environment 引用从镜像字符串迁移为 ID。
- Cloud/Self-hosted、repositories、variables、hooks、sharing、network、Terminal/Update/History。
- Expert dry run、发布 revision、禁用/归档和失效引用处理。

**退出条件**

- PRD-P1-01 至 04 通过。
- Managed 基础 prompt 无可编辑路径和 API 写入口。
- Expert publish→Session launch E2E 通过。
- Environment provisioning success/failure/retry 状态通过测试。

### M4：Automations、Spaces、Advisor 与治理（P1）

**范围**

- Expert Trigger 成为唯一写模型；Automations 为聚合投影。
- Test event、Event Log payload/headers、幂等、匹配解释、Run History。
- Space picker 真实状态、Default、默认 Expert/Environment、迁移预览。
- Advisor 内置 Expert、普通 Session、plan/diff/confirm 与受控工具模拟。
- Cosmos Approvals 按权限条件显示并写审计。

**退出条件**

- PRD-P1-05 至 09 通过。
- Trigger→Event→Session 唯一链路 E2E 通过，重复 Event 无重复 Session。
- Space 切换不泄漏前一 Space 数据；迁移有影响预览。
- Advisor 对 OAuth/Secret 不伪造完成。

### M5：P2 管理增强与发布硬化

**范围**

- Pinned 文件夹/排序、Artifact 全局搜索和高级启动选项。
- Files 治理策略原型。
- 性能、可访问性、安全、遥测、错误恢复、文案和视觉收敛。
- 数据迁移演练、feature flag、灰度、回滚和发布说明。

**退出条件**

- P0/P1 无 blocker/critical 缺陷；接受的 P2 缺口有记录。
- 完整测试矩阵和发布检查通过。
- 试点用户完成关键任务，不依赖开发者解释。
- 回滚演练和数据恢复演练通过。

## 6. 依赖关系与关键路径

```text
Evidence/PRD
→ Domain + repository contracts
→ App Shell + shared SessionLauncher
→ Session/Turn/Attempt model
→ Files/Artifacts/Workers
→ Expert/Environment references
→ Trigger/Event/Space/Advisor
→ Hardening and staged release
```

关键约束：

- Session 模型未拆分前，不扩大 `/runs` 或固定阶段 rail。
- Expert/Environment ID 契约未稳定前，不完成真实 Session 调度接口。
- Trigger 唯一来源未确定前，不继续新增 Automation 编辑入口。
- Space scope 和权限未进入 service 层前，不接真实多租户数据。
- Files 写入来源/版本契约未完成前，不接共享知识写 API。

## 7. 工程拆分与 PR 策略

### 7.1 推荐工作流

1. 从主分支创建 `codex/<short-scope>` 或团队约定 feature branch。
2. PR 关联需求 ID、设计链接、测试证据、来源等级和风险。
3. PR 尽量控制为一个垂直目标；自动格式化/重命名独立提交。
4. 至少一位代码 owner 审查；领域、权限或 Secret 变化增加对应 owner。
5. 合并前 rebase/merge 主分支并运行完整质量门。

### 7.2 PR 模板最小内容

- 变更目标和非目标。
- 关联 `PRD-*` / `FE-*` ID 及 `Official/Inferred/Cosmos extension`。
- UI 前后截图/视频（涉及视觉时）。
- 测试命令和结果。
- 数据/API/schema 兼容性。
- 安全、权限和隐私影响。
- feature flag、监控和回滚方式。

### 7.3 提交质量

- 禁止在功能 PR 中无关重排 8k+ 行样式文件。
- 新增 abstraction 必须消除已存在的重复或建立明确边界。
- 不以 `any`、静默 catch、随机 timer 或硬编码成功状态绕过契约。
- TODO 必须有 issue/owner；阻断正确性的 TODO 不允许合并。

## 8. 测试矩阵

| 领域 | Unit | Component/Integration | E2E | Visual/A11y | Contract/Security |
| --- | --- | --- | --- | --- | --- |
| App Shell | nav active、preference | Sidebar/drawer/focus | route/space switch | 5 视口、touch hover | route authorization |
| Home/Launcher | title、context parse、validation | expert/attachment/enhance/error | Home→Session，防重复 | 双语/主题/IME/keyboard | create idempotency、file limits |
| Sessions | filter/sort/migration | URL state、archive/pin | search/resume/archive | table→mobile rows | visibility/RBAC |
| Session detail | event reducers、queue ordering | timeline/composer/tool/attempt | queue/reconnect/retry | streaming stability、screen reader | realtime sequence、redaction |
| Files/Changes | path/scope/version | tree/preview/copy/request change | Files→Session | long path/binary/large | no direct write、download safety |
| Experts | type predicate/revision | managed/custom forms | publish→launch | dirty/error/read-only | immutable base、permission |
| Environments | state transitions | wizard/terminal/history | provision/retry/use | status/long logs | Secret refs/network policy |
| Automations | matcher/idempotency | trigger/event viewer | event→single Session | JSON/empty/error | signed event/audit |
| Spaces | scope/default/migration | picker/delete preview | switch/migrate | long names/mobile | tenant isolation/RBAC |
| Advisor/Approvals | plan/permission | diff/confirm/action required | plan→confirm→audit | risk/focus | no Secret/OAuth impersonation |

## 9. CI/CD 质量门

### 9.1 每个 PR

1. 安装锁定依赖（`pnpm install --frozen-lockfile`）。
2. `pnpm lint`。
3. `pnpm test`，包含变更关联单元/组件测试。
4. `pnpm build`。
5. 关键 route smoke E2E。
6. 变更页面的视觉截图和 axe 检查。
7. dependency/secret scan（CI 配置后启用）。

### 9.2 合并到主分支

- `pnpm check` + 全量 E2E。
- 完整视觉基线比较。
- schema migration 与旧 fixture 测试。
- Preview 环境部署，自动附带 commit、schema 和 feature flag 版本。

### 9.3 发布候选

- 两浏览器内核最低覆盖 Chromium + WebKit；正式支持矩阵确定后增加 Firefox。
- 完整键盘、主题、双语、响应式人工验收。
- 性能预算、安全检查、日志脱敏和告警验证。
- 数据迁移 dry run、回滚演练和发布说明签署。

## 10. Definition of Done

单个工作项完成必须同时满足：

- 验收标准按 Given/When/Then 通过，产品 owner 签署。
- 代码符合边界，未扩大旧 `Run`/localStorage 耦合。
- happy/loading/empty/error/permission/simulation 状态完整。
- 自动化测试覆盖行为而非实现细节；失败用例先能复现问题。
- 双主题、双语、目标视口和键盘路径通过。
- 无 console error、React key warning、未处理 rejection 或明显 layout shift。
- 权限、幂等、审计、敏感数据和外链风险已评估。
- 文档、fixture、migration、feature flag 和 rollback 说明同步更新。

里程碑完成还必须：所有范围项 Done、测试矩阵通过、无未接受 blocker、演示脚本可由非开发者独立完成。

## 11. 数据与兼容迁移

### 11.1 当前本地数据

现有 `cosmos.sessions`、`cosmos.experts`、`cosmos.controlPlane.v1` 和 preference keys 只作为原型数据。迁移步骤：

1. 读取旧 schema 并复制到内存，解析失败不覆盖原值。
2. 将 `favorite` 映射为账户级 `pinned`；`archived` 保持独立属性。
3. 将 `Run` 映射为 `Session + Attempt + Events + Artifacts`；无法确定的信息标记 `legacy`。
4. Expert 镜像/环境字符串映射到 Environment ID；无法映射时阻止新启动并提示修复。
5. Automation 独立记录迁移为 Expert Trigger；冲突进入人工报告，不静默覆盖。
6. 新 schema 写入独立 version key；验证成功后才切换 active pointer。

### 11.2 Route 兼容

- `/runs/:id` 在迁移期解析旧 ID 并 `replace` 到 `/sessions/:sessionId`，同时记录使用量。
- `/files` 根据最近 scope 或默认 Organization `replace` 到子路由。
- 删除兼容 route 前，确认遥测连续两个发布周期无使用或达到团队约定阈值。

## 12. 上线策略

### 12.1 阶段发布

| 阶段 | 用户 | 能力 | 退出条件 |
| --- | --- | --- | --- |
| Local/Preview | 开发与产品 | 全 simulation、seed 数据 | CI、视觉和主 E2E 稳定 |
| Internal alpha | 内部研发小组 | Home/Session/Files/Experts；写操作仍受控 | 无数据丢失/重复 Session，反馈闭环完成 |
| Design partner beta | 少量试点 Space | 接部分真实 API，Automation/Environment feature flag | SLO/安全/回滚通过，P0/P1 缺陷受控 |
| General availability | 符合支持范围的客户 | 已批准能力 | 运行手册、支持、迁移、合规和容量准备完成 |

### 12.2 Feature flags

建议按能力而非页面设置：

- `session_domain_v2`
- `files_readonly_v2`
- `managed_experts`
- `environment_terminal`
- `trigger_projection_v2`
- `space_migration`
- `advisor_control_tools`
- `cosmos_approvals`

Flag 必须有 owner、默认值、目标移除日期和组合测试；安全控制不能仅依赖前端 flag。

### 12.3 回滚

- 前端静态资源支持回滚到上一构建。
- schema 采用 expand/migrate/contract；发布期不执行不可逆删除。
- 新旧读取路径可短期并存，但只允许单一写源。
- 外部 Event/Session 创建使用幂等键，重放不产生重复副作用。
- 回滚触发条件：数据损坏、跨 Space 泄漏、重复外部写、Secret 暴露、核心启动失败率超阈值。

## 13. 可观测性与发布判定

### 13.1 最小事件

- Home viewed、Expert selected、Session start attempted/succeeded/failed。
- Message queued/accepted/failed、Attempt retried、Artifact opened。
- File copied/downloaded/change-requested。
- Expert published、Environment provisioned/failed。
- Event received/matched/duplicate、Session created。
- Space switched/migration attempted、Advisor plan confirmed/rejected。

只记录 ID、类型、耗时、错误码和 scope；prompt、附件、Secret、完整 payload 默认不进入 analytics。

### 13.2 告警

- Session 创建失败率或重复率异常。
- Event 到 Session 延迟/失败率异常。
- Space authorization 拒绝/越界异常。
- schema migration 失败、客户端 fatal error 激增。
- Environment provisioning、Tool Call 或 Approval 延迟超过约定 SLO。

### 13.3 Go/No-Go

发布负责人仅在以下条件全部满足时 Go：质量门通过、无 blocker、迁移/回滚演练通过、监控生效、支持文档就绪、产品/工程/QA/安全完成签署。任何数据隔离、Secret、重复外部写或不可恢复数据问题均为 No-Go。

## 14. 风险登记

| 风险 | 影响 | 缓解 | Owner |
| --- | --- | --- | --- |
| 把推断继续当官方事实 | IA 反复返工 | 需求强制来源标记和证据复核 | Product |
| 单一 `Run` 模型继续膨胀 | Session/Attempt 语义错误 | M0 ADR + adapter，禁止页面新增耦合 | FE/BE |
| Trigger 与 Automation 双写 | 规则漂移/重复 Session | Expert Trigger 单一写源 + contract test | BE |
| localStorage 迁移损坏数据 | 原型历史丢失 | versioned migration、备份、fixture 回归 | FE |
| 视觉优化覆盖交互正确性 | 演示好看但流程断裂 | 垂直切片 DoD、E2E 先于 polish | Design/QA |
| 主题/响应式回归 | 重叠、空白、sticky hover | 视觉矩阵 + layout regression 用例 | FE/QA |
| Advisor/Simulation 误导 | 用户以为外部配置已完成 | 持续 simulation 标签、plan/confirm/result | Product/FE |
| Secret/私密数据进入日志 | 安全事件 | 数据分类、redaction、security tests | Security |
| Scope 过大导致长期半成品 | 无可发布基线 | P0/P1/P2 门禁、明确非目标、flag 分批 | Product/Eng |

## 15. 变更控制

- PRD 的 P0/P1 范围、领域关系或来源等级变化必须走 change request。
- Change request 包含原因、证据、受影响需求/测试/schema、迁移和里程碑影响。
- 小型文案/视觉修正可由 Product + Design 直接批准，但不能改变权限、数据或对象语义。
- 每个里程碑结束更新风险、未决项和证据矩阵核验日期；历史决策保留在 ADR/变更记录中。
