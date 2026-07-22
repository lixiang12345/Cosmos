# Cosmos Design Philosophy

提炼自官方文档 [docs.augmentcode.com](https://docs.augmentcode.com)（尤其 `/cosmos/*`、`/introduction`）、产品 UI 与 marketing。  
本文件是原型的「神」——界面与交互应服从这些原则，而不是反过来堆功能。

主要依据：

| 文档 | 设计意图 |
|------|----------|
| [Getting Started](https://docs.augmentcode.com/cosmos/getting-started) | 核心概念表：Expert / Environment / Capability / Trigger / Session / Automation / Files |
| [Experts](https://docs.augmentcode.com/cosmos/experts) | Expert = 可复用工作流产品表面，不是一次性 prompt |
| [Automations](https://docs.augmentcode.com/cosmos/automations) | Automation = 事件 → Expert 的 standing order；Triggers vs Subscriptions |
| [Environments](https://docs.augmentcode.com/cosmos/environments/overview) | Cloud sandbox vs self-hosted daemon |
| [Spaces](https://docs.augmentcode.com/cosmos/spaces/overview) | 团队/工作流边界：所见即所用 |
| [Sessions](https://docs.augmentcode.com/cosmos/sessions-overview) | Expert + Environment 交汇处；人机协作现场 |
| [Workers / Subagents](https://docs.augmentcode.com/cosmos/workers-subagents) | 三种委托：Worker / Subagent / Expert-to-Expert |
| [Advisor](https://docs.augmentcode.com/cosmos/advisor/overview) | 对话配置四阶段；默认 disarmed |
| [Files](https://docs.augmentcode.com/cosmos/understanding-files) | 跨 Session 组织记忆；User vs Org VFS |
| [Code Review Pipeline](https://docs.augmentcode.com/cosmos/experts-code-review) | 专用小队 + 人在判断点的标杆场景 |
| [Manage Automations](https://docs.augmentcode.com/cosmos/manage-automations) | Events log / Run history / Pause without delete |
| [Artifacts](https://docs.augmentcode.com/cosmos/artifacts) | Session 的耐久产出：PR / Branch / Linear / Link |

---

## 1. 产品命题（Product thesis）

> **Your engineers have agents. Your organization doesn't.**  
> Cosmos closes that gap.

| 命题 | 官方表述 |
|------|----------|
| **Cloud agents, not IDE-only** | Agents 在云端沙箱 VM 里跑，读 repos、执行工具，被 GitHub / Slack / Linear / PagerDuty / webhook / cron 唤醒。入口：webapp、手机浏览器、Slack。 |
| **OS, not chatbot** | 不是单一 agent，也不是纯 workflow 引擎，而是 **Experts + Environments + Automations + Files + Humans** 的编排系统。 |
| **Agentic full SDLC** | 内置 fleet：triage → author → risk → deep/pair review → verify → memory；覆盖 build / review / ship。 |
| **Productivity compounds** | 「一个 AI-forward 工程师打磨的 Expert 分享给组织后，全员都能开出同样质量的 session」——个体增益变成组织默认。 |

官网四能力（同一哲学的四个杠杆）：

1. **Prism** — 每 turn 选对模型（质量 / 成本）  
2. **Model choice / BYOK** — 不锁死供应商  
3. **Context Engine** — 结构化上下文，少 token、同质量  
4. **Shared experts + memory** — 团队最佳实践变成组织默认  

---

## 2. 架构核心：七个一等公民

文档 [Getting Started](https://docs.augmentcode.com/cosmos/getting-started) 把 Cosmos 拆成这些 building blocks。**UI 信息架构必须让用户感知到它们是独立、可配置、可共享的实体。**

```
                    ┌─────────────────────────────────────┐
                    │              Space                  │  团队边界（所见即所用）
                    │  Experts · Envs · Sessions · Secrets│
                    │  MCP · Webhooks · Projects          │
                    └─────────────────────────────────────┘
                                      │
         ┌──────────────┬─────────────┼──────────────┬──────────────┐
         ▼              ▼             ▼              ▼              ▼
    ┌─────────┐   ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────┐
    │ Expert  │──▶│Environment│  │ Session  │  │Automation │  │ Files  │
    │ (行为)  │   │ (算力/VM) │  │ (对话)   │  │(standing  │  │ (记忆) │
    └────┬────┘   └──────────┘  └────┬─────┘  │  order)   │  └───┬────┘
         │                           │        └─────┬─────┘      │
         │  Capabilities / MCP       │              │            │
         │  Triggers / Workers       │◄── 打开 ─────┘            │
         │  Visibility               │  (事件 payload = 首条消息) │
         └───────────────────────────┴──────────────────────────┘
                     Session 右栏：Artifacts · Workers · Files(Workspace)
```

### 2.1 Expert — 可复用工作流产品表面

> *「packages the workflow instructions, integrations, runtime environment, model, launch guidance, workers, and triggers that make a repeatable engineering workflow feel like a **product surface** instead of a one-off prompt.」*

一个 Expert 打包：

| 字段组 | 内容 | UI 落点 |
|--------|------|---------|
| **Identity & sharing** | 名称、描述、visibility、stable ID | Experts 表 / Share 弹窗 |
| **Instructions** | system prompt、default system prompt、user-facing instructions、placeholder | Expert detail → System |
| **Model** | 默认模型 + 可替换 managed 备选 | Expert detail / Composer model |
| **Capabilities** | tools / MCP / GitHub / Linear / Slack / Web… | Expert detail → Tools；Home tools 芯片 |
| **Environment** | 绑定的 VM / daemon | Expert detail；Home env 选择 |
| **Launch experience** | initial messages、input guidance | Home 选 Expert 后 placeholder 变化 |
| **Workers** | 可委托的其他 Expert 列表 / useAllExpertsAsWorkers | Expert detail → Workers |
| **Triggers** | 持久事件绑定（默认 disarmed） | Automations 展开行；Expert 触发器区 |

**设计意图**：Expert 是「产品」不是「聊天角色」。配置页要像配置服务（System / Tools / Workers / Sharing / Danger zone），而不是 prompt playground。

### 2.2 Environment — 算力与一致性

> Agents 在 **Environment** 里访问 filesystem、repos、执行 code 与 tools。

| 类型 | 特点 | 设计含义 |
|------|------|----------|
| **Cloud** | Augment 托管；每次 session 从 snapshot 起；按分钟计费；可无限并发 | 可复现、隔离、团队默认路径 |
| **Self-hosted daemon** | `auggie daemon` 跑在笔记本/VPC/Mac mini；磁盘可持久；无额外算力费 | 本地网络、受监管数据、专用硬件 |

Environment 打包：name、base image、repositories、env vars、visibility。  
**设计意图**：Environment 与 Expert **解耦**——同一 env 可挂多个 Expert；同一 Expert 可换 env。列表页用「repos / image / shared|private」传达，而不是空卡片。

### 2.3 Capability — 能力包

Capability = tools 或 MCP servers 的捆（CLI Tools、GitHub、Linear、Slack、Web Access…）。  
**设计意图**：Tools 在 UI 里是 **可数的芯片/能力列表**，不是模糊「integrations」一句话。Session/Home 的 tools 展示应对应 Expert 的 capability 集合。

### 2.4 Trigger / Automation / Subscription — 三种「事件进系统」路径

文档把「自动化」说清楚为：

| 概念 | 谁创建 | 生命周期 | 匹配时行为 | 典型用例 |
|------|--------|----------|------------|----------|
| **Trigger** | 人，在 Expert 配置里 | **持久** | **新开** Session，事件 payload 作首条消息 | 「PR 打开就开 reviewer」 |
| **Subscription** | Agent 运行时 `subscribe-event` | **随 Session 消亡** | 事件 **投递进已有** Session | 「告诉我 *这个* PR 有新评论」 |
| **Automation** | 产品层说法 | = Expert + 其 Triggers 的绑定 | standing order | Automations 表的一行 |

触发源三类：

1. **First-party**：GitHub / Linear / Slack / GitLab / PagerDuty（Integrations 一次连接，任意 Expert 可听）  
2. **Scheduled**：5 字段 cron + 时区（singleton：上一跑未完则跳过，不排队不回补）  
3. **Webhook**：escape hatch（JSONLogic 过滤）

**安全默认（核心 UX）**：

> Catalog Expert 自带 trigger 时 **默认关闭（disarmed）**。  
> Advisor 部署也是：Deploy off → Try once → Enable when ready。  
> *「Nothing fires until you say so.」*

**UI 含义**：

- Automations 列表 = Expert + triggers 表；**展开行** = 该 Expert 的 triggers（name · webhook id · Disabled · Add trigger）  
- 侧栏 Automations 组下：**Event Log**（全源入站事件）与 **Run History**（各 Expert 由 trigger 启动的 sessions）  
- Pause = disable toggle，不删配置；Remove = 删 trigger，Expert 能力保留  
- Auto-archive sessions by this trigger：fire-and-forget 默认开  

### 2.5 Session — 工作现场

> Session = Expert（行为）与 Environment（机器）的交汇；人给任务、看 turn、跟 tool call。

关键生命周期：

- 对话 **永久保存**；Environment 会 idle pause，最长约 24h 连续，回来发消息自动重启  
- Trigger 启动的 Session 可 **auto-archive**，归档仍可打开  
- 可见性：Shared Expert / automation → 默认 Shared；个人 Expert → 默认 Private（锁 badge）  
- Share：按人授权 viewer + copy link  
- Composer：`Ask anything or type / for commands`；消息可排队；⌘E enhance；附件上限  
- 入口：web / 手机浏览器 / Slack（无独立 App）

**右栏设计意图**（产品表面，不是装饰）：

| 区块 | 含义 |
|------|------|
| **Artifacts** | PR / Git branch / Linear / Link — 耐久产出，可 Cmd+K 检索 |
| **Workers** | 本 Session 委托出的 worker 树 |
| **Files** | Workspace（`/workspace` 活盘）+ User / Org VFS 预览 |
| **Status / env / model** | running · 时间 · environment · tools |

### 2.6 Files — 跨 Session 组织记忆

> Files **活过 VM**。不是用户上传箱——**Expert 作为工作副作用写入**，turn 边界自动 sync。

| Scope | 谁可见 | 典型路径 |
|-------|--------|----------|
| **User** | 仅自己的 Sessions | `user/notes/...` |
| **Organization** | 全组织 | `organization/pr-reviews/...` |
| **Workspace** | 仅当前 Session 的活 VM | `/workspace`（仅 Session 内 Files 页） |

Skills = Files 内特殊目录 `.augment/skills/`（agentskills.io），Org / User 两 scope 自动加载。  
Versioning：每次 write 有不可变版本与归因；删除是 tombstone。  
**UI 含义**：侧栏 Files 组两个入口 Organization / User；双栏树 + 路径/大小/mtime/last agent；不是单一「上传文件」页。

### 2.7 Space — 多团队边界

> Space 分组：Experts、Environments、Sessions、Secrets、MCP、Webhooks、Projects。  
> 切换 Space = **整套上下文切换**。

- 每 org 有不可改名/删除的 **Default space**  
- 未分配资源归 Default  
- 适用：多团队共享一个 org，需要聚焦列表 + 隔离 secrets/MCP + 团队 default Expert/Env  

**UI 含义**：侧栏顶部 Space 切换器是一等导航；原型至少展示 Default + 一个命名 Space。

---

## 3. 委托模型（为何不是一个超级 Agent）

官方明确三种 hand-off（[Workers / Subagents](https://docs.augmentcode.com/cosmos/workers-subagents)）：

| | **Worker** | **Subagent** | **Expert-to-Expert** |
|--|------------|--------------|----------------------|
| 是什么 | 另一个 **Expert** 的独立 Session | 轻量 helper agent | 两 Expert 通过集成协作 |
| 配置面 | 完整 Expert（Env、integrations、权限） | 有 prompt/model，无 Expert 配置 | 各自完整 Expert |
| 协调面 | Manager ↔ worker 消息 | 同 Session 内 | 集成本身（如 PR comments） |
| 重量 | Heavy | Light | 松耦合、事件驱动 |
| 何时用 | 子任务要独立 Env 或副作用 | 同 repo 内调研/校验 | 人可在集成里看到协作并介入 |

**原则**：

1. **专注意图** — Deep Reviewer 与 PR Author 的 prompt 优化目标不同，一个大 prompt 做不好两边。  
2. **Prefer Experts over bare subagents** in Cosmos — Worker / E2E 在产品里是可打开、可审计的真实 Session。  
3. **小心编排复杂度** — 像多线程；优先单 Expert；需要委托时 1–2 个边界清晰的 worker，或用 PR 做协调面。  
4. Worker 必须 **显式配置**（workerExpertIds / useAllExpertsAsWorkers），不隐式乱发。

**Code Review Pipeline 是哲学的最佳样例**：

```
Ticket → PR Author → (opens PR)
                 ↓ trigger
            Risk Analyzer ── low-risk → auto-approve
                 │ high-risk
                 ├─→ Deep Reviewer  (non-interactive, 行级正确性)
                 ├─→ Pair Reviewer  (interactive, 人做最终判断)
                 └─→ Verifier       (运行时证据)
            Memory Manager 从合并与人反馈中沉淀 org 记忆
```

人不再逐行读每个 PR；人只在 **架构 / 产品 / 安全 / 发布 / 政策** 判断点出现。

---

## 4. 交互哲学（Interaction）

### 4.1 Advisor-first（对话配置）

成功用户通过 **Cosmos Advisor** 配置，而不是点遍表单。四阶段：

1. **Dependencies** — 连 GitHub / Slack / Linear…（OAuth **必须人在浏览器完成**）  
2. **Environment** — 镜像、repos、toolchain  
3. **Expert** — 部署 Template 或设计 bespoke  
4. **Analyze / Tune** — 从 session 数据找失败模式、使用偏斜、卡顿、缺能力  

入口：Home 选 Advisor；Experts/Automations 横幅 *「Describe your workflow…」*；编辑 Expert 时 *「Ask an agent to tune this expert」*。  
**原型**：这些横幅与 Advisor 默认选中不是装饰，是主配置路径。

### 4.2 Safe by default（默认安全）

- 新 automation：**Deploy triggers off → try → enable**  
- Pause without delete  
- JSONLogic 过滤在开 session **之前** 跑（不关心的事件零成本）  
- 合规团队：先定义可 auto-approve 路径与审计，再开自动批准  

### 4.3 Human at judgment（人在判断点）

| Expert 类型 | 交互模式 | 人何时出现 |
|-------------|----------|------------|
| Deep Reviewer | Non-interactive | 读结论即可 |
| Pair Reviewer | Interactive | 终裁 / 知识传递 |
| Risk Analyzer | 路由 | 高风险时被拉入 |
| PR Author | 拥有 author loop | 任务描述与关键决策 |

### 4.4 Meet the work（工作在现场）

入口：Web / 手机浏览器 / Slack / Linear 事件。不强迫回 IDE 侧栏。

### 4.5 Shared memory（组织记忆）

User Files 私有；Org Files 共享；Skills 文件化；Expert 写 → 下一 Session / 另一 Expert / 队友可读。

### 4.6 Specialized teams of agents（专用小队）

Template Experts 由 Augment 维护（system prompt = include 托管 prompt + 组织 append 本地约定）。  
组织只 append 仓库范围与本地政策，不 fork 整份 prompt。

---

## 5. 信息架构哲学（IA）— 与官方侧栏对齐

```
Space switcher
├── New session / Home     → 启动工作（选 Expert → 描述任务）
├── Sessions               → 对话历史（Pinned · Folders · Recent）
├── Automations            → standing orders
│     ├── (list)           → Expert + triggers 表，可展开
│     ├── Run history      → 各 Expert 由 trigger 启动的 runs
│     └── Events log       → 全源入站事件 + payload 检查
├── Files
│     ├── Organization     → 共享记忆树
│     └── User             → 私有记忆树
└── Configuration
      ├── Experts          → 产品表面目录 + Share + Danger
      ├── Environments     → Cloud / Daemon 列表
      ├── Integrations     → GitHub, Slack, Linear…
      ├── MCP              → Capability 扩展
      ├── Webhooks         → 自定义事件入口
      └── Secrets          → 注入 VM 的凭证
```

设计含义：

| 分离 | 原因 |
|------|------|
| **做工**（Home / Sessions）vs **装系统**（Configuration） | 日常用户与平台管理员心智不同 |
| **Automations** vs **Sessions** | 一个是值守 standing order，一个是对话记录 |
| **Events log** vs **Run history** | 入站事实 vs Expert 实际响应 |
| **Files** 独立组 | 不是附件，是跨 Session 记忆层 |
| **Triggers 挂在 Expert 上** | Automations 页是「带 trigger 的 Expert 视图」，不是第三套实体编辑器 |

---

## 6. 视觉 / 体验哲学（Visual & UX）

| 原则 | 做法 |
|------|------|
| **High contrast, low chrome** | 主字近纯黑/纯白；背景克制；少装饰、多信息 |
| **Dense but calm** | 工程工具密度（表、侧栏、Composer）；圆角与间距统一 |
| **One primary action** | 每屏一个主按钮（New session / Create expert / Send） |
| **Composable surfaces** | 卡片 = Expert 表面；侧栏 = 导航；右栏 = Session 元数据 |
| **Status over decoration** | running 点、armed/disarmed、Private/Shared、Disabled trigger |
| **Monospace for system truth** | Session ID、路径、webhook id、工具调用、JSON payload |
| **Enterprise trust is quiet** | 沙箱、审计、HITL 是底色，不是恐吓弹窗 |

文案胶囊（产品承诺）：

- **COLLABORATE IN REAL TIME** — 共享 Session / Share  
- **STORE FILES ACROSS TEAMS** — Org Files  
- **CUSTOM AGENTS** — Expert 可复用表面  
- **TOOLS TO GET REAL WORK DONE** — Integrations / MCP / 真环境  

---

## 7. 文案语气（Voice）

| 要 | 不要 |
|----|------|
| 具体、工程向、短句 | 空泛「AI 赋能」 |
| 说清 agent 会做什么 / 不会做什么 | 隐瞒 automation 风险 |
| 「triggers off」「dry-run」「checkpoint」 | 假装全自动零责任 |
| Advisor 用第一人称计划步骤 | 机器人菜单腔 |
| 描述 **outcome**（「review every PR on billing」） | 强迫用户写 JSONLogic |

---

## 8. 原型落点检查表

改 UI 前过一遍（对照官方设计意图）：

**架构语义**

- [ ] Expert 是否呈现为「产品表面」（System / Tools / Workers / Sharing），而非聊天角色？  
- [ ] Environment 是否与 Expert 解耦展示（image / repos / cloud|daemon）？  
- [ ] Automation 行是否 = Expert + 其 triggers；展开是否看到 Disabled / Add trigger？  
- [ ] Events log 与 Run history 是否分开展示不同问题？  
- [ ] Files 是否 User / Org 双入口，且暗示「Expert 写入」而非「用户上传」？  
- [ ] Session 右栏是否有 Artifacts / Workers / Files，而不只是空 meta？  
- [ ] Triggers vs Subscriptions 概念是否至少在文案/状态上可区分？  

**交互哲学**

- [ ] 配置路径是否优先导向 **Advisor** 横幅？  
- [ ] 新 trigger 是否默认 **disarmed / Disabled**？  
- [ ] Deep vs Pair 是否体现 HITL 差异？  
- [ ] Share 是否体现 org 协作（人 + service account）？  

**视觉**

- [ ] 主操作是否唯一、对比是否足够？  
- [ ] 是否用状态（running / private / armed / disabled）代替装饰？  
- [ ] 系统真相（路径、webhook id、payload）是否用 mono？  

---

## 9. 一句话

**Cosmos 的设计哲学 = 把「个人用 agent 写代码」升级为「组织用可复用 Expert 小队，在可复现 Environment 上，通过 Automation 值守完整 SDLC，用 Files 共享记忆」——默认安全、对话配置、人在判断点、工作发生在现场。**

视觉与 IA 都服务这一点：**冷静、高对比、工程密度、实体边界清晰、少表演、多系统真相。**
