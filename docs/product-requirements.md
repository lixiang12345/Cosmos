# Relay 产品需求规格

> 文档状态：研发基线（Draft for implementation）  
> 版本：1.1
> 日期：2026-07-12  
> 事实基线：[cosmos-evidence-matrix.md](./cosmos-evidence-matrix.md)  
> 适用范围：Relay Cosmos 风格原型及其后续产品化实现

## 1. 文档目的

本文把官方证据、合理推断和 Relay 自有扩展转成可实施、可验收的产品合同。产品、设计、前端、后端和测试必须使用相同术语、对象关系和优先级；未在本文定义的能力不能仅凭“Cosmos 应该如此”进入开发。

### 1.1 证据标记

| 标记 | 含义 | 需求处理规则 |
| --- | --- | --- |
| **Official** | Augment 官方文档明确描述 | 作为对标事实实现；若改变，必须记录原因 |
| **Inferred** | 从官方事实合理推导，但界面或细节未被证实 | 可用于 Relay 设计；上线前保留复核项 |
| **Relay extension** | Relay 为治理、交付、本地化或团队运营新增 | 使用 Relay 命名、权限和审计，不冒充官方功能 |

凡未标记的条目默认属于 Relay 的实现约束，而不是 Cosmos 官方事实。

### 1.2 实现状态标记

证据等级回答“为什么做”，实现状态回答“现在能否真实交付”，两者不得混用。

| 标记 | 含义 | 对外口径 |
| --- | --- | --- |
| **Implemented** | 已有持久化代码路径和自动化验证 | 只能声称表中列出的有限能力 |
| **Partial** | 只实现了主路径的一部分，仍依赖本地投影、mock 或信任客户端数据 | 不得称为生产可用 |
| **Prototype** | 可点击的界面和确定性模拟 | 必须在界面与演示材料中标记 Simulation |
| **Target** | 已批准但尚未实现的产品/工程合同 | 仅可用于计划和验收，不可对客户承诺已上线 |

实现状态以仓库代码和可复现验证为准，不以截图、原型文案或 OpenAPI 目标定义为准。

## 2. 产品定义

Relay 是面向研发团队的 Agent 工作系统。用户选择一个可复用 Expert，通过持续 Session 提交目标、补充上下文、观察 Agent 与工具执行、处理必要的人类决策，并追踪文件和交付产物。平台管理员负责 Expert、Environment、Integration、Automation 与 Space 的配置和边界。

### 2.1 解决的客户痛点

1. Agent 工作散落在 IDE、聊天、工单和 CI 中，历史、上下文与交付证据不可持续追踪。
2. 每次任务都重复描述仓库、环境、工具和团队约束，启动成本高且容易配置错误。
3. Agent 的工具调用、外部写入和失败恢复不可见，负责人难以判断何时介入。
4. 自动化、人工会话和组织知识相互割裂，成功经验不能跨 Session 复用。
5. 环境、权限和 Secret 与 Agent 身份绑定不清，平台团队难以治理并控制风险。

### 2.2 产品原则

- Session 是第一产品表面；Run/Attempt 是 Session 内的一次执行，不是平级主对象。
- Expert 封装指令、模型、能力、Environment 和启动引导；新建 Session 不重复配置这些内容。
- 对话优先，结构化配置用于管理员和高级场景。
- 人类负责目标、风险和最终判断，不逐步遥控 Agent。
- 所有模拟结果必须明确标记为 Prototype/Simulation。
- Official、Inferred 与 Relay extension 在需求、界面和发布说明中保持可追溯。

## 3. 目标与非目标

### 3.1 本阶段目标

| ID | 目标 | 优先级 |
| --- | --- | --- |
| PRD-G01 | 从 Home 或 New Session 入口以“Expert + prompt + 附件”启动持续 Session | P0 |
| PRD-G02 | 用户可恢复、搜索、Pin、归档、分享并继续历史 Session | P0/P2 |
| PRD-G03 | Session detail 以对话、Agent turn、tool call、Artifact 和 Worker 为核心 | P0 |
| PRD-G04 | Files 的 User/Organization/Workspace scope 与代码 Changes 语义分离 | P0 |
| PRD-G05 | Managed Template Expert 与 Custom Expert 生命周期分离 | P1 |
| PRD-G06 | Cloud Environment 与 Self-hosted Daemon 的配置和运行关系清晰 | P1 |
| PRD-G07 | Trigger、Event Log、Run History 和 Session 使用统一 Automation 数据源 | P1 |
| PRD-G08 | Space 成为资源、默认值和可见性的真实边界 | P1 |
| PRD-G09 | Advisor 作为内置 Expert 使用普通 Session 和受控工具执行配置计划 | P1 |
| PRD-G10 | 原型在中英文、明暗主题、桌面与小屏下均可完整演示核心闭环 | P0 |

### 3.2 非目标

- 不做与 Augment 品牌、文案和像素级界面的 1:1 复制。
- 不在原型阶段实现真实 LLM 推理、云 VM、Daemon 调度或流式 Tool Broker。
- 不在原型阶段实现真实 OAuth、Secret 加密、计费、SAML/SCIM 或跨区域部署。
- 不构建拖拽式工作流编排器；Automation 通过 Expert Trigger 表达。
- 不把移动端作为复杂管理配置主入口；小屏优先查看、继续 Session 和处理决策。
- 不允许前端直接修改共享 Files，也不把永久删除 Session 作为普通用户操作。
- 不为未被证实的 Cosmos 页面结构做“官方原版”声明。

### 3.3 当前交付基线（2026-07-12）

| 能力 | 状态 | 当前真实边界 | 进入生产前的必要条件 |
| --- | --- | --- | --- |
| Web 原型 | **Partial** | React 页面、主题/语言、响应式导航和主要演示交互可用；多数领域数据仍为 seed/localStorage | 连接真实身份、权限和服务端数据；移除伪成功路径 |
| Session 创建/列表 | **Partial** | Web 已调用真实 API；API 支持 OIDC、membership、Private creator 隔离；启动时原子创建 Session/Message/Turn/Command/Outbox 并完整幂等重放 | 服务端解析 Expert/Environment revision、后续消息/生命周期、Private 分享与分页 |
| PostgreSQL 持久化 | **Implemented (limited)** | 配置 `DATABASE_URL` 时持久化 Session 和幂等记录；未配置的开发模式使用内存 | 备份/恢复、数据库高可用、tenant 隔离、容量与迁移回滚演练 |
| Expert、Environment、Automation、Files、Approval | **Prototype** | 界面和本地控制面可演示，没有完整服务端权威模型 | 实现 API、不可变 revision、RBAC、审计和失败恢复 |
| Agent 执行 | **Target** | 未实现真实模型、队列、沙箱、Tool Broker 或流式事件 | 执行面隔离、队列/租约、策略校验、幂等工具调用和实时恢复 |
| 安全与合规 | **Partial** | 生产配置强制数据库、OIDC 与 CORS；已有基础 membership/RBAC 和跨 tenant 负向测试 | 补齐 RLS/统一 tenant guard、Private 分享、Secret 管理、operation policy 与 append-only audit，并完成 [数据模型、权限与 Session 生命周期](./data-model-permissions-session-lifecycle.md) 和 [生产架构基线](./production-architecture.md) 的 P0 门槛 |

结论：当前版本是“可验证的全栈纵向切片 + 完整原型”，不是可公网暴露或承载客户数据的生产版。

## 4. 用户与权限角色

| 角色 | 核心任务 | 默认权限 |
| --- | --- | --- |
| Member | 发起/继续 Session、查看获授权资源、管理自己的 Pin | 读取 Space 可见资源；创建 Private/Shared Session |
| Expert Manager | 创建和维护 Custom Expert，配置团队对 Managed Template 的追加内容 | Member + Expert revision 与发布 |
| Space Admin | 管理 Space、Environment、Integration、Trigger、Files 策略和成员 | Space 内控制平面读写 |
| Approver | 处理 Relay 风险决策 | 读取相关证据并批准/退回，不自动获得配置权限 |
| Organization Admin | 管理 Default Space、跨 Space 迁移、保留策略与组织 Files | 组织范围管理和审计 |

原型可使用固定用户模拟这些角色，但所有受限操作必须展示权限边界；不能因为前端可点击就暗示后端已授权。

## 5. 领域模型与术语

```text
Organization
└── Space
    ├── Expert ── Environment / Capabilities / Triggers / Workers
    ├── Session ── Turns ── Tool Calls ── Run Attempts
    │   ├── Artifacts
    │   ├── Subscriptions
    │   └── Workspace Files
    ├── User / Organization Files
    ├── Integrations / MCP / Secrets / Webhooks
    └── Events ── Trigger match ── Session
```

| 对象 | 规范定义 |
| --- | --- |
| Expert | 可复用 Agent 配置；Managed Template 的基础内容不可由团队覆盖，Custom Expert 可完整编辑 |
| Session | 与一个 Expert 的持续目标和对话容器，可永久重开继续 |
| Turn | 用户或 Agent 在 Session 中的一次消息/执行回合 |
| Tool Call | Agent 调用工具的结构化记录，包含状态、输入摘要、输出和权限结果 |
| Run Attempt | Session 中的一次执行尝试；重试创建新 Attempt 并保留旧记录 |
| Artifact | PR、分支、Issue、报告、自定义链接等可搜索交付对象 |
| File | Agent 写入的持久内容；每次写入形成不可变版本，并带 scope 和来源 |
| Trigger | Expert 上的持久事件规则；匹配 Event 后创建 Session |
| Subscription | Agent 在运行中创建，把后续 Event 送回现有 Session 的临时订阅 |
| Space | Sessions、Experts、Environments、Secrets、Files 等资源的边界 |

当前代码中的单一 `Run` 仅是迁移期视图模型，不是目标领域模型。

## 6. 信息架构与页面范围

| 页面/入口 | 目标路由 | 来源等级 | 产品要求 | 优先级 |
| --- | --- | --- | --- | --- |
| Home | `/home`，`/` 重定向 | **Official** + **Inferred** | Expert 选择、任务 composer、附件、最近 Session；品牌入口可达，不在侧栏新增未经证实的 Home 文本项 | P0 |
| New Session | 共享 launcher；可演进为 `/sessions/new` | **Official** + **Inferred** | 与 Home 共用 Expert + prompt 交互；标题自动生成 | P0 |
| Sessions | `/sessions` | **Official** | 当前/归档、可见性、搜索、Pin、继续会话 | P0/P2 |
| Session detail | `/sessions/:sessionId`；迁移期兼容 `/runs/:id` | **Official** + **Relay extension** | Conversation、composer、Files、Artifacts、Workers；条件式 Changes/Approval/Terminal | P0 |
| Files | `/files/organization`、`/files/user` | **Official** | 只读树、预览、版本、复制、下载；修改必须发起 Session | P0 |
| Experts | `/experts`、`/experts/:id` | **Official** + **Inferred** | Managed/Custom 分流、launch guidance、Environment ID、Triggers/Workers | P1 |
| Environments | `/environments`、`/environments/:id` | **Official** + **Inferred** | Cloud/Self-hosted、仓库、变量、Hooks、Terminal、更新历史 | P1 |
| Automations | `/automations` | **Official** | 按 Expert 聚合 Triggers，支持试运行、暂停、删除、Auto-archive | P1 |
| Event Log | `/automations/events` | **Official** | 原始 payload/headers、匹配解释、关联 Session | P1 |
| Run History | `/automations/history` | **Official** | 展示 Trigger 创建的 Sessions，不创建第二套运行实体 | P1 |
| Spaces | `/spaces` | **Official** + **Inferred** | Default、搜索/创建、默认 Expert/Environment、迁移预览 | P1 |
| Advisor | 通过 Home/Expert picker 启动普通 Session | **Official** | 内置 Expert；计划、确认、工具结果、限制跳转 | P1 |
| Approvals | `/approvals` 或治理分组 | **Relay extension** | 对有权限用户条件显示，汇总 Session 内风险决策 | P1 |
| Settings/语言/主题 | `/settings` + 全局控件 | **Relay extension** | 中文/英文、Light/Dark/System、个人偏好 | P0 |

## 7. 关键用户旅程

### J01：从 Home 启动 Session（P0）

1. 用户进入 `/` 或点击品牌，打开 Home。
2. 系统按当前 Space 展示可用 Expert；默认选中最近使用或 Space 默认 Expert。
3. 用户查看 Expert 的 launch guidance、Environment、Capabilities 和可见范围摘要。
4. 用户输入目标，可粘贴链接、添加受支持附件或使用 Enhance Prompt。
5. 用户选择 Private 或 Shared，点击“开始会话”。
6. 系统创建 Session，自动推导 Space、Environment 和默认仓库，进入 Session detail。
7. 若启动前检查失败，保留输入并给出可执行修复入口。

来源：**Official**（Expert + prompt、附件、可见性）、**Inferred**（标题自动生成、launcher 形态）、**Relay extension**（高级验收/分支覆盖）。

### J02：继续、Pin 与归档 Session（P0/P2）

1. 用户从侧栏 Recent/Pinned、Sessions 或 Cmd+K 找到 Session。
2. 用户可按标题、Artifact、分支、Issue 或链接搜索。
3. 打开历史 Session 后继续发送消息；会话上下文和 Artifact 保留。
4. 用户可 Pin、移动到 Pin 文件夹、归档或恢复。
5. 普通用户不看到永久删除；管理员按保留策略处理销毁。

来源：**Official**（持续会话、Pinned、Archived、Artifact 搜索）、**Inferred**（Relay 表格和筛选）、**Relay extension**（批量归档）。

### J03：观察 Agent 并在必要时介入（P0）

1. Session 时间线展示用户消息、Agent turn 和 tool call，不展示隐藏推理。
2. Agent 工作时用户可继续发送消息；消息进入有序队列并可取消。
3. 用户可添加图片/文件、使用 `/` 命令和 Enhance Prompt。
4. Session 展示生成的 Artifact、Worker tree 和 Files 更新。
5. 只有发生代码变更、风险决策或失败时，显示 Changes、Approval、Retry 等条件式扩展。

来源：**Official**（conversation、queue、attachment、slash、enhance、artifact、worker）、**Relay extension**（审批、Diff、暂停/停止/重试）。

### J04：配置并发布 Expert（P1）

1. Expert Manager 选择 Managed Template 或 Custom Expert。
2. Managed Template 只允许追加团队指令、连接资源和设置启动引导；基础 prompt 显示只读及上游版本。
3. Custom Expert 可编辑身份、共享、指令、模型、Capabilities、Environment、launch guidance、Workers 和 Triggers。
4. 系统执行校验/试运行并展示问题。
5. 发布 revision 后，该 Expert 可用于新 Session；旧 revision 仍可追踪。

来源：**Official**（Expert 字段与模板托管语义）、**Inferred**（revision 发布交互）、**Relay extension**（显式审批政策和完成标准）。

### J05：建立 Environment（P1）

1. Space Admin 选择 Cloud 或 Self-hosted。
2. Cloud 创建需要名称、基础镜像、仓库；可配置 Variables、Hooks、共享和网络。
3. Provisioning 状态可观察，失败显示阶段、原因和重试。
4. 管理员可打开 Web Terminal 调整并 Update Environment；更新形成历史。
5. Ready Environment 可被 Expert 引用；新 Session 从隔离快照启动。

来源：**Official**；固定 CPU/内存、egress allowlist 等归为 **Relay extension** 高级政策。

### J06：由 Event 触发 Automation Session（P1）

1. Expert Manager 在 Expert 上创建 Trigger，默认关闭。
2. 使用 Test event 查看匹配解释；确认后启用。
3. Event Log 保存来源、payload、headers、幂等 ID 和匹配结果。
4. 匹配后创建新 Session，并将原始 payload 作为首条消息。
5. Automations 与 Run History 从同一 Trigger/Session 数据投影；自动归档按 Trigger 设置执行。

来源：**Official**（数据关系）、**Inferred**（Wizard）、**Relay extension**（模拟注入和幂等测试 UI）。

### J07：浏览并请求修改 Files（P0）

1. 用户在 Organization/User 树中选择文件，查看路径、大小、更新时间和写入 Agent。
2. 用户可预览、Copy path、Copy content、Download 和查看不可变版本。
3. 用户点击“请求修改”，系统以文件路径和版本为上下文打开 Session launcher。
4. 恢复旧版同样通过 Expert 写回新版本，不在浏览器中直接覆盖。

来源：**Official**；Organization 写入审批和保留策略为 **Relay extension**。

### J08：Advisor 配置控制平面（P1）

1. 用户从 Expert picker 选择内置 Advisor，提交目标。
2. Advisor 只询问缺失信息，生成依赖、变更和风险计划。
3. 用户确认后，Advisor 通过受控工具逐步执行，并在 Session 中回传结果。
4. OAuth 和 Secret 操作停在人工步骤，不读取或保存 Secret 明文。
5. 失败步骤可重试，Session 可恢复并记住已确认的决策。

来源：**Official**；Relay 合规/预算建议使用 `Relay Advisor` 品牌，属于 **Relay extension**。

## 8. 功能需求与验收标准

### 8.1 P0 核心闭环

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| PRD-P0-01 | Home 作为启动入口 | Given 用户进入 `/`，When 页面加载，Then 跳转 `/home`，首屏可见 Expert picker 与 composer，且无监控 Dashboard 抢占主操作 |
| PRD-P0-02 | 轻量 Session launcher | Given 至少一个可用 Expert，When 用户输入 prompt 并开始，Then 不要求再次选择 Expert 已绑定的 Environment/Repository，创建后进入唯一 Session |
| PRD-P0-03 | 启动失败可恢复 | Given Expert/Environment 不可用，When 用户启动，Then 输入与附件保留，显示具体原因和配置/重试入口，不生成重复 Session |
| PRD-P0-04 | Sessions 生命周期 | Given 当前 Space 有 Session，When 用户搜索、打开、归档、恢复，Then 视图与持久状态一致；普通用户无永久删除入口 |
| PRD-P0-05 | Conversation detail | Given 打开 Session，Then 时间线可区分 user/agent/tool/result，composer 固定可达；Agent 工作时新消息进入有序队列 |
| PRD-P0-06 | 附件与 Prompt 工具 | When 用户选择、拖放或粘贴支持文件，Then 显示稳定预览、大小/类型错误；`/` 命令和 Enhance 可操作且不会静默覆盖原文 |
| PRD-P0-07 | Artifacts 与 Workers | Given Session 产生 Artifact 或 Worker，Then detail 可定位、打开和追踪来源；父子 Session 关系可见 |
| PRD-P0-08 | Files 只读语义 | Given 用户浏览全局 Files，Then 可预览/复制/下载/看版本，但不能直接编辑、上传、删除或客户端恢复 |
| PRD-P0-09 | Files 与 Changes 分离 | Given 代码 Expert 产生 Diff，Then 显示为 Changes；Files tab 显示 Workspace/User/Organization VFS，不复用 Diff 内容 |
| PRD-P0-10 | App shell 稳定 | Given 任意支持视口/主题/语言，Then 侧栏无异常空白或重叠，主内容不被导航遮挡，键盘可到达全部核心操作 |

### 8.2 P1 控制平面

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| PRD-P1-01 | Expert 类型分流 | Managed 基础 prompt 只读且显示上游版本；Custom 提供完整字段；两者均引用真实 Environment ID |
| PRD-P1-02 | Expert revision | 发布前有校验/试运行；Session 记录使用的 revision；回滚不删除历史 |
| PRD-P1-03 | Environment 完整配置 | 创建/详情覆盖 image、repositories、variables、hooks、sharing、network；Provisioning/failed/ready 状态可验证 |
| PRD-P1-04 | Cloud/Daemon 关系 | Environments 内可切换 Cloud/Self-hosted；Daemon 状态和能力影响可调度性，但不伪装成 Cloud Environment |
| PRD-P1-05 | Trigger 唯一来源 | Expert Trigger 是唯一写模型；Automations/Event Log/Run History 不创建重复规则副本 |
| PRD-P1-06 | Event 可追溯 | Event 保存 payload/headers/幂等 ID/匹配解释，并链接唯一 Session；重复 Event 不重复创建 Session |
| PRD-P1-07 | Space 真实边界 | Picker 来自状态源并持久化；Default 不可删改；删除非 Default 前必须选择迁移目标并预览影响 |
| PRD-P1-08 | Advisor 受控执行 | 每次控制面变更先呈现 plan/diff 并确认；OAuth/Secret 返回人工步骤；结果进入审计记录 |
| PRD-P1-09 | Relay Approvals | 只有有权限用户看见治理入口；决策包含风险、影响、证据、到期时间和审计结果 |

### 8.3 P2 管理增强

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| PRD-P2-01 | Pinned Sessions | 支持排序、文件夹、过滤和折叠；Pin 是账户级偏好，不改变 Session 共享状态 |
| PRD-P2-02 | Artifact 搜索 | Cmd+K 和 Sessions 搜索能通过 PR、branch、Issue、自定义链接定位 Session |
| PRD-P2-03 | 高级启动选项 | 仅代码交付 Expert 显示分支/验收覆盖；默认折叠，且不能绕过 Expert 权限 |
| PRD-P2-04 | 组织 Files 治理 | 写入审批、保留、配额和审计策略可配置，并对受影响 Session 给出明确反馈 |

## 9. 状态、异常与恢复

### 9.1 目标状态模型

- Session lifecycle：`draft | queued | active | waiting | paused | completed | failed | canceled`；`archivedAt` 是独立属性，`visibility` 为 `private | space`。
- Run Attempt：`queued | running | waiting_for_input | succeeded | failed | canceled`；Retry 新建 Attempt。
- Message：`draft | queued | sending | accepted | failed | canceled`。
- Tool Call：`requested | awaiting_permission | running | succeeded | failed | canceled`。
- Expert：`draft | published | disabled | archived`，并带 `managed_template | custom | built_in` 类型。
- Environment：`provisioning | ready | failed | disabled`，Provisioning 保留阶段与错误详情。
- Trigger：`disabled | enabled | degraded`；Event：`matched | unmatched | ignored | duplicate`。

### 9.2 通用异常要求

| 场景 | 必须行为 |
| --- | --- |
| 网络/后端超时 | 保留用户输入；显示重试；写操作使用幂等键，不用乐观成功伪装完成 |
| Space 已切换 | 关闭或重置旧 Space 的编辑上下文；明确提示资源范围变化 |
| 权限被撤销 | 停止受限操作，保留只读证据；显示所需角色和申请入口 |
| Expert/Environment 已禁用 | 不允许新建 Session；已有 Session 保持可读并显示运行限制 |
| 附件不支持/超限 | 在上传前或选择后立即标明文件、原因和限制，其他有效附件不丢失 |
| Event 重复 | 返回已有匹配和 Session 链接，不创建第二份数据 |
| Secret/OAuth 需要人工操作 | 不展示 Secret 值；提供受信跳转、过期状态和完成后的重新检查 |
| 模拟能力 | 在操作前和结果区域显示 Simulation，不产生误导性真实成功文案 |

## 10. 权限与审计要求

| 能力 | Member | Expert Manager | Space Admin | Approver | Org Admin |
| --- | --- | --- | --- | --- | --- |
| 创建 Private/Shared Session | 是 | 是 | 是 | 按成员身份 | 是 |
| 查看 Shared Session | Space 范围 | Space 范围 | Space 范围 | 仅关联决策 | 组织政策范围 |
| 发布 Expert | 否 | 是 | 是 | 否 | 是 |
| 管理 Environment/Trigger/Integration | 否 | Trigger 限其 Expert | 是 | 否 | 是 |
| 处理风险决策 | 否 | 按授权 | 按授权 | 是 | 是 |
| 修改 Space/迁移资源 | 否 | 否 | 本 Space | 否 | 是 |
| 查看审计 | 自身/关联 | Expert 范围 | Space 范围 | 决策范围 | 组织范围 |

所有配置写入、外部写操作、权限决策、Secret 引用、Space 迁移和管理员删除必须记录 actor、scope、target、before/after 摘要、结果、时间和 correlation ID。审计不得记录 Secret 明文、完整私密 prompt 或无必要的附件内容。

## 11. 非功能需求

| 类别 | 要求 |
| --- | --- |
| 可访问性 | 核心流程达到 WCAG 2.2 AA；全键盘操作；焦点可见；图标按钮有可访问名称；状态不只依赖颜色 |
| 响应式 | 支持 390、768、1024、1440、1920 CSS px；固定格式控件不因动态内容跳动；无文本/控件重叠 |
| 主题/语言 | Light、Dark、System；中文、英文；切换即时且刷新保留；两种主题保持同一信息层级 |
| 性能 | 本地交互反馈 <100ms；首屏可交互目标 <2.5s（正常桌面网络）；长列表使用分页或虚拟化策略 |
| 安全 | 最小权限、Secret 不回显、富文本与 URL 安全处理、外部导航明确、写操作可审计且可幂等 |
| 可靠性 | Session 消息和 Event 创建具幂等性；断线恢复不重复提交；重要状态有持久化和迁移策略 |
| 可观测性 | 记录页面错误、API 失败、Session 启动漏斗、Tool Call/Approval 延迟；日志不含敏感正文 |

## 12. 产品级完成标准

### 12.1 完整原型

只有同时满足以下条件才可称为“完整原型”：

1. P0 每条需求有自动化测试或记录在册的人工视觉用例，且通过。
2. Home → Session → 消息队列 → Artifact/Files/Worker → 恢复会话的主路径无死路。
3. Expert → Environment → Session 与 Trigger → Event → Session 两条对象链可在 UI 中追踪。
4. 所有 Relay extension 在需求和界面命名上可辨识；没有把 Inferred 交互宣称为官方事实。
5. Light/Dark、中文/英文、桌面/小屏均完成截图与交互验收。
6. `pnpm check` 通过；关键路径无 P0/P1 无障碍、布局或数据一致性缺陷。
7. 所有后端模拟点有明确标签、确定性结果和未来接口契约，不伪造真实外部成功。

### 12.2 生产发布（GA）

对客户开放前必须同时满足：

1. 不存在未鉴权的领域 API；Organization/Space/Private Session 隔离有跨 tenant 集成测试和第三方安全复核证据。
2. Session 创建、首条 Message/Turn、Command、Outbox 和幂等响应在同一事务中提交；并发重放不产生重复外部副作用。
3. 已上线备份、恢复、回滚、密钥轮换、依赖降级和重大故障处置 Runbook，并完成预发环境演练。
4. 生产 SLO、告警、分布式追踪和脱敏审计可用；无 Secret、prompt 正文或附件内容进入默认日志。
5. 关键旅程有浏览器 E2E、API 契约、PostgreSQL 集成、权限矩阵和恢复测试；所有 P0/P1 缺陷关闭。
6. 数据处理、保留/删除、客户导出、支持访问和子处理商边界已经法务/安全确认，且产品界面与政策一致。
7. 发布候选版完成容量、压力、渗透、可访问性、双语与主题视觉验收，由产品、设计、工程、安全共同签署 Go/No-Go。

任一条未满足时，版本只能进入内部、设计合作伙伴或明确隔离的测试环境，不能使用“生产可用”标记。

## 13. 待确认事项

1. 官方 UI 是否存在独立 Home 侧栏文字项；当前决策是不添加，仅保留品牌、根路由和命令面板入口。
2. New Session 最终采用独立路由还是全局 overlay；当前必须先共享同一 launcher 逻辑。
3. Session 的自动归档默认值、Pinned 文件夹上限和 Artifact 搜索范围。
4. Managed Template 的可追加字段和上游更新冲突解决方式。
5. Relay Approvals、Files 写入治理和高级 Environment Policy 的商业版本边界。
6. 二级搜索结果曾出现“Open Sessions”描述，但 2026-07-12 直接核验时该页返回 404，且当前官方 `llms.txt`、`sessions-overview.md` 和 `getting-started.md` 均将 Session 定义为与 Expert 的对话。在新的一手证据出现前，Relay 保持 `expertId` 必填，不将 Open Session 宣称为现行 Cosmos 能力。
