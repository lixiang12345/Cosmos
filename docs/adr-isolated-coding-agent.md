# ADR: 隔离 Coding Agent 的威胁模型与执行边界

> 状态：已采纳（2026-07-26）
> 关联：`ops/poc/isolated-worktree-poc.sh`、`docs/production-architecture.md`、任务「完成隔离 Coding Agent 的威胁模型与最小 PoC」

## 背景

Cosmos 的 execution worker 目前以受限 provider 调用与 governed tool broker 执行会话，但尚未开放**代码写入**能力。在开放写入前，本 ADR 固定威胁模型、隔离原语选择与 capability 门控设计，并以最小 PoC 验证 worktree 隔离在超时、取消与越界指令下的行为。

## 威胁模型（六边界）

| 边界 | 威胁 | 缓解（现有 / PoC / 产品化） |
| --- | --- | --- |
| **文件系统** | Agent 写入仓库外路径（`../`、绝对路径、symlink 逃逸）；污染宿主配置（`~/.ssh`、shell rc） | PoC：git worktree 为唯一可写根；写入前 `realpath` 校验必须落在 worktree 内；symlink 目标同校验。产品化：容器只读根文件系统 + worktree 独立挂载。 |
| **网络** | 泄露源码/密钥到外部主机；拉取恶意依赖 | 现有：Environment `networkPolicy`（restricted/allowlist/unrestricted）为声明式契约。PoC：执行环境剥离代理变量并以 `env -i` 清空继承。产品化：网络命名空间 + 按 allowlist 的 egress 代理，restricted 默认拒绝。 |
| **进程** | fork 炸弹、驻留后台进程、执行期越权提权 | PoC：`ulimit`（进程数/文件数/CPU）、`timeout` 硬截止、进程组整组回收（取消即 `kill -- -PGID`）。产品化：容器 PID 命名空间 + cgroup 限额，worker crash 由 lease 过期回收（现有 execution lease 机制）。 |
| **Secret** | 读取宿主环境变量、云凭证、其他租户 Secret | 现有：Secret 只写存储 + 作用域内 VM 注入（079 列级禁读模式同类）。PoC：`env -i` 白名单注入，断言执行环境内不可见宿主变量。产品化：每会话短时效凭证，绝不挂载长效凭证。 |
| **依赖** | `npm install` 执行恶意 postinstall；lockfile 篡改 | PoC 非目标（不执行安装）。产品化：`--ignore-scripts` 默认、lockfile 只读校验、私有镜像源。 |
| **供应链（输出侧）** | Agent 产出的 diff 混入未审计变更；直接推主分支 | 现有：Artifact 审计链路（048）+ 分支保护约定（PR Author 模板 Boundaries）。PoC：输出仅为 diff 文件 Artifact，不触碰源 worktree 之外的引用。产品化：写操作 capability-gated（Expert capabilities `write-code`/`git`/`create-pr`）+ tool broker 审批点（现有 governed broker 的 approval 流）。 |

## Capability 门控与审批映射（对现有机制，非虚构）

- **写工具**：仅当 Expert 发布版本包含 `write-code` 能力时，执行快照才允许写路径；能力集在发布时固定（immutable revision），会话中不可扩权。
- **网络**：Environment revision 的 `networkPolicy` 随执行快照固定；`allowlist` 之外的目标在产品化层由 egress 代理拒绝。
- **Secret**：作用域内 Secret 经 VM 注入；PoC 证明执行环境与宿主环境隔离。
- **人工审批**：governed tool broker 的 approval 记录（现有 Approvals 面）承接高风险写操作的人工决策点；PoC 阶段以"diff 产出 → 人审 → 应用"三段式代替自动写回。

## 最小 PoC（`ops/poc/isolated-worktree-poc.sh`）

在隔离 git worktree 中执行一次最小代码修改与验证，并证明五类越界被拒：

1. 创建一次性 worktree（独立分支，`poc/` 前缀）。
2. 以 `env -i` + `ulimit` + `timeout` 约束的子进程执行修改（写一个文件）与验证（读回断言）。
3. 产出 diff 为 Artifact 文件（不推送、不合并）。
4. 负向断言：仓库外写入被拒；宿主环境变量不可见；超时任务被硬终止且 worktree 可完整回收；取消（SIGTERM 进程组）后无残留进程；恶意相对路径（`../escape`）写入被 realpath 校验拒绝。
5. 清理 worktree 与分支，宿主仓库零变化（`git status` 干净断言）。

## 非目标与风险（productionization 前）

- **非目标**：本 PoC 不提供容器/VM 级隔离（网络命名空间、只读根、seccomp）；不执行依赖安装；不自动开 PR。这些属于产品化阶段，依赖真实执行 Smoke（staging + provider 凭证）完成后实施。
- **风险**：shell 级隔离可被内核级漏洞绕过（接受，PoC 目的为语义验证）；`ulimit` 对已启动进程的内存约束有限（产品化用 cgroup）；macOS 与 Linux 的 `timeout`/`ulimit` 行为差异（PoC 兼容两者，产品化仅针对 Linux 容器）。
