# Augment Cosmos 官方证据矩阵与 Relay 原型决策

> 文档状态：原型重构事实基线  
> 核验日期：2026-07-12  
> 资料范围：Augment Code 官方 Cosmos 文档（`docs.augmentcode.com`）  
> 用途：约束 Relay 原型、产品需求和技术需求，避免把推测设计误写成 Cosmos 官方行为

## 1. 证据等级

| 等级 | 定义 | 使用规则 |
| --- | --- | --- |
| **Official** | Augment 官方文档明确描述的产品对象、行为或入口 | 可以作为 Cosmos 对标功能的事实依据 |
| **Inferred** | 根据多个官方事实可合理推导，但官方文档没有明确说明的页面布局或交互细节 | 可以用于原型，但必须保留验证项，不能声称是 1:1 复刻 |
| **Relay extension** | Relay 为目标客户、治理、安全或本地化需要新增的产品能力 | 可以保留，但必须使用 Relay 自有命名和说明，不伪装成 Cosmos 原版功能 |

## 2. 总体结论

当前原型已经覆盖 Sessions、Experts、Environments、Files、Automations、Spaces 等核心对象，但主要偏差不是“页面数量不够”，而是部分对象关系和主流程不准确：

1. Home 的组件存在但没有路由，根路径和品牌入口都跳转到 Sessions；官方明确存在 Home 启动入口。
2. New Session 被设计成工程工单表单，重复要求选择仓库、分支和 Environment；官方主流程是先选 Expert，再在会话输入框描述任务，Environment 是 Expert 配置的一部分。
3. Session detail 已有会话、附件和排队消息雏形，但固定六阶段流水线、模型切换和独立审批页属于 Relay 扩展，不是已证实的 Cosmos 默认会话结构。
4. Files 当前允许用户直接创建、编辑、删除和恢复；官方明确说明文件由 Expert 在 Session 中写入，Files 页面主要用于浏览、预览、复制和下载。
5. Template Expert 当前被完整 Fork 成可自由编辑草稿；官方 Template Expert 的底层提示词由 Augment 托管更新，用户定制内容追加在托管提示词之后。
6. Environments 当前突出 CPU、内存和超时，而官方 Cloud Environment 的主配置是镜像、仓库、环境变量、Hooks、共享和网络；计算资源由平台按负载自动扩展。

以下矩阵是下一轮原型修改和前后端需求拆分的验收依据。

## 3. 核心页面与对象证据矩阵

### 3.1 Home

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Cosmos 存在 Home；用户可在 Home 先选择 Expert，再在页面底部的 prompt box 描述任务并启动 Session。Advisor 部署的 Expert 也可以立即从 Home 使用。 | [Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview)；[Cosmos Advisor](https://docs.augmentcode.com/cosmos/advisor/overview) | `CosmosHomePage` 已存在于 `src/pages/CosmosOperationsPages.tsx`，但 `src/App.tsx` 没有 `/home` 路由；`/`、品牌 Logo 和未知路由均进入 `/sessions`。 | 官方入口能力被移除；现有 Home 组件中的健康指标、自动化统计和 Advisor 仪表盘没有官方依据。 | 恢复 `/home`，根路径和品牌入口进入 Home。首屏以 Expert 选择器、任务输入框、附件入口和最近 Session 为核心；不要把 Home 做成监控 Dashboard。 |
| **Inferred** | 官方文档没有证明左侧存在独立的 Home 菜单项；Home 很可能由根路径、品牌入口或登录后的默认页进入。 | [Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview) | 侧栏目前没有 Home 项。 | 缺少进入 Home 的可发现路径，但新增文字菜单也缺少证据。 | 不新增未经证实的“首页”侧栏项；用品牌点击、根路径和命令面板提供 Home 入口，并在可用官方 UI 证据出现后复核。 |
| **Relay extension** | Relay 可以提供 Space 健康摘要、等待审批和自动化状态，但这些不是已证实的 Cosmos Home 主结构。 | 不适用 | 未挂载的 Home 组件包含环境健康、活跃会话、审批和自动化指标。 | 扩展内容抢占主任务启动路径，会让 Home 变成运维 Dashboard。 | 若保留，仅放在任务启动区之后的次要区域，并明确为 Relay 团队运营摘要。 |

### 3.2 Sidebar

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Space picker 位于侧栏左上；New Session、Sessions、Recent Sessions 位于侧栏顶部。Session 可 Pin，Pinned Sessions 可排序、建文件夹、筛选和折叠。Files 是包含 Organization、User 两个入口的侧栏组。Automations 组包含 Automations、Event Log、Run History。 | [Managing Spaces](https://docs.augmentcode.com/cosmos/spaces/managing)；[Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview)；[Understanding Files](https://docs.augmentcode.com/cosmos/understanding-files)；[Managing Automations](https://docs.augmentcode.com/cosmos/manage-automations) | 当前顺序为品牌、Space picker、New Session、Sessions、Approvals、单一 Files、Automations、Configuration、Favorites、Recent Sessions。 | Favorites 不等于官方 Pinned；Files 缺少 Organization/User 子入口；Pinned 文件夹、排序和筛选缺失；最近会话被长配置列表推到较低位置。 | 重排为 Space picker → New Session → Sessions → Pinned → Recent Sessions → Files 组 → Automations 组 → Configuration。把 `favorite` 语义迁移为账户级 `pinned`。 |
| **Official / Inferred boundary** | 官方证明 Experts、Environments、Files、Automations 是核心资源，并证明组织级集成位于 Settings → Capabilities → Integrations、个人授权位于 Settings → Personal → Linked Accounts、Webhooks 位于 Settings 的 Capabilities 下；但官方资料没有证明存在一个名为 Configuration 的侧栏组，也没有证明其完整项目顺序。 | 上述页面；[Using GitHub as a Tool or Trigger](https://docs.augmentcode.com/cosmos/config-github)；[Webhooks](https://docs.augmentcode.com/cosmos/config-webhooks) | 生产导航曾把 Experts、Environments 放入 Configuration 折叠组；原型还混入 Daemons、Integrations、MCP、Webhooks、Secrets、Repositories、Spaces、Settings。 | 把核心资源、Settings 分类和 Relay 扩展混成同一层级，会制造“已与 Cosmos 完全对齐”的错误印象，并暴露没有生产 API 的空壳入口。 | 生产导航将 Experts、Environments 作为直接资源入口，并开放已有生产 API 的 Files；未服务化的 Settings 子项继续隐藏。原型 Configuration 只用于研发演示，不能视为官方 IA。 |
| **Relay extension** | 独立 Approvals 收件箱、主题切换、语言切换、侧栏折叠属于 Relay 自有增强。 | 不适用 | Approvals 是一级导航；主题和语言位于全局控件/设置；侧栏支持折叠。 | 若与官方入口混排，用户会误以为都是 Cosmos 原版。 | 保留能力，但在产品文档中标记 Relay extension；Approvals 放入“治理”分组或作为有权限用户的条件入口。 |

### 3.3 New Session

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | New Session 创建与 Expert 的新会话；从 Home 启动时先选 Expert，再输入任务。Expert 已包含指令、模型、Capabilities、Environment 和 launch guidance。Session 的 Space 按 Manager、Expert、当前选择、Daemon 的优先级自动确定。 | [Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview)；[Experts](https://docs.augmentcode.com/cosmos/experts)；[Managing Spaces](https://docs.augmentcode.com/cosmos/spaces/managing) | `NewTaskDialog` 要求标题、描述、仓库、基础分支、Expert、Environment、可见范围和验收条件，并提供保存草稿和模拟 preflight。 | 重复暴露 Expert/Environment 已封装的配置；启动成本过高；把 Session 当成工单而不是会话；手动选择 Environment 可能覆盖错误的运行约束。 | 重做为轻量启动器：Expert 选择 + 单一任务 composer + 附件；只读展示该 Expert 的 Environment、Capabilities 和可见范围。仓库和运行环境默认由 Expert/Space 推导。 |
| **Inferred** | 官方没有说明 New Session 是弹窗、独立路由还是先创建空 Session；也没有说明用户必须填写独立标题。标题可合理由首条消息自动生成。 | [Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview) | 当前使用全局 Modal，标题必填。 | 当前交互是本地假设。 | 原型采用 `/sessions/new` 或轻量 overlay 均可，但必须与 Home 共用同一个 launcher 组件；首条 prompt 为必填，标题自动生成，之后可重命名。 |
| **Relay extension** | 验收条件、连接 preflight、保存草稿和分支覆盖是 Relay 面向受控工程交付的增强。 | 不适用 | 已全部放在首屏表单。 | 有价值，但压过了官方主路径。 | 移入“高级选项”；仅当 Expert 声明支持代码交付时显示仓库/分支覆盖；preflight 在启动后以可观察状态呈现，失败时给修复入口。 |

### 3.4 Sessions

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Sessions 页面展示用户可访问的全部当前和归档 Session；会话永久保存，可重新打开继续；Session 有 Shared/Private 可见性。自动化触发的 Session 可在完成后自动归档。Cmd+K 可按 PR、分支、Linear Issue 和自定义链接等 Artifact 搜索 Session。 | [Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview)；[Understanding Artifacts](https://docs.augmentcode.com/cosmos/artifacts) | `/sessions` 有 Active、Favorites、Archived，支持搜索、状态/Expert/仓库/来源/时间筛选、批量归档、重命名、收藏、归档、删除。状态保存在 `localStorage`。 | Favorites 与官方 Pinned 概念不一致；缺少 Private/Shared、Share 与 Artifact 搜索语义；数据仅本地，无法表达组织可见性和长期保存。 | 保留 Sessions/Archived 主视图；把 Favorites 迁移为 Pinned，并主要呈现在侧栏。列表新增可见性和 Artifact 摘要；搜索索引纳入 Artifact。 |
| **Inferred** | 官方未规定 Sessions 必须使用表格、卡片、Tab 或批量选择，也未明确所有筛选项。 | 上述页面 | 当前是高密度管理表格并支持多条件筛选。 | 视觉和交互属于产品推导。 | 继续使用紧凑表格作为 Relay 的团队管理设计，但不要把列结构称为 Cosmos 原版；移动端改为稳定的行式列表。 |
| **Relay extension** | 批量归档、永久删除、复杂筛选和自定义状态优先级是 Relay 管理增强。 | 不适用 | 已实现大部分交互。 | 永久删除与官方“会话永久保存”表述存在产品冲突。 | MVP 暂停永久删除，改为归档/恢复；真正删除进入数据保留策略和管理员流程。批量归档可保留。 |

### 3.5 Session detail

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Session 是与 Expert 的持续对话，包含消息、Agent turn 和 tool call。底部 composer 支持 `/` 命令、附件、拖放/粘贴图片、Enhance Prompt 和 Agent 工作期间的消息排队。会话头部支持 Share。详情面板展示 Artifacts；Worker tree 可从父 Session 查看。Cloud Session 的 Files tab 包含 Workspace、User、Organization 三个 scope。 | [Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview)；[Understanding Artifacts](https://docs.augmentcode.com/cosmos/artifacts)；[Delegating Work](https://docs.augmentcode.com/cosmos/workers-subagents)；[Understanding Files](https://docs.augmentcode.com/cosmos/understanding-files) | 生产 Session 以 Conversation 为主视图，提供幂等 composer、执行控制、Workspace Files 和只读父子 Worker tree；全局另有 User/Organization Files；provider 已能通过受控 ToolCall 列举/读取当前 Workspace 文本文件；demo 保留旧 Terminal/Changes/Approval 原型。 | 缺少 Slash Command、Enhance Prompt、真实附件限制/预览、Share 前端控制、Artifact 详情、独立 Tool/Terminal/Changes 生产面，以及写工具与 Worker 委派编排。 | 保持 Conversation / Files / Workers 的权威主路径；后续把旧 Diff 明确迁移为 Changes，并按服务端 capability 开放其余条件视图。 |
| **Inferred** | 官方没有给出完整 Tab 顺序，也没有证明固定“Agent/Terminal/Files/Subscriptions/Approval”五 Tab 或六阶段 rail。 | 上述页面 | 当前顶部 Tab 和 Trigger→Plan→Author→Verify→Approval→Deliver 固定阶段是原型核心骨架。 | 固定流水线会错误约束 Incident、Data、Review 等非编码 Expert。 | 移除全局固定阶段 rail；把计划、工具组、等待输入、结果作为会话时间线事件。不同 Expert 可通过结构化事件显示自己的阶段。 |
| **Relay extension** | 审批决策、风险证据、可回滚提示、手动暂停/停止/重试、代码 Diff 是 Relay 治理和工程交付增强。 | 不适用 | 已有 ApprovalPanel、审批 Tab、运行控制和 Diff。 | 能力有价值，但目前与官方会话结构混在一起。 | 保留为条件式扩展：只有产生审批或代码变更时出现；审批同时在时间线内就地处理，并可汇总到 Relay 治理收件箱。 |

### 3.6 Experts

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Expert 是可复用 Agent 配置，包含身份与共享、系统指令、模型、Capabilities/Integrations、Environment、launch guidance、Workers 和 Triggers。官方建议优先通过 Advisor 配置。Template Experts 由 Augment 托管维护，用户定制追加在托管 prompt include 之后；Custom Expert 才是完整自定义配置。 | [Experts](https://docs.augmentcode.com/cosmos/experts)；[Template Experts](https://docs.augmentcode.com/cosmos/experts-templates)；[Configure a Custom Expert](https://docs.augmentcode.com/cosmos/experts-configure-custom) | `/experts` 有“我的专家/模板库”；62 个 Workflows 模板可 Fork 为完整可编辑草稿；编辑器支持模型、仓库、Capabilities、Environment、Triggers、Workers、发布、禁用、归档、版本回滚。 | 模板生命周期不准确：当前 Fork 后可完全改写底层 prompt，无法持续接收托管模板更新；缺少 launch guidance 的完整体验；Environment 选择使用镜像字符串而非真实 Environment ID。 | 分成 Managed Template Expert 与 Custom Expert。托管模板锁定基础 prompt，只允许追加团队配置；Custom Expert 提供完整编辑器。所有 Expert 绑定真实 Environment ID，并在启动器展示 launch guidance。 |
| **Inferred** | 官方没有说明 Experts 列表必须分 Tab、使用当前表格列，或采用显式“发布版本”工作流。 | 上述页面 | 当前有草稿、发布、版本、回滚等软件配置管理交互。 | 这些界面是 Relay 的工程化推导。 | 保留版本化作为 Relay 实现，但产品文案标为 Relay Expert revision；后端需求中区分模板上游版本与团队自定义 revision。 |
| **Relay extension** | 审批策略、完成标准、路径范围、显式测试/发布门和本地 62 个 Workflows 目录是 Relay 的治理扩展。 | [Augment Workflows](https://www.augmentcode.com/workflows) 仅作为公开模板意图参考 | 当前模板数据来自 Workflows，编辑器含约束、验收和工具权限。 | Workflows 目录不等同于 Cosmos 官方 Template Expert 目录。 | 保留模板意图，但使用 Relay 品牌和数据模型；官方 Template Expert 仅按 Cosmos 文档列出的目录单独标记，禁止把 62 个 Workflow 全部称为 Cosmos Experts。 |

### 3.7 Environments

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Environment 是 Agent 访问文件、仓库、命令和工具的计算环境，支持 Augment Cloud 与 Self-hosted Daemon。Cloud Environment 包含名称、基础镜像、多个仓库、环境变量、Hooks、共享和网络；每个 Session 从新隔离快照启动，资源按工作负载自动扩展。可在 Web Terminal 配置并 Update Environment，也可从现有 Session 更新、刷新或删除。 | [Cosmos Environments](https://docs.augmentcode.com/cosmos/environments/overview)；[Cloud Environments](https://docs.augmentcode.com/cosmos/environments/cloud)；[Self-hosted Environments](https://docs.augmentcode.com/cosmos/environments/daemons) | `/environments` 是 Cloud 列表/详情和三步创建 Wizard，字段为名称、镜像、CPU、内存、超时、网络策略；`/daemons` 独立展示机器/Pool、在线开关和并发槽位。 | 缺少仓库、环境变量、Hooks、共享、Terminal、Update、从 Session 保存、Refresh、Delete；手动 CPU/内存突出程度与官方自动扩展描述不一致。 | Environment 详情改为 Overview、Repositories、Variables、Hooks、Terminal、History。创建流程优先名称/镜像/仓库；CPU/内存移到 Relay 高级策略或删除。保留 Cloud/Daemon 两种类型。 |
| **Inferred** | 官方没有规定 Cloud 与 Daemon 必须是同页 Tab 还是两个路由，也没有给出完整卡片视觉。 | 上述页面 | 当前两个独立路由。 | IA 尚未被官方 UI 证实。 | 可以保留两个路由，但在 Environments 入口内提供 Cloud / Self-hosted 分段导航，避免用户误认为 Daemon 是完全无关对象。 |
| **Relay extension** | 严格 egress allowlist、固定资源额度、超时策略、Daemon 并发配额是 Relay 企业治理增强。 | 不适用 | 当前已有网络 policy、allowed hosts、CPU/内存/timeout 和 daemon slots。 | 与官方基础能力混写，容易产生实现误解。 | 作为 Enterprise Policy 明确标注，并在后端模型中与基础 Environment spec 分离。 |

### 3.8 Files

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Files 是跨 Session 的持久存储，分 User 和 Organization scope。用户不直接上传或编辑，Expert 在 Session 中写入，turn 结束时同步。Files 侧栏有 Organization/User 两个树形页面，显示路径、大小、更新时间和最后写入 Agent；支持预览、Copy path、Copy content、Download。每次写入生成不可变版本；恢复旧版也应通过 Expert 写回。Session 内还有 Workspace scope。 | [Understanding Files](https://docs.augmentcode.com/cosmos/understanding-files) | `/files` 使用 User/Organization 分段控件、列表/预览和版本历史，但允许用户直接新建、编辑、删除、恢复版本。侧栏只有一个 Files 入口；Session 的 Files 是代码 Diff。 | 直接违反官方“不要自己上传，要求 Expert 修改”的交互；缺少树形层级、元数据、复制/下载和 Workspace；Session Files 名称冲突。 | 全局 Files 改为只读浏览器，侧栏拆分 Organization/User；删除直接编辑按钮，改为“在 Session 中请求修改”。补齐 Copy/Download/版本查看；Session 新增三 scope VFS，代码 Diff 改名 Changes。 |
| **Inferred** | 官方未给出版本历史的完整视觉，也未说明是否在同一详情页常驻。 | 同上 | 当前版本历史始终在文件预览下方。 | 视觉可继续优化。 | 保留版本时间线，但默认折叠；恢复操作生成带目标版本上下文的新 Session prompt，而不是客户端直接改数据。 |
| **Relay extension** | 审批共享文件写入、组织知识治理、保留策略配置属于 Relay 增强。 | 不适用 | 当前尚未形成独立治理策略。 | 后续真实开发需要解决组织文件污染和敏感数据风险。 | PRD 中增加 Organization scope 写入策略、审计、配额告警和管理员保留策略；原型先提供写入来源与版本归属。 |

### 3.9 Automations

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Automation 是外部 Event 与 Expert 的持久绑定。Trigger 位于 Expert 配置，一个 Expert 可有多个 Trigger；匹配后创建新 Session，并把原始 payload 作为首条消息。Automations 页面按 Expert + Triggers 展示，支持展开、暂停、删除和 Auto-archive。Event Log 展示所有来源事件和原始 payload/headers；Run History 展示 Trigger 启动的 Sessions。Subscription 由 Agent 在运行时创建，并把事件送入已有 Session。 | [Understanding Automation](https://docs.augmentcode.com/cosmos/automations)；[Managing Automations](https://docs.augmentcode.com/cosmos/manage-automations) | `/automations` 以单个 Automation 对象绑定一个 Expert 和一个 Trigger，支持创建 Wizard、启停和展开；另有 Event Log、Run History。Event Log 可注入 GitHub/Slack/Webhook 模拟事件并创建草稿 Session。 | Automation 与 Expert.triggers 存在双重配置风险；缺少一个 Expert 多 Trigger 展开、删除 Trigger、Auto-archive、headers/高级筛选；Subscription 只作为 Session Tab 展示。 | 后端以 Expert Trigger 为唯一配置源，Automations 页是聚合投影。补齐多 Trigger、Auto-archive、Event headers、JSONLogic 试验和 per-Expert Run History。Subscription 归 Session 运行时数据。 |
| **Inferred** | 官方推荐 Advisor 配置 Automation，但仍提供手动管理页面；创建 Wizard 的具体步骤和视觉未被文档规定。 | 上述页面；[Setting Up Automations with Advisor](https://docs.augmentcode.com/cosmos/automation-advisor) | 当前三步 Wizard：名称/Expert → 来源/事件/Filter → 确认，创建后默认暂停。 | Wizard 属于本地推导，但“先试运行再启用”符合官方 Advisor 分阶段语义。 | 保留手动 Wizard 作为高级入口，并优先提供“Ask Advisor”主操作；新 Trigger 默认关闭，试运行后再启用。 |
| **Relay extension** | 模拟事件注入、匹配解释、幂等测试和审批策略是 Relay 的开发/治理增强。 | 不适用 | Event Log 首屏包含模拟事件注入器。 | 测试工具与生产事件日志混在一起。 | 把注入器放入“Test event”对话框或开发模式，并清楚标记不会向外部系统写入。 |

### 3.10 Spaces

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Space 是 Sessions、Experts、Environments、Secrets、MCP Servers、Webhooks、Projects 等资源的边界。顶部 Space picker 支持搜索、切换和创建，选择持久化。每个组织有不可删除/重命名的 Default space。Space 可设置默认 Expert/Environment；Session Space 按 Manager → Expert → Selected Space → Daemon 推导。删除 Space 时资源必须迁移到其他 Space 或 Default。 | [Cosmos Spaces](https://docs.augmentcode.com/cosmos/spaces/overview)；[Managing Spaces](https://docs.augmentcode.com/cosmos/spaces/managing) | 侧栏 picker 使用两个硬编码 Space；`/spaces` 展示卡片并可切换。控制平面按 Space 过滤资源。卡片统计中 `experts` 实际使用 automation 数量。 | 缺少 Default、搜索、创建、重命名、默认值、成员/权限、资源移动、删除迁移预览；picker 数据与控制平面状态分离；统计错误。 | picker 直接读取 `state.spaces`，实现搜索/创建/持久化；增加不可变 Default；Space 详情显示资源和默认值；删除必须先预览并选择迁移目标；修正资源统计。 |
| **Inferred** | 官方没有规定独立 Spaces 管理页的卡片布局或全部权限界面。 | 上述页面 | 当前为卡片网格。 | 视觉是本地设计。 | 保留卡片或紧凑列表均可，优先呈现所有者、默认 Expert/Environment、资源数量和成员范围。 |
| **Relay extension** | Space 级审批政策、预算、并发额度和数据驻留是 Relay 企业治理增强。 | 不适用 | 当前尚未完整实现。 | 产品蓝图提到治理，但 Space 页面没有承载。 | 需求文档中作为后续版本，不阻塞本轮原型；不得与官方 Space 基础定义混为一谈。 |

### 3.11 Advisor

| 等级 | 官方事实或设计判断 | 来源 URL | 当前本地实现 | 差距 | 产品决策 |
| --- | --- | --- | --- | --- | --- |
| **Official** | Cosmos Advisor 是内置 Expert，通过会话配置 Cosmos：检查/引导 Integrations，创建或更新 Environments，部署/调整 Experts，配置 Automations，并分析 Session 数据。它只询问必要信息、确认计划、跨 Session 记住决策。Advisor 不能完成 OAuth，也不能代用户存储 Secret。 | [Cosmos Advisor](https://docs.augmentcode.com/cosmos/advisor/overview)；[Advisor Limitations](https://docs.augmentcode.com/cosmos/advisor/limitations) | 未挂载的 `CosmosHomePage` 内有 Advisor prompt 和固定模拟回复，但不会真正更改控制平面，也没有独立持久 Session。 | 当前是 Dashboard Chatbot 模拟，不是内置 Expert；固定回复会制造“已配置”的假象；缺少计划确认、工具调用、恢复和限制跳转。 | 把 Advisor 建模为不可删除的 Built-in Expert，启动后进入普通 Session detail。为其提供受控 control-plane tools，所有配置变更先显示 plan/diff 再确认；OAuth 和 Secret 返回人工操作链接。 |
| **Inferred** | 官方没有证明 Advisor 必须拥有独立首页面板；文档示例要求在 Expert 选择器中选择 Cosmos Advisor。 | [Cosmos Advisor](https://docs.augmentcode.com/cosmos/advisor/overview) | 当前 Home 组件把 Advisor 做成中心模块。 | 专用面板可能偏离真实入口。 | Home 可提供 Advisor 快捷入口和示例 prompt，但提交后必须创建/打开 Advisor Session，而不是在 Home 内维持另一套聊天状态。 |
| **Relay extension** | Advisor 对 Relay 审批、预算、合规政策和中国区集成给出诊断与配置建议，是 Relay 自有能力。 | 不适用 | 尚未实现。 | 需要与 Cosmos Advisor 的事实能力区分。 | 使用 `Relay Advisor` 品牌；底层沿用同一 Session/Expert/Tool Call 模型，并在 PRD 中单列可调用工具和权限边界。 |

## 4. 原型落地优先级

| 优先级 | 工作项 | 进入下一阶段的验收条件 |
| --- | --- | --- |
| **P0** | Home + New Session | `/home` 可达；选择 Expert、输入任务、添加附件后创建 Session；不再强制重复选择 Expert 已绑定的 Environment/Repository。 |
| **P0** | Sidebar | 官方已证实的 Space picker、New Session、Sessions、Pinned/Recent、Files、Automations 层级稳定；Relay 扩展单独分组。 |
| **P0** | Session detail | 对话优先；支持排队消息、附件、Slash Command、Enhance、Share、Artifacts、Worker tree；Changes 与 Files 语义分开。 |
| **P0** | Files | 全局 Organization/User 树和 Session Workspace/User/Organization 树可交互；移除直接编辑，改为通过 Expert 修改。 |
| **P1** | Experts | Managed Template 与 Custom Expert 分流；模板基础 prompt 不可直接改写；Environment 使用真实 ID。 |
| **P1** | Environments | 补齐 Repositories、Variables、Hooks、Terminal/Update；Cloud 与 Daemon 关系清晰。 |
| **P1** | Automations | 统一 Expert Trigger 数据源；Automations/Event Log/Run History 可串联；创建后默认暂停。 |
| **P1** | Spaces | 使用真实状态驱动 picker；支持 Default、搜索、创建和资源迁移预览。 |
| **P1** | Advisor | 作为内置 Expert 启动真实 Session；所有配置操作提供 plan、确认和结果证据。 |
| **P2** | Sessions 管理增强 | Pin/文件夹/排序、Artifact 搜索、可见性和 Share 完整；批量管理保持 Relay 扩展定位。 |

## 5. 对后续需求文档的约束

1. 前端 PRD 的每个页面必须标注 `Official`、`Inferred` 或 `Relay extension`，并链接到本矩阵对应条目。
2. 后端领域模型必须以 `Space → Expert → Environment → Session → Turn/ToolCall` 为主链，以 `Trigger/Event/Subscription` 和 `File/Artifact` 为旁路对象，不再用单一 `Run` 对象承载全部语义。
3. Template Expert 必须区分托管基础配置与团队追加配置；不能只保存一个可任意覆盖的 prompt 字段。
4. Files 的写入必须来自 Agent tool call 并保留版本和归属；前端不能直接绕过 Session 修改共享文件。
5. Automation 的唯一配置源是 Expert Trigger；Automations 页面是查询投影，不建立重复的独立规则副本。
6. Relay 扩展能力可以优先落地，但必须有独立命名、权限和审计模型，不能借用“Cosmos 原版”作为未经证明的设计依据。

## 6. 官方资料索引

- [Getting Started with Cosmos](https://docs.augmentcode.com/cosmos/getting-started)
- [Using Sessions](https://docs.augmentcode.com/cosmos/sessions-overview)
- [Experts](https://docs.augmentcode.com/cosmos/experts)
- [Template Experts](https://docs.augmentcode.com/cosmos/experts-templates)
- [Configure a Custom Expert](https://docs.augmentcode.com/cosmos/experts-configure-custom)
- [Cosmos Environments](https://docs.augmentcode.com/cosmos/environments/overview)
- [Cloud Environments](https://docs.augmentcode.com/cosmos/environments/cloud)
- [Self-hosted Environments](https://docs.augmentcode.com/cosmos/environments/daemons)
- [Understanding Files](https://docs.augmentcode.com/cosmos/understanding-files)
- [Understanding Automation](https://docs.augmentcode.com/cosmos/automations)
- [Managing Automations](https://docs.augmentcode.com/cosmos/manage-automations)
- [Cosmos Spaces](https://docs.augmentcode.com/cosmos/spaces/overview)
- [Managing Spaces](https://docs.augmentcode.com/cosmos/spaces/managing)
- [Cosmos Advisor](https://docs.augmentcode.com/cosmos/advisor/overview)
- [Advisor Limitations](https://docs.augmentcode.com/cosmos/advisor/limitations)
- [Understanding Artifacts](https://docs.augmentcode.com/cosmos/artifacts)
- [Delegating Work](https://docs.augmentcode.com/cosmos/workers-subagents)
