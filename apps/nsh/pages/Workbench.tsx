import { List, Scroll, Text, View, signal, windowSize } from 'nsh'
import { Button, Input, NavPage } from 'nsh/base'
import { titleBar } from 'nsh/desktop'
import {
  BarProgress,
  BurnCheckbox,
  GhostButton,
  Icon,
  Logo,
  NavButton,
  OutlineButton,
  PrimaryButton,
  SectionCard,
  ServiceSelect,
  ThemeButton,
} from '../components/ui'
import { pushReview } from '../nav'
import { SettingsPage } from './Settings'
import {
  canReuseTask,
  formatStamp,
  isRunning,
  pathsFromUris,
  pickAndAdd,
  selectedTask,
  state,
  statusLabel,
  visibleTasks,
  workspace,
} from '../store'

function Header() {
  const pad = () =>
    windowSize().width < 1150 ? Math.max(titleBar().left, 24) : 24
  const count = () => visibleTasks().length
  return (
    <View
      class="h-14 items-center border-b border-border bg-card"
      desktop={{ windowDrag: true }}
    >
      <View
        class="h-full w-full max-w-5xl flex-row items-center justify-between gap-4 px-6"
        style={{ paddingLeft: pad() }}
      >
        <View class="flex-row items-center gap-3">
          <Logo />
          <Text class="text-base font-semibold text-foreground">
            视频翻译助手
          </Text>
          <View class="h-5 w-px bg-border" />
          <NavButton
            name="captions"
            label="字幕"
            selected={state().kind === 'subtitle'}
            onPress={() => workspace.setKind('subtitle')}
          />
          <NavButton
            name="document"
            label="文稿"
            selected={state().kind === 'document'}
            onPress={() => workspace.setKind('document')}
          />
        </View>
        <View class="flex-row items-center gap-3">
          <View class="flex-row gap-0.5 rounded-lg bg-muted p-0.5">
            <NavButton
              name="upload"
              label="添加"
              selected={state().panel === 'add'}
              onPress={() => workspace.setPanel('add')}
            />
            <NavButton
              name="tasks"
              label={count() > 0 ? `任务  ${count()}` : '任务'}
              selected={state().panel === 'tasks'}
              onPress={() => workspace.setPanel('tasks')}
            />
          </View>
          <View class="h-5 w-px bg-border" />
          <ThemeButton />
          <NavButton
            name="settings"
            label="设置"
            onPress={() => workspace.setPanel('settings')}
          />
        </View>
      </View>
    </View>
  )
}

function Banner() {
  return (
    <If when={state().message}>
      <View class="items-center px-6 pt-3">
        <View class="w-full max-w-[976px] rounded-md bg-muted px-4 py-2">
          <Text class="text-sm text-foreground">{state().message}</Text>
        </View>
      </View>
    </If>
  )
}

function ProcessingRow() {
  return (
    <SectionCard class="gap-2 p-3">
      <View class="flex-row items-center justify-between gap-3">
        <View class="flex-row gap-0.5 rounded-lg bg-muted p-0.5">
          <GhostButton
            label="翻译字幕"
            selected={state().processing === 'translate'}
            onPress={() => workspace.setProcessing('translate')}
          />
          <GhostButton
            label="仅提取原文"
            selected={state().processing === 'extract'}
            onPress={() => workspace.setProcessing('extract')}
          />
        </View>
        <BurnCheckbox />
      </View>
      <Text class="text-xs text-muted-foreground">
        {state().processing === 'extract'
          ? '只生成原文 SRT，无需模型服务'
          : '生成原文 / 译文 / 双语 · 需配置模型服务'}
      </Text>
    </SectionCard>
  )
}

function AddPanel() {
  const dragging = signal(false)
  const documentKind = () => state().kind === 'document'
  return (
    <Scroll class="flex-1">
      <View class="items-center px-6 py-6">
        <View class="w-full max-w-2xl gap-5">
          <View class="gap-1">
            <Text class="text-lg font-semibold text-foreground">
              {documentKind() ? '添加要整理的音视频' : '添加要生成字幕的视频'}
            </Text>
            <Text class="text-sm text-muted-foreground">
              {documentKind()
                ? '本地文件或在线链接，识别语音并整理为 Markdown 文稿'
                : '本地文件或在线链接，识别后生成字幕；可翻译或仅提取原文'}
            </Text>
          </View>
          <View class="flex-row items-center gap-3">
            <Text class="text-sm font-medium text-foreground">模型服务</Text>
            <ServiceSelect />
            <OutlineButton
              label="管理服务"
              onPress={() => workspace.setPanel('settings')}
            />
          </View>
          <If when={state().kind === 'subtitle'}>
            <ProcessingRow />
          </If>
          <View
            class={`items-center gap-3 rounded-xl border border-dashed bg-card p-5 py-8 ${dragging() ? 'border-ring' : 'border-border'}`}
            onFileDragEnter={() => dragging.set(true)}
            onFileDragLeave={() => dragging.set(false)}
            onFileDrop={event => {
              dragging.set(false)
              void workspace.addPaths(pathsFromUris(event.uris))
            }}
          >
            <Icon name="upload" size={40} />
            <Text class="text-base font-semibold text-foreground">
              {dragging()
                ? '释放以添加文件'
                : documentKind()
                  ? '拖拽音视频到此处'
                  : '拖拽视频到此处'}
            </Text>
            <Text class="text-sm text-muted-foreground">
              MP4 / AVI / MOV / MKV / WebM · MP3 / WAV / M4A
            </Text>
            <PrimaryButton
              label="选择文件"
              onPress={() => void pickAndAdd('video')}
            />
          </View>
          <View class="flex-row items-center gap-3">
            <View class="h-px flex-1 bg-border" />
            <Text class="text-xs text-muted-foreground">或使用在线链接</Text>
            <View class="h-px flex-1 bg-border" />
          </View>
          <SectionCard class="gap-3">
            <View class="flex-row items-start gap-2">
              <Icon name="link" size={16} />
              <View class="gap-1">
                <Text class="text-sm font-semibold text-foreground">
                  在线视频链接
                </Text>
                <Text class="text-xs text-muted-foreground">
                  支持 YouTube、B 站等 yt-dlp 站点，也可粘贴本地文件路径
                </Text>
              </View>
            </View>
            <Input
              multiline
              value={state().path_draft}
              placeholder="本地文件、字幕或视频链接"
              onChange={({ value }) => workspace.setPathDraft(value)}
              class="min-h-20 rounded-md border border-input px-3 py-2 text-sm text-foreground focus:border-ring"
            />
            <View class="flex-row items-center justify-between">
              <OutlineButton
                label="导入字幕"
                onPress={() => void pickAndAdd('subtitles')}
              />
              <PrimaryButton
                label="开始"
                onPress={() => void workspace.submitInput()}
              />
            </View>
          </SectionCard>
        </View>
      </View>
    </Scroll>
  )
}

function SelectedBody() {
  const logs = signal(false)
  const task = () => selectedTask()
  const running = () => !!task() && isRunning(task()!.status)
  const paused = () => {
    const status = task()?.status
    return status === 'paused' || status === 'cancelled'
  }
  const retryable = () => {
    const status = task()?.status
    return status === 'failed' || status === 'completed'
  }
  return (
    <View class="gap-3">
      <If when={running()}>
        <BarProgress value={(task()?.progress ?? 0) as number} />
      </If>
      <If when={task()?.error_message}>
        <Text class="text-sm text-destructive">
          {task()?.error_message ?? ''}
        </Text>
      </If>
      <View class="flex-row flex-wrap items-center gap-2">
        <If when={running()}>
          <View class="flex-row gap-2">
            <OutlineButton
              label="暂停"
              onPress={() => {
                const id = task()?.id
                if (id) workspace.pauseTask(id)
              }}
            />
            <OutlineButton
              label="取消"
              onPress={() => {
                const id = task()?.id
                if (id) workspace.cancelTask(id)
              }}
            />
          </View>
        </If>
        <If when={paused()}>
          <OutlineButton
            label="恢复"
            onPress={() => {
              const id = task()?.id
              if (id) void workspace.resumeTask(id)
            }}
          />
        </If>
        <If when={retryable()}>
          <OutlineButton
            label="重试"
            onPress={() => {
              const id = task()?.id
              if (id) void workspace.retryTask(id)
            }}
          />
        </If>
        <PrimaryButton
          label="校对工作台"
          onPress={() => {
            const id = task()?.id
            if (id) pushReview(id)
          }}
        />
        <If when={canReuseTask(task())}>
          <View class="flex-row gap-2">
            <OutlineButton
              label="复用到字幕"
              onPress={() => void workspace.reuseSelected('subtitle')}
            />
            <OutlineButton
              label="复用到文稿"
              onPress={() => void workspace.reuseSelected('document')}
            />
          </View>
        </If>
        <OutlineButton
          label={logs() ? '收起日志' : '查看日志'}
          onPress={() => logs.update(open => !open)}
        />
        <OutlineButton
          label="删除"
          onPress={() => {
            const id = task()?.id
            if (id) workspace.deleteTask(id)
          }}
        />
      </View>
      <If when={task()?.output_artifacts}>
        <Text class="text-xs text-muted-foreground">
          产物目录 {task()?.output_artifacts?.output_directory ?? ''}
        </Text>
      </If>
      <If when={logs()}>
        <Scroll class="h-40">
          <Text class="text-xs text-muted-foreground">
            {(task()?.logs ?? [])
              .slice()
              .reverse()
              .slice(0, 40)
              .map(log => `[${log.level}] ${log.message}`)
              .join('\n')}
          </Text>
        </Scroll>
      </If>
    </View>
  )
}

function TasksPanel() {
  const empty = () => visibleTasks().length === 0
  return (
    <View class="flex-1 items-center px-6 py-6">
      <View class="w-full max-w-[976px] flex-1 gap-4">
        <View class="flex-row items-center justify-between">
          <Text class="text-lg font-semibold text-foreground">
            {state().kind === 'document' ? '文稿任务' : '翻译任务'}
          </Text>
          <View class="flex-row gap-2">
            <OutlineButton
              label="导入字幕"
              onPress={() => void pickAndAdd('subtitles')}
            />
            <OutlineButton
              label="清理已结束"
              onPress={() => workspace.deleteFinished()}
            />
          </View>
        </View>
        <If when={empty()}>
          <SectionCard class="items-center gap-3 py-10">
            <Icon name="video" size={36} />
            <Text class="text-base font-semibold text-foreground">
              暂无翻译任务
            </Text>
            <Text class="text-sm text-muted-foreground">
              添加本地视频或在线链接，开始第一个任务
            </Text>
            <PrimaryButton
              label="去添加视频"
              onPress={() => workspace.setPanel('add')}
            />
          </SectionCard>
        </If>
        <List
          each={visibleTasks()}
          keyExtractor={task => task.id}
          estimatedItemSize={92}
          class="flex-1"
        >
          {task => (
            <SectionCard class="gap-3 p-4">
              <Button
                onPress={() => workspace.selectTask(task().id)}
                class="w-full flex-row items-center justify-between gap-3"
              >
                <Icon name="video" size={20} />
                <View class="flex-1 gap-1">
                  <Text class="text-sm font-semibold text-foreground">
                    {task().video_file.name}
                  </Text>
                  <Text class="text-xs text-muted-foreground">
                    {formatStamp(task().created_at)} · {task().segments.length}{' '}
                    段 · {task().source_language} → {task().target_language}
                  </Text>
                </View>
                <View class="rounded-full bg-muted px-2 py-1">
                  <Text class="text-xs text-foreground">
                    {statusLabel[task().status] ?? task().status}
                  </Text>
                </View>
              </Button>
              <If when={isRunning(task().status)}>
                <BarProgress value={task().progress as number} />
              </If>
            </SectionCard>
          )}
        </List>
        <If when={!!state().selected_id}>
          <SectionCard class="gap-3 p-4">
            <SelectedBody />
          </SectionCard>
        </If>
      </View>
    </View>
  )
}

export function Workbench() {
  return (
    <NavPage
      title="视频翻译助手"
      header={
        <If when={state().panel !== 'settings'}>
          <Header />
        </If>
      }
    >
      <View class="flex-1 bg-background">
        <Banner />
        <If when={state().panel === 'add'}>
          <AddPanel />
        </If>
        <If when={state().panel === 'tasks'}>
          <TasksPanel />
        </If>
        <If when={state().panel === 'settings'}>
          <SettingsPage />
        </If>
      </View>
    </NavPage>
  )
}
