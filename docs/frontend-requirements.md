# Cosmos 前端工程与交互需求

> 文档状态：研发基线（Draft for implementation）  
> 版本：1.2
> 日期：2026-07-13
> 上游产品合同：[product-requirements.md](./product-requirements.md)  
> 证据基线：[cosmos-evidence-matrix.md](./cosmos-evidence-matrix.md)

## 1. 目的与适用范围

本文约束 Cosmos Web 客户端的路由、组件边界、状态管理、视觉系统、交互、错误状态、可访问性和测试。当前 React 原型是迁移起点，不是目标架构的事实来源；实现与 PRD 冲突时以 PRD 和证据矩阵为准。

## 2. 当前技术基线

| 项目 | 当前选择 | 本阶段决策 |
| --- | --- | --- |
| Runtime | Node.js >=22.13 | 保持；与 pnpm 11.7.0 的最低运行版本一致 |
| UI | React 19 + TypeScript 5.9 | 保持 |
| Router | React Router 7 | 保持；建立规范 route config |
| Build | Vite 8 | 保持 |
| Unit/Integration | Vitest + Testing Library | 保持并补足关键流程 |
| Icons | Lucide React；存在少量 react-icons | 新增 UI 优先 Lucide，同一语义只保留一套图标 |
| Styling | 单一 `src/styles.css` | 原型可渐进整理为 tokens/shell/features，不进行无关重写 |
| State | React state/context + localStorage | UI 状态本地；领域状态通过 repository/service 接口，localStorage 仅作原型适配器 |

### 2.1 工程原则

- 页面不直接操作存储；通过 feature service/repository 读取和写入领域对象。
- Server/domain state、URL state、form state、ephemeral UI state 分开管理。
- 不再扩大单一 `Run` 类型；使用 Session/Turn/ToolCall/Attempt/Artifact view model，并在迁移层适配旧 mock。
- 同一动作只有一个业务 handler；Home、Sidebar、Sessions 和 Cmd+K 共用 Session launcher/controller。
- 异步写操作必须有 idle/submitting/succeeded/failed 状态和幂等标识。
- 先实现明确需求，不提前引入状态框架或设计系统依赖；出现跨三个以上页面的真实重复后再抽象。

### 2.2 当前实现边界

| 范围 | 当前事实 | 状态 | 生产缺口 |
| --- | --- | --- | --- |
| Session 列表、创建与详情 | `getMe` 发现 actor 的 Organization/Space membership；list/create/get/rename/archive/restore/start/send 与 pause/resume/cancel/retry 使用当前合法 scope；生产列表用服务端 cursor、搜索和状态筛选增量读取当前或归档记录；详情规范路由为 `/sessions/:sessionId`，直刷读取单资源 API，旧 `/runs/:id` 重定向；Web 已接 OIDC Code + PKCE、Bearer、401 失效和生产 fail-closed | **Partial** | Pin 与分享控制仍未接 Web；真实 IdP E2E 待配置 |
| 创建失败恢复 | Home 和 Dialog 等待 API 确认，失败保留输入，同一草稿重试复用幂等 key | **Implemented** | 幂等 key 仅存在内存；页面刷新后的安全恢复尚未实现 |
| Session 视图模型 | 生产列表仍使用无执行推测的最小 `Run` 兼容投影，并开放服务端重命名、归档和恢复；生产详情直接渲染 canonical `SessionDto` 和 Message/Event timeline，凭据轮换立即隔离旧详情；demo 数据使用独立 `cosmos.demo.sessions` key | **Partial** | 列表仍需迁移为原生 Session read model；Pin、分享和 Artifact 摘要必须接入服务端 API 后才可开放 |
| Experts/Environments 查询 | 生产模式使用 tenant-scoped Catalog list/detail API，支持分页聚合、身份切换清屏、401 闭锁、只读详情和 Expert 启动入口；demo 模式保留本地编辑原型 | **Implemented (limited)** | 无创建、编辑、发布、重新配置、审计或 service-account policy |
| Files | 生产模式的 Organization/User 与 `/sessions/:sessionId/files` Workspace 路由使用 tenant-scoped API，提供服务端搜索、分页树、文本预览、鉴权 Blob 下载、内容/路径复制、不可变版本和请求 Session 修改；Workspace 查询精确绑定当前 Session，凭据/Space/scope 变化会隔离旧投影；无上传、编辑、删除或客户端恢复入口 | **Implemented (limited)** | provider 到 ToolCall/File 写入编排、binary 内联预览与对象存储容量证据 |
| 其他控制面 | Daemon、Repository、Integration、MCP、Webhook、Secret、Space、Automation 与 Approval 仍是 seed/本地交互，仅在 demo 模式可达；生产导航、命令面板和直达路由均不暴露原型操作 | **Prototype** | 逐域接入权威 API、权限和审计后再加入 production capability allowlist |
| Session 工作台 | demo 模式保留阶段、事件、Diff、Terminal、Approval 演示；生产详情显示服务端 Session metadata、配置 revision、Message/Attempt/Session/ToolCall/Approval 事件，按 execution capability 开放 draft start、幂等 follow-up composer 与执行生命周期控制，并通过 Conversation/Files/Workers 页签进入精确 Session Workspace 与父子 Worker tree；失败保留输入，成功后合并权威 Message | **Partial** | 独立 Tool/Changes/Terminal、附件和 Artifact 详情流程仍需服务化后才能开放 |
| 身份与权限 | Web 已实现 OIDC Code + PKCE、内存 token、`/me` discovery、合法 Space 选择、空权限/错误状态；API 已校验 token、membership 与 Organization/Space 角色交集 | **Partial** | 缺少细粒度 operation policy、真实 IdP E2E、前端 403 恢复和服务端实时权限变更通知 |

前端显示一个功能不等于该功能已实现。除 Session 创建、列表、单资源读取、重命名、归档/恢复、draft start 和 follow-up send 明确接入 API 的部分外，当前控制面默认按 Prototype/Simulation 处理。

## 3. 路由与页面合同

| ID | Route | 页面 | 来源等级 | 前端合同 |
| --- | --- | --- | --- | --- |
| FE-R01 | `/` | Root | **Inferred** | `replace` 到 `/home`，不产生历史栈回跳 |
| FE-R02 | `/home` | Home | **Official** | Expert picker、composer、附件、最近 Session；品牌点击进入 |
| FE-R03 | `/sessions` | Sessions | **Official** + **Inferred** | 当前/归档列表、搜索、Pin、visibility、Artifact 摘要 |
| FE-R04 | `/sessions/:sessionId` | Session detail | **Official** + **Cosmos extension** | 持续会话；旧 `/runs/:id` 仅兼容重定向/适配 |
| FE-R05 | `/files/organization` | Organization Files | **Official** | 只读树、预览、版本、复制/下载、请求修改 |
| FE-R06 | `/files/user` | User Files | **Official** | 与 Organization 相同交互但 scope 固定为当前用户 |
| FE-R07 | `/experts` | Experts | **Official** + **Inferred** | Managed/Custom 分段、搜索、状态与启动入口 |
| FE-R08 | `/experts/:expertId` | Expert detail/editor | **Official** + **Cosmos extension** | 类型决定只读/可编辑字段；revision 管理 |
| FE-R09 | `/environments` | Environments | **Official** + **Inferred** | Cloud/Self-hosted 分段与统一状态 |
| FE-R10 | `/environments/:environmentId` | Environment detail | **Official** | Overview、Repositories、Variables、Hooks、Terminal、History |
| FE-R11 | `/automations` | Automations | **Official** | Expert → Triggers 聚合，不维护第二份规则 |
| FE-R12 | `/automations/events` | Event Log | **Official** | payload/headers、匹配解释、Session 链接 |
| FE-R13 | `/automations/history` | Run History | **Official** | Trigger 创建 Session 的查询视图 |
| FE-R14 | `/spaces` | Spaces | **Official** + **Inferred** | Default、创建、默认值、迁移预览 |
| FE-R15 | `/approvals` | Cosmos Approvals | **Cosmos extension** | 按权限条件显示 |
| FE-R16 | `/settings` | Settings | **Cosmos extension** | 个人、主题、语言、组织管理入口 |

未知路由重定向 `/home`；不存在/无权限的资源必须区分 `404` 与 `403`，不能统一静默跳转。

## 4. App Shell 与导航

### 4.1 侧栏顺序

来源：[证据矩阵 Sidebar](./cosmos-evidence-matrix.md#32-sidebar)。

1. 品牌（点击 Home，不显示额外 Home 菜单项）— **Inferred**。
2. Space picker — **Official**。
3. New Session — **Official**。
4. Sessions — **Official**。
5. Pinned Sessions（文件夹/折叠为 P2）— **Official**。
6. Recent Sessions — **Official**。
7. Files：Organization、User — **Official**。
8. Automations：Overview、Event Log、Run History — **Official**。
9. Experts、Environments 是核心资源入口；Settings 下的 Capabilities / Integrations、Personal / Linked Accounts 与 Webhooks 层级有官方文档证据。不存在足够证据支持一个包含所有项目的 Configuration 侧栏组；生产导航只开放已有生产 API 的入口。
10. Governance/Approvals 与偏好 — **Cosmos extension**，视觉上单独分组。

### 4.2 布局要求

| ID | 要求 |
| --- | --- |
| FE-SH01 | 桌面侧栏宽 240px，折叠 56px；主区 `minmax(0, 1fr)`，不得横向挤出视口 |
| FE-SH02 | 侧栏 grid/flex 行必须与可见区块数量一致；New Session 不得占用可伸缩导航行 |
| FE-SH03 | Pinned/Recent 位于配置导航之前且独立滚动策略明确；账户区固定底部 |
| FE-SH04 | <=820px 侧栏为 modal drawer，带 scrim、focus trap、Escape 关闭和关闭后焦点恢复 |
| FE-SH05 | 触屏不应用粘滞 hover；hover 视觉仅放在 `@media (hover: hover) and (pointer: fine)` |
| FE-SH06 | 折叠后使用图标 + tooltip；tooltip 不可遮挡主操作且键盘聚焦可读 |
| FE-SH07 | 路由 active 只对应一个主导航项；Overlay 打开不改变底层 route active 状态 |

## 5. 组件边界

```text
AppShell
├── Sidebar
│   ├── SpacePicker
│   ├── SessionNavigation
│   └── ConfigurationNavigation
├── RouteOutlet
├── SessionLauncher (shared overlay/route content)
├── CommandPalette
├── ToastRegion
└── GlobalErrorBoundary
```

| 组件/Feature | 责任 | 禁止事项 |
| --- | --- | --- |
| `SessionLauncher` | Expert 选择、prompt、附件、visibility、启动状态 | 不直接拼装持久 `Run`；不重复选择 Expert 已绑定配置 |
| `SessionTimeline` | 渲染 message/agent/tool/result/approval 事件 | 不展示隐藏推理；不依赖固定六阶段 |
| `SessionComposer` | queue、slash command、attachment、enhance、send | 不在发送失败后清空输入 |
| `ArtifactPanel` | Artifact 列表、状态和外链 | 不从自由文本临时解析作为唯一来源 |
| `WorkerTree` | 父子 Session/Worker 状态和跳转 | 不用平铺事件伪装层级 |
| `FileBrowser` | scope、树、预览、版本、复制/下载 | 不提供直接编辑/上传/删除共享文件 |
| `ChangesView` | Diff、变更文件和验证证据 | 不命名为 Files |
| `ExpertEditor` | 按 Expert 类型渲染字段与 revision | Managed template 基础 prompt 不可编辑 |
| `EnvironmentEditor` | spec、provisioning、terminal、history | Enterprise policy 与基础 spec 分组 |
| `TriggerEditor` | 写 Expert trigger，试运行/启停 | 不维护独立 Automation 副本 |

## 6. 页面和交互需求

### 6.1 Home 与 Session launcher

来源等级：**Official**（核心行为）、**Inferred**（布局/overlay）、**Cosmos extension**（高级工程选项）。

| ID | 需求 |
| --- | --- |
| FE-H01 | Home 第一视口必须出现当前 Space、Expert picker、launch guidance、prompt composer 和启动按钮 |
| FE-H02 | 最近 Session 放在 launcher 之后；健康/审批/自动化摘要若保留，必须为次要 Cosmos 区域 |
| FE-H03 | Sidebar、Home、Experts、Files“请求修改”和 Cmd+K 调用同一 `openSessionLauncher({ expertId?, prompt?, context? })` |
| FE-H04 | prompt 必填；标题由首条 prompt 生成；用户后续可重命名 |
| FE-H05 | Expert 改变时只读摘要同步更新，Environment/Repository 不出现可误覆盖的默认字段 |
| FE-H06 | 附件支持按钮、拖放和粘贴；显示名称、类型、大小、上传状态、移除操作和限制文案 |
| FE-H07 | Enter 发送、Shift+Enter 换行只在 IME composition 结束后生效；中文输入法不得误提交 |
| FE-H08 | Enhance 显示可审阅结果，用户确认后替换/追加；不能直接静默修改 prompt |
| FE-H09 | 启动按钮防重复点击；pending 时可见，成功只导航一次，失败保留全部输入 |

### 6.2 Sessions

| ID | 需求 |
| --- | --- |
| FE-SE01 | URL 保存主要 view/query/filter，使刷新和分享链接可恢复；纯选择/菜单状态不写 URL |
| FE-SE02 | 列表显示 title、Expert、visibility、status、source、Artifact、updatedAt；状态优先级不改变真实时间排序的可理解性 |
| FE-SE03 | Pin 与 Archived 是独立属性；Archived 默认不出现在 Recent/Pinned 活跃区 |
| FE-SE04 | 搜索输入 200–300ms debounce；结果包含 Artifact/branch/Issue/link；加载中保持行高稳定 |
| FE-SE05 | Empty 区分“没有 Session”“当前过滤无结果”“无权限”；每种只给相关下一步 |
| FE-SE06 | 普通用户菜单不含永久删除；归档/恢复可撤销并有 toast |
| FE-SE07 | 表格在宽屏使用稳定 grid columns；窄屏转换为行式列表，不通过缩小字体强塞列 |

### 6.3 Session detail

| ID | 需求 |
| --- | --- |
| FE-SD01 | 主区域为 Conversation；Header 包含 Expert、visibility、Share、Session 状态和条件式运行控制 |
| FE-SD02 | Timeline 使用稳定 ID key；流式更新只更新目标 event，不重挂载整个页面 |
| FE-SD03 | Tool Call 默认摘要，支持展开 input/output/permission/error；敏感字段遮蔽 |
| FE-SD04 | Agent 工作时发送内容进入可见队列；支持取消单条 queued message；顺序由服务端确认 |
| FE-SD05 | Tabs/secondary views 至少包括 Conversation、Files、Artifacts、Workers；Changes、Terminal、Approvals 按数据条件出现 |
| FE-SD06 | Retry 创建新 Attempt 并保留旧 Attempt；页面明确当前 Attempt，不就地覆盖失败历史 |
| FE-SD07 | Share dialog 显示 Private/Space 语义、成员影响和权限错误；关闭后恢复触发按钮焦点 |
| FE-SD08 | 离线/断线时 composer 可保留 draft，但未经确认的消息不得显示为已发送 |

### 6.4 Files 与 Changes

| ID | 需求 |
| --- | --- |
| FE-FI01 | 全局 Files route 固定 Organization/User scope；Session Files 增加 Workspace scope |
| FE-FI02 | 树节点有层级、展开、路径、大小、更新时间、last writer；键盘支持方向键/Enter |
| FE-FI03 | 预览处理 text/image/unsupported/binary/too-large 状态；unsupported 提供 download，不显示乱码 |
| FE-FI04 | Copy path/content 有成功/失败反馈；Clipboard 不可用时提供可选择文本 |
| FE-FI05 | Version history 默认折叠；选择旧版只读预览；“恢复”打开带版本上下文的 Session launcher |
| FE-FI06 | “请求修改”是唯一普通用户修改入口；当前代码的 create/edit/delete/restore UI 必须移除或仅在 dev fixture 中存在 |
| FE-FI07 | Changes 显示文件状态、增删行、Diff 与验证；不复用 Files 路由或 File scope 文案 |

### 6.5 Experts

| ID | 需求 |
| --- | --- |
| FE-EX01 | 列表明确标识 Built-in、Managed Template、Custom，不把公开 Workflow 目录全部标为 Cosmos Template |
| FE-EX02 | Managed Template 显示只读基础配置、upstream version 和团队追加区；Custom 显示完整编辑器 |
| FE-EX03 | Environment selector 使用 ID；失效/禁用引用显示阻断问题与修复入口 |
| FE-EX04 | 保存 draft、校验、dry run、发布 revision、禁用和归档状态明确；离开 dirty form 前确认 |
| FE-EX05 | Trigger 在 Expert 内编辑；Automations 页只读同一对象投影 |
| FE-EX06 | 从 Expert 启动 Session 时预选该 Expert，并仍允许用户确认/更换 |

### 6.6 Environments、Automations、Spaces、Advisor

| ID | 需求 |
| --- | --- |
| FE-CP01 | Environment 表单覆盖 image/repositories/variables/hooks/sharing/network；Secret value 只接受引用，不回显 |
| FE-CP02 | Provisioning 使用阶段、progress、message、updatedAt；失败提供日志摘要和 Retry |
| FE-CP03 | Terminal 明确连接状态、只读/可写和 Update Environment 操作；原型模拟必须标记 |
| FE-CP04 | Automations 按 Expert 可展开多个 Trigger；启用前提供 Test event；新建默认 disabled |
| FE-CP05 | Event Log payload/headers 使用结构化 viewer，支持 copy、过滤和 Session 跳转；重复事件有明确标签 |
| FE-CP06 | Space picker 直接读取领域状态，支持搜索/创建并持久选择；切换时清理旧 scope 临时状态 |
| FE-CP07 | 删除 Space 使用影响预览 + 迁移目标 + 二次确认；Default 操作禁用并说明原因 |
| FE-CP08 | Advisor 提交后创建/打开普通 Session；Home 不维护第二套独立聊天记录 |
| FE-CP09 | Advisor plan/diff 使用明确确认控件；OAuth/Secret 步骤为人工 action required，不伪造成功 |

## 7. 状态管理和数据契约

### 7.1 状态分类

| 状态类型 | 示例 | 所属位置 |
| --- | --- | --- |
| URL state | Sessions tab/query/filter、Files scope、detail subview | Router/search params |
| Domain/server state | Sessions、Turns、Experts、Files、Events | Feature repository + query cache/订阅层 |
| Form state | prompt、Expert draft、Environment wizard | 组件/feature form hook |
| Ephemeral UI | popover、drawer、selected row、toast | 最小局部 state |
| Preference | theme、locale、sidebar collapsed、pinned folder collapse | Preference service/localStorage |

### 7.2 原型适配要求

- `cosmos.sessions`、`cosmos.experts`、`cosmos.controlPlane.v1` 可作为临时 repository adapter，不得被页面直接读取。
- schema 包含 `version`；解析失败使用只读备份/seed 并告知用户，不静默覆盖损坏数据。
- 从 `favorite` 到 `pinned`、从 `Run` 到 `Session` 的迁移必须是幂等函数并有测试。
- mock timers、随机 ID 和模拟网络状态必须可注入/可确定，保证测试稳定。
- Space 过滤在 repository/service 层完成；页面不能各自推断 Space。

### 7.3 API/异步约定

- 所有写请求携带 idempotency key/correlation ID。
- 错误对象至少包含 `code`、`message`、`retryable`、`fieldErrors?`、`correlationId?`。
- 列表接口支持 cursor/page、filter、sort；实时事件包含 entity ID 和 monotonic sequence/version。
- UI 仅在可安全回滚时乐观更新；创建 Session、审批、Trigger 启用和 Space 迁移必须等待服务端确认。

### 7.4 服务端权威与离线投影

- 服务端 ID、scope、visibility、status、version 和 timestamp 为权威值；前端不得在写入成功后重新推导它们。
- localStorage 只能保存主题、语言、侧栏、Pin 等账户 UI 偏好，不能作为 Session、Expert、Environment、Approval 或权限的最终数据源。
- 如需离线缓存，必须使用包含 schema version、actor ID、organization ID、space ID 和 server version 的独立存储；退出登录和切换 Organization 时清除敏感投影。
- 对领域写入不做“本地成功、后台同步”；可安全乐观更新的偏好类操作也必须在后端拒绝时回滚。
- 后台刷新保留上次有权数据时，必须同时标记 stale；401/403 后不得继续显示已失效的私密内容。

## 8. 视觉系统

### 8.1 设计方向

- 安静、高密度、可扫描；使用行、分隔线和未装饰布局，不堆叠 Dashboard 卡片。
- 中性灰/黑白为基础，绿色只用于主操作、活动和确认；状态使用独立语义色。
- 不使用渐变、装饰性光斑、巨大标题或营销式 Hero。
- Card 圆角不超过 8px；页面 section 不作为浮动 card，modal 和重复实体可使用 card。
- 页面内不嵌套 card；固定格式控件使用稳定尺寸和响应式约束。

### 8.2 Token 要求

至少定义并在 Light/Dark 下成对验证：

- Canvas/navigation/surface/elevated/hover/background overlay。
- Text primary/secondary/muted/inverse。
- Border/subtle/strong/focus。
- Brand/success/warning/danger/info 及其背景色。
- Spacing 4/8/12/16/24/32；radius 3/5/8；control heights 28/32/36/40。

禁止 feature 组件新增无语义散落色值；临时例外必须带注释和后续 issue。

### 8.3 字体和图标

- 字体栈覆盖 Latin 和中文；不按 viewport 缩放字体；letter-spacing 为 0。
- 页面 H1、panel heading、row title 采用不同固定级别，紧凑面板不得使用 hero 字号。
- 图标按钮优先熟悉符号；有 Lucide 图标时不手绘 SVG；不熟悉图标必须 tooltip + accessible label。
- 同一动作在 Sidebar、Header、Menu 中使用同一图标语义。

## 9. 响应式要求

| 视口 | 布局要求 |
| --- | --- |
| >=1280px | 固定侧栏；Session 可使用主时间线 + 右侧 inspector；表格完整列 |
| 821–1279px | 固定/可折叠侧栏；inspector 可变 drawer；列按优先级隐藏 |
| 601–820px | 侧栏 modal drawer；单主列；toolbar 可换行但按钮尺寸稳定 |
| 390–600px | 行式列表；底部/全屏 dialog；主要命令常驻，次要操作进 menu |
| <390px | 最低支持 320px；允许纵向滚动，不允许核心控件横向溢出或文字互相遮挡 |

必须以 390x844、768x1024、1024x768、1440x900、1920x1080 做截图验收，并覆盖最长中英文文案。

## 10. 加载、空、错误和权限状态

每个远程页面都必须有以下状态，且固定内容尺寸避免布局跳动：

| 状态 | 显示要求 |
| --- | --- |
| Initial loading | 与最终行/面板结构一致的 skeleton；无整页无限 spinner |
| Background refresh | 保留旧数据，局部状态提示；不得清空页面 |
| Empty | 说明为何为空，并给唯一相关下一步；过滤无结果与真实空数据分开 |
| Partial error | 其他可用区继续工作；失败区提供 retry 和 correlation ID |
| Fatal error | Error boundary，提供重试/回 Home，不暴露 stack |
| 401 | 引导重新认证并保留安全 return path |
| 403 | 显示所需权限/角色，不伪装 404（敏感资源例外由后端策略决定） |
| 404 | 资源不存在/已迁移，提供返回所属列表 |
| Conflict/stale | 显示服务端新版本，允许 reload 或人工合并，不静默覆盖 |
| Simulation | 操作前、进行中和结果处均可识别为模拟 |

## 11. 可访问性与键盘

| ID | 要求 |
| --- | --- |
| FE-A11Y01 | 所有 icon-only button 有 `aria-label`；tooltip 不是唯一名称来源 |
| FE-A11Y02 | Dialog 有语义 role、标题/描述、focus trap、Escape、backdrop 行为和焦点恢复 |
| FE-A11Y03 | Menu/listbox/combobox/tab/tree 使用对应 ARIA pattern，不用普通 div 模拟 |
| FE-A11Y04 | 动态状态通过 `aria-live` 适度播报；流式 token 不逐字符打扰读屏 |
| FE-A11Y05 | 对比度达到 WCAG AA；focus ring 在两主题可见；状态包含文字/图标 |
| FE-A11Y06 | 支持 `prefers-reduced-motion`；动画关闭后不影响完成状态 |
| FE-A11Y07 | Cmd+K、New Session、发送、关闭等快捷键不得覆盖浏览器/输入法关键行为 |

## 12. 前端安全要求

- 所有外部 URL 使用允许协议；新窗口带 `noopener noreferrer`，并明确外部导航。
- Markdown/HTML、Tool output、Event payload 和 Diff 视为不可信输入，渲染前净化/转义。
- Secret 仅显示引用/末四位；禁止写入 localStorage、URL、analytics、error report。
- Clipboard、download、file preview 校验内容类型和大小；禁止执行上传内容。
- 权限控制以后端为准；隐藏按钮仅改善体验，不构成授权。
- 不在客户端日志记录完整 prompt、附件、payload 或私密 Session 内容。

## 13. 前端验收和测试要求

### 13.1 自动化层级

| 层级 | 必测内容 |
| --- | --- |
| Unit | title 生成、URL/Artifact 解析、状态映射、schema migration、Space scope、权限 predicate |
| Component | SessionLauncher、Composer queue、FileBrowser、Expert type fields、Environment state、dialogs/menus |
| Route integration | root/Home、Sessions URL state、Session resume、403/404、Space switch、legacy redirect |
| E2E | Home→Session；queue→resume；Files request change；Expert publish→launch；Trigger event→Session；Space migration |
| Accessibility | axe/语义查询 + 全键盘脚本；两主题 focus/contrast 人工检查 |
| Visual | 指定 5 个视口 × Light/Dark × 中/英的关键页面截图；无非预期 diff |

### 13.2 必须防回归的用例

1. 侧栏区块数量变化不会再次产生大面积空白、隐式 grid 行或导航越界。
2. Home 不出现未经证实的 Sidebar “Home”文字项，品牌和 `/` 均可到达 Home。
3. 同时存在多个 New Session 入口时只挂载一个 launcher、只创建一个 Session。
4. 切换主题/语言不会闪回默认值或出现不完整 token。
5. 触屏点击不会留下 sticky hover；drawer 关闭后主页面恢复交互。
6. Agent 流式事件更新不改变列表 key，不重置 composer/scroll/focus。
7. Files 无直接编辑入口，Changes 与 Files 文案和路由不混用。

### 13.3 前端 Definition of Done

- 需求 ID 与 PR/测试用例相互链接。
- TypeScript、ESLint、Vitest、build 全通过；无新增 console error/warning。
- 关键异步状态、错误、空状态、权限状态均实现。
- 完成键盘、读屏语义、两主题、双语和 5 视口验收。
- 视觉截图由产品/设计确认；无重叠、截断、布局跳动或不可读 tooltip。
- Simulation 有明确标记；未实现后端能力不伪装成功。
- 更新迁移说明、测试 fixture 和相关文档；不遗留无 owner 的 TODO。

### 13.4 生产 Web 发布门槛

| ID | 门槛 | 验收证据 |
| --- | --- | --- |
| FE-GA01 | 身份会话安全 | OIDC 登录/登出、token 刷新、安全 return path、超时与撤销的 E2E；不在 localStorage 存 access token |
| FE-GA02 | 权限边界 | 每个受限 route/action 有 allowed/403/revoked 测试；快速 Space 切换不泄漏上一 scope 内容 |
| FE-GA03 | 真实领域数据 | P0 旅程不以 seed/localStorage 产生成功结果；所有 Simulation 入口在生产 build 禁用或持续可识别 |
| FE-GA04 | 错误与恢复 | 断网、5xx、429、超时、契约错误、版本冲突和 SSE 重连有自动化用例；用户输入不丢失 |
| FE-GA05 | 安全渲染 | Markdown、Tool output、Diff、Event payload、URL 和附件预览经过恶意 fixture 测试；CSP 无高风险例外 |
| FE-GA06 | 性能 | 目标客户数据量下 Core Web Vitals 按 p75 验收；Sessions/事件/文件长列表无无界 DOM 增长 |
| FE-GA07 | 可访问性与视觉 | WCAG 2.2 AA 自动 + 人工验收；Light/Dark、中/英、5 视口的核心页面无 P0/P1 视觉回归 |
| FE-GA08 | 观测与隐私 | 前端错误和旅程指标含 release/request ID；采集 allowlist 经隐私审查，不上报 prompt、Secret、附件和私密 payload |

生产发布还必须同时满足 [产品 GA 门槛](./product-requirements.md#122-生产发布ga)、[生产架构基线](./production-architecture.md) 和 [数据/权限/Session 生命周期](./data-model-permissions-session-lifecycle.md)。
