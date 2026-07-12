import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { initialRuns } from './data/mockData'
import { PREFERENCE_STORAGE_KEYS, PreferencesProvider } from './preferences'

function renderApp(route = '/runs/run-482') {
  return render(
    <PreferencesProvider>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </PreferencesProvider>,
  )
}

async function openTemplateLibrary(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /工作流模板/ }))
}

async function forkTemplate(user: ReturnType<typeof userEvent.setup>, templateName: string) {
  await openTemplateLibrary(user)
  const search = screen.getByRole('textbox', { name: '搜索工作流名称或能力' })
  await user.type(search, templateName)
  expect(screen.getByRole('heading', { name: templateName })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '基于模板创建' }))
}

describe('Relay prototype', () => {
  beforeEach(() => {
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, 'zh')
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS.theme, 'dark')
    window.localStorage.setItem('relay.sidebarCollapsed', 'false')
    window.localStorage.removeItem('relay.sessions')
    window.localStorage.removeItem('relay.experts')
    window.localStorage.removeItem('relay.controlPlane.v1')
  })

  it('uses Home as the Expert launcher without adding a sidebar Home item', async () => {
    renderApp('/home')

    expect(await screen.findByRole('heading', { level: 1, name: '选择 Expert，开始一个会话' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '首页' })).not.toBeInTheDocument()
  })

  it('switches between run evidence views', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(screen.getByRole('heading', { level: 1, name: '升级支付服务重试策略' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /变更/ }))

    expect(screen.getByRole('button', { name: /src\/retry\/retry-policy\.ts/ })).toBeInTheDocument()
    expect(screen.getByLabelText('代码差异')).toBeInTheDocument()

    const sessionViews = screen.getByRole('navigation', { name: '会话视图' })
    await user.click(within(sessionViews).getByRole('button', { name: /文件/ }))
    expect(screen.getByRole('tab', { name: /工作区/ })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: /组织/ }))
    expect(screen.getByRole('button', { name: /standards\/engineering\.md/ })).toBeInTheDocument()
  })

  it('records an approval decision and continues the run', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole('button', { name: /审批/ }))
    await user.click(screen.getByRole('button', { name: '批准并继续' }))

    expect(screen.getByText('决策已记录，正在创建 PR')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('审批已记录')
  })

  it('creates a new run from the task dialog', async () => {
    const user = userEvent.setup()
    renderApp('/runs')

    await user.click(screen.getAllByRole('button', { name: '新建会话' })[0])
    await user.type(screen.getByLabelText('会话任务'), '修复优惠券并发核销。确保同一张优惠券只能成功核销一次，并补充并发测试。参考 https://github.com/acme/commerce/issues/42')
    expect(screen.getByText('GitHub · acme/commerce/issues/42')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(screen.getByRole('button', { name: '正在启动…' })).toBeDisabled()

    expect(await screen.findByRole('heading', { level: 1, name: '修复优惠券并发核销' })).toBeInTheDocument()
    expect(screen.getByText('正在建立任务上下文')).toBeInTheDocument()
    await waitFor(() => {
      const storedSessions = JSON.parse(window.localStorage.getItem('relay.sessions') ?? '[]') as Array<{
        title: string
        baseBranch?: string
        contextItems?: Array<{ kind: string }>
      }>
      expect(storedSessions.find((session) => session.title === '修复优惠券并发核销')).toMatchObject({
        baseBranch: 'main',
        contextItems: [{ kind: 'github' }],
      })
    })
  })

  it('starts a Session directly from Home with the selected Expert and first prompt', async () => {
    const user = userEvent.setup()
    renderApp('/home')

    await user.type(screen.getByLabelText('会话任务'), '评估结算链路迁移方案')
    await user.click(screen.getByRole('button', { name: '开始会话' }))

    expect(await screen.findByRole('heading', { level: 1, name: '评估结算链路迁移方案' })).toBeInTheDocument()
    const storedSessions = JSON.parse(window.localStorage.getItem('relay.sessions') ?? '[]') as Array<{ title: string; expertId?: string }>
    expect(storedSessions.find((session) => session.title === '评估结算链路迁移方案')).toMatchObject({ expertId: 'expert-cosmos-advisor' })
  })

  it('filters the template library by category', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await openTemplateLibrary(user)

    expect(screen.getByText('62 个工作流模板')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ticket or task to a merged PR' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /QA\s*7/ }))

    expect(screen.getByRole('heading', { name: 'E2E Playwright verification on every PR' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ticket or task to a merged PR' })).not.toBeInTheDocument()
  })

  it('forks the Figma template into an editable draft', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await forkTemplate(user, 'Figma design to production code')

    expect(screen.getByRole('heading', { level: 1, name: 'Figma design to production code' })).toBeInTheDocument()
    expect(screen.getByText(/草稿 · v0/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('Figma design to production code')
  })

  it('saves and publishes an Expert as a persisted version', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await forkTemplate(user, 'Figma design to production code')
    const name = screen.getByRole('textbox', { name: '显示名称' })
    await user.clear(name)
    await user.type(name, 'Figma 生产实现专家')
    await user.click(screen.getByRole('button', { name: '保存草稿' }))

    expect(screen.getByRole('status')).toHaveTextContent('配置已保存')
    await user.click(screen.getByRole('button', { name: '发布专家' }))
    expect(screen.getByRole('status')).toHaveTextContent('专家已发布')

    await waitFor(() => {
      const store = JSON.parse(window.localStorage.getItem('relay.experts') ?? '{}') as {
        experts?: Array<{ sourceTemplateId?: string; status: string; latestVersion: number; draftConfig: { name: string } }>
        versions?: Array<{ expertId: string; version: number }>
      }
      const expert = store.experts?.find((item) => item.sourceTemplateId === 'figma-to-code')
      expect(expert).toMatchObject({
        status: 'published',
        latestVersion: 1,
        draftConfig: { name: 'Figma 生产实现专家' },
      })
      expect(store.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ version: 1 }),
      ]))
    })
  })

  it('disables and re-enables a published Expert from the list', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    const expertName = 'Ticket or task to a merged PR'
    await user.click(screen.getByRole('button', { name: `停用: ${expertName}` }))
    expect(screen.getByRole('status')).toHaveTextContent('专家已停用')
    expect(screen.getByRole('button', { name: `启用: ${expertName}` })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `启用: ${expertName}` }))
    expect(screen.getByRole('status')).toHaveTextContent('专家已重新启用')
    expect(screen.getByRole('button', { name: `停用: ${expertName}` })).toBeInTheDocument()

    await waitFor(() => {
      const store = JSON.parse(window.localStorage.getItem('relay.experts') ?? '{}') as {
        experts?: Array<{ id: string; status: string }>
      }
      expect(store.experts?.find((expert) => expert.id === 'expert-seed-pr-author')).toMatchObject({ status: 'published' })
    })
  })

  it('starts a Session with the published Expert id and name preselected', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    const expertName = 'Ticket or task to a merged PR'
    await user.click(screen.getByRole('button', { name: `发起会话: ${expertName}` }))

    expect(screen.getByRole('radio', { name: new RegExp(expertName) })).toHaveAttribute('aria-checked', 'true')
  })

  it('rolls back a published Expert by creating a new version', async () => {
    const user = userEvent.setup()
    renderApp('/experts')

    await forkTemplate(user, 'Figma design to production code')
    const name = screen.getByRole('textbox', { name: '显示名称' })
    await user.clear(name)
    await user.type(name, 'Figma Expert v1')
    await user.click(screen.getByRole('button', { name: '发布专家' }))

    const publishedName = screen.getByRole('textbox', { name: '显示名称' })
    await user.clear(publishedName)
    await user.type(publishedName, 'Figma Expert v2')
    await user.click(screen.getByRole('button', { name: '发布新版本' }))
    await user.click(screen.getByRole('button', { name: '回滚到此版本' }))

    expect(screen.getByRole('status')).toHaveTextContent('已回滚并发布为新版本')
    expect(screen.getByRole('textbox', { name: '显示名称' })).toHaveValue('Figma Expert v1')

    await waitFor(() => {
      const store = JSON.parse(window.localStorage.getItem('relay.experts') ?? '{}') as {
        experts?: Array<{ sourceTemplateId?: string; latestVersion: number; draftConfig: { name: string } }>
        versions?: Array<{ version: number; rolledBackFromVersionId?: string }>
      }
      const expert = store.experts?.find((item) => item.sourceTemplateId === 'figma-to-code')
      expect(expert).toMatchObject({ latestVersion: 3, draftConfig: { name: 'Figma Expert v1' } })
      expect(store.versions).toEqual(expect.arrayContaining([
        expect.objectContaining({ version: 3, rolledBackFromVersionId: expect.any(String) }),
      ]))
    })
  })

  it('switches theme and application language', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    const sessionsPage = screen.getByRole('main')

    await user.click(within(sessionsPage).getByRole('button', { name: '切换到浅色模式' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem(PREFERENCE_STORAGE_KEYS.theme)).toBe('light')

    await user.click(within(sessionsPage).getByRole('button', { name: '切换到英文' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Sessions' })).toBeInTheDocument()
    expect(within(sessionsPage).getByRole('button', { name: 'Switch to Chinese' })).toBeInTheDocument()
    expect(window.localStorage.getItem(PREFERENCE_STORAGE_KEYS.locale)).toBe('en')
  })

  it('renames and archives a managed session', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')

    await user.click(screen.getByRole('button', { name: '补齐库存预占链路测试 · 会话操作' }))
    await user.click(screen.getByRole('menuitem', { name: '重命名' }))
    const nameInput = screen.getByLabelText('会话名称')
    await user.clear(nameInput)
    await user.type(nameInput, '库存并发测试修复')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(within(screen.getByRole('table', { name: '会话' })).getByText('库存并发测试修复')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '库存并发测试修复 · 会话操作' }))
    await user.click(screen.getByRole('menuitem', { name: '归档' }))
    expect(screen.queryByText('库存并发测试修复')).not.toBeInTheDocument()
    const storedSessions = JSON.parse(window.localStorage.getItem('relay.sessions') ?? '[]') as Array<{ title: string; archived?: boolean }>
    expect(storedSessions.find((session) => session.title === '库存并发测试修复')).toMatchObject({ archived: true })
    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    expect(screen.getByText('库存并发测试修复')).toBeInTheDocument()
  })

  it('prioritizes sessions that need attention', () => {
    const completedSession = { ...initialRuns.find((run) => run.id === 'run-481')!, archived: false }
    const sessions = [completedSession, ...initialRuns.filter((run) => run.id !== 'run-481')]
    window.localStorage.setItem('relay.sessions', JSON.stringify(sessions))

    renderApp('/sessions')

    const rows = within(screen.getByRole('table', { name: '会话' })).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('升级支付服务重试策略')
    expect(rows[1]).toHaveTextContent('补齐库存预占链路测试')
    expect(rows[2]).toHaveTextContent('审查身份服务依赖升级')
    expect(rows[3]).toHaveTextContent('修复账单导出时区偏差')
  })

  it('finds sessions by PR details and source filters', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')

    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    const search = screen.getByLabelText('搜索标题、仓库、分支、触发器、步骤或 PR')
    await user.type(search, 'PR #913')
    expect(within(screen.getByRole('table', { name: '会话' })).getByText('修复账单导出时区偏差')).toBeInTheDocument()

    await user.clear(search)
    await user.click(screen.getByRole('button', { name: '筛选' }))
    const filterDialog = screen.getByRole('dialog', { name: '筛选' })
    await user.selectOptions(within(filterDialog).getByLabelText('来源'), 'Jira')
    expect(within(screen.getByRole('table', { name: '会话' })).getByText('修复账单导出时区偏差')).toBeInTheDocument()
  })

  it('archives multiple selected sessions in one action', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')

    await user.click(screen.getByRole('checkbox', { name: '选择会话: 补齐库存预占链路测试' }))
    await user.click(screen.getByRole('checkbox', { name: '选择会话: 审查身份服务依赖升级' }))
    await user.click(screen.getByRole('button', { name: '批量归档 (2)' }))

    expect(screen.queryByText('补齐库存预占链路测试')).not.toBeInTheDocument()
    expect(screen.queryByText('审查身份服务依赖升级')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /已归档/ }))
    expect(screen.getByText('补齐库存预占链路测试')).toBeInTheDocument()
    expect(screen.getByText('审查身份服务依赖升级')).toBeInTheDocument()
  })

  it('materializes a matched inbound event as an automation Session', async () => {
    const user = userEvent.setup()
    renderApp('/automations/events')

    await user.click(screen.getByRole('button', { name: 'Slack' }))
    await user.click(screen.getByRole('button', { name: '注入并匹配' }))

    expect(screen.getByRole('status')).toHaveTextContent('事件已匹配 Payments alert investigation')
    expect(screen.getByText('@Cosmos investigate payment timeouts')).toBeInTheDocument()
    await waitFor(() => {
      const storedSessions = JSON.parse(window.localStorage.getItem('relay.sessions') ?? '[]') as Array<{
        title: string
        source: string
        automationId?: string
        sourceEventId?: string
      }>
      expect(storedSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          title: '@Cosmos investigate payment timeouts',
          source: 'automation',
          automationId: 'automation-slack-incident',
          sourceEventId: expect.any(String),
        }),
      ]))
    })
  })

  it('creates a new Attempt on retry while preserving the failed Attempt', async () => {
    const user = userEvent.setup()
    renderApp('/runs/run-479')

    await user.click(screen.getByRole('button', { name: '重试步骤' }))

    expect(screen.getByRole('status')).toHaveTextContent('已创建新的 Attempt，重试成功')
    await waitFor(() => {
      const storedSessions = JSON.parse(window.localStorage.getItem('relay.sessions') ?? '[]') as Array<{
        id: string
        status: string
        attempts?: Array<{ number: number; status: string }>
      }>
      expect(storedSessions.find((session) => session.id === 'run-479')).toMatchObject({
        status: 'completed',
        attempts: [
          { number: 1, status: 'failed' },
          { number: 2, status: 'succeeded' },
        ],
      })
    })
  })

  it('creates a provisioning environment through the three-step wizard', async () => {
    const user = userEvent.setup()
    renderApp('/environments')

    await user.click(screen.getByRole('button', { name: '创建环境' }))
    await user.type(screen.getByRole('textbox', { name: '环境名称' }), '支付回归验证')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '创建并模拟配置' }))

    expect(screen.getByRole('button', { name: /支付回归验证/ })).toBeInTheDocument()
    await waitFor(() => {
      const state = JSON.parse(window.localStorage.getItem('relay.controlPlane.v1') ?? '{}') as {
        environments?: Array<{ name: string; status: string }>
      }
      expect(state.environments).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '支付回归验证', status: 'provisioning' }),
      ]))
    })
  })
})
