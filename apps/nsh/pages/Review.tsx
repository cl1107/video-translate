import type { Signal, VideoRef } from 'nsh'
import { List, Scroll, Text, Video, View, effect, signal } from 'nsh'
import { Input, NavPage, TextView } from 'nsh/base'
import { titleBar } from 'nsh/desktop'
import {
  Field,
  GhostButton,
  Icon,
  NavButton,
  OutlineButton,
  PrimaryButton,
  SectionCard,
  Timeline,
} from '../components/ui'
import { nav } from '../nav'
import type { ReviewIssue, Segment } from '../types'
import { canReuseTask, state, taskById, workspace } from '../store'

function issuesOf(id: string): ReviewIssue[] {
  return (workspace.collectIssues(id) as ReviewIssue[]) ?? []
}

function segmentAt(id: string, index: number): Segment | undefined {
  return taskById(id)?.segments[index]
}

function ReviewHeader(props: { id: string }) {
  const task = () => taskById(props.id)
  return (
    <View
      class="h-14 flex-row items-center justify-between border-b border-border bg-card px-6"
      desktop={{ windowDrag: true }}
      style={{ paddingLeft: Math.max(titleBar().left, 24) }}
    >
      <View class="flex-row items-center gap-3">
        <If when={nav.routes().length > 1}>
          <NavButton name="back" label="返回" onPress={() => nav.pop()} />
        </If>
        <View class="gap-1">
          <Text class="text-base font-semibold text-foreground">字幕校对</Text>
          <Text class="text-xs text-muted-foreground">
            {task()?.video_file.name ?? ''}
          </Text>
        </View>
      </View>
      <PrimaryButton
        label="导出"
        onPress={() => void workspace.saveReview(props.id)}
      />
    </View>
  )
}

function MediaBlock(props: {
  id: string
  selected: () => number
  setSelected: (index: number) => void
  player: { current?: VideoRef }
  paused: Signal<boolean>
  current: Signal<number>
  duration: Signal<number>
}) {
  const stopAt = signal<number | null>(null)
  const task = () => taskById(props.id)
  const playable = () => {
    const path = task()?.video_file.path
    return !!path && workspace.isPlayable(path)
  }
  const src = () => {
    const path = task()?.video_file.path
    return path ? workspace.fileUrl(path) : ''
  }
  return (
    <View class="gap-3 p-4">
      <If when={playable()}>
        <Video
          src={src()}
          ref={(node: VideoRef) => {
            props.player.current = node
          }}
          paused={props.paused()}
          class="h-64"
          onLoad={info => props.duration.set(info.duration)}
          onEnd={() => props.paused.set(true)}
          onError={err => workspace.setMessage(`媒体无法播放: ${err.message}`)}
          onProgress={progress => {
            props.current.set(progress.currentTime)
            const end = stopAt()
            if (end != null && progress.currentTime >= end) {
              props.paused.set(true)
              stopAt.set(null)
            }
            if (progress.duration > 0) props.duration.set(progress.duration)
          }}
        />
      </If>
      <If when={!playable()}>
        <View class="h-60 items-center justify-center gap-3 rounded-lg bg-muted">
          <Icon name="video" size={36} />
          <Text class="text-sm text-muted-foreground">关联视频以预览字幕</Text>
        </View>
      </If>
      <View class="flex-row gap-2">
        <OutlineButton
          label="播放/暂停"
          onPress={() => {
            stopAt.set(null)
            props.paused.update(value => !value)
          }}
        />
        <OutlineButton
          label="预览此段"
          onPress={() => {
            const segment = segmentAt(props.id, props.selected())
            if (!segment) return
            props.player.current?.seek(segment.start)
            props.current.set(segment.start)
            stopAt.set(segment.end)
            props.paused.set(false)
          }}
        />
        <OutlineButton
          label="关联视频"
          onPress={() => {
            void (async () => {
              const paths = await workspace.pickFiles('media')
              const path = paths[0]
              if (path) await workspace.attachMedia(props.id, path)
            })()
          }}
        />
      </View>
      <Text class="text-sm text-foreground">
        {props.current().toFixed(3)} / {props.duration().toFixed(3)} 秒
      </Text>
      <Text class="text-sm text-foreground">
        {task()?.segments.find(
          item => props.current() >= item.start && props.current() < item.end
        )?.original_text ?? ''}
      </Text>
      <Timeline
        value={props.current()}
        max={props.duration()}
        onChange={time => {
          props.current.set(time)
          props.player.current?.seek(time)
        }}
      />
    </View>
  )
}

function TimingControls(props: {
  id: string
  selected: Signal<number>
  current: Signal<number>
}) {
  const startDraft = signal('')
  const endDraft = signal('')
  effect(() => {
    const segment = segmentAt(props.id, props.selected())
    if (!segment) return
    startDraft.set(segment.start.toFixed(3))
    endDraft.set(segment.end.toFixed(3))
  })
  return (
    <View class="gap-2">
      <View class="flex-row items-center gap-2">
        <Text class="text-sm text-foreground">开始（秒）</Text>
        <Field
          placeholder="开始秒数"
          value={startDraft()}
          onChange={value => startDraft.set(value)}
        />
        <Text class="text-sm text-foreground">结束（秒）</Text>
        <Field
          placeholder="结束秒数"
          value={endDraft()}
          onChange={value => endDraft.set(value)}
        />
        <OutlineButton
          label="应用时间"
          onPress={() => {
            const start = Number(startDraft())
            const end = Number(endDraft())
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
              workspace.setMessage('请输入有效秒数，例如 1.250')
              return
            }
            workspace.editTiming(props.id, props.selected(), start, end)
          }}
        />
      </View>
      <View class="flex-row flex-wrap gap-2">
        <OutlineButton
          label="起点设为播放头"
          onPress={() => {
            const segment = segmentAt(props.id, props.selected())
            if (!segment) return
            workspace.editTiming(
              props.id,
              props.selected(),
              props.current(),
              segment.end
            )
          }}
        />
        <OutlineButton
          label="终点设为播放头"
          onPress={() => {
            const segment = segmentAt(props.id, props.selected())
            if (!segment) return
            workspace.editTiming(
              props.id,
              props.selected(),
              segment.start,
              props.current()
            )
          }}
        />
        <OutlineButton
          label="播放头处分段"
          onPress={() =>
            workspace.cutSegment(props.id, props.selected(), props.current())
          }
        />
        <OutlineButton
          label="合并下一段"
          onPress={() => workspace.cutSegment(props.id, props.selected(), null)}
        />
      </View>
    </View>
  )
}

function Editor(props: {
  id: string
  selected: Signal<number>
  player: { current?: VideoRef }
  current: Signal<number>
  paused: Signal<boolean>
  duration: Signal<number>
}) {
  const task = () => taskById(props.id)
  const segment = () => segmentAt(props.id, props.selected())
  const update = (patch: Partial<Segment>) => {
    const current = segment()
    if (!current) return
    workspace.updateSegment(props.id, { ...current, ...patch })
  }
  const maxEnd = () =>
    Math.max(
      props.duration(),
      ...(task()?.segments.map(item => item.end) ?? [1]),
      1
    )
  const markdown = () => {
    const path = task()?.output_artifacts?.polished_markdown
    if (!path) return '文稿尚未生成。'
    return workspace.readMarkdown(path)
  }
  return (
    <SectionCard class="gap-3">
      <If when={task()?.kind === 'document'}>
        <TextView
          markdown={markdown()}
          selectable
          class="gap-3 text-sm text-foreground"
          onLinkPress={event => {
            const seconds = event.url.startsWith('#t=')
              ? Number(event.url.slice(3))
              : NaN
            if (Number.isFinite(seconds) && seconds >= 0) {
              props.player.current?.seek(seconds)
              props.current.set(seconds)
              props.paused.set(false)
            }
          }}
        />
      </If>
      <Text class="text-sm text-muted-foreground">
        {segment()
          ? `${segment()!.start.toFixed(2)}s – ${segment()!.end.toFixed(2)}s`
          : ''}
      </Text>
      <TimingControls
        id={props.id}
        selected={props.selected}
        current={props.current}
      />
      <Text class="text-sm font-medium text-foreground">拖改时间轴</Text>
      <Timeline
        value={segment()?.start ?? 0}
        max={maxEnd()}
        range={
          [segment()?.start ?? 0, segment()?.end ?? 0.1] as [number, number]
        }
        onChange={() => {}}
        onRangeChange={(start, end) => {
          const current = segment()
          if (!current) return
          if (
            Math.abs(current.start - start) < 0.0005 &&
            Math.abs(current.end - end) < 0.0005
          )
            return
          update({ start, end })
        }}
      />
      <Text class="text-sm font-medium text-foreground">原文</Text>
      <Input
        multiline
        value={segment()?.original_text ?? ''}
        onChange={({ value }) => {
          if (value === (segment()?.original_text ?? '')) return
          update({ original_text: value })
        }}
        class="min-h-[72px] rounded-md border border-input p-3 text-foreground"
      />
      <Text class="text-sm font-medium text-foreground">译文</Text>
      <Input
        multiline
        value={segment()?.translated_text ?? ''}
        onChange={({ value }) => {
          if (value === (segment()?.translated_text ?? '')) return
          update({ translated_text: value })
        }}
        class="min-h-[72px] rounded-md border border-input p-3 text-foreground"
      />
      <Text class="text-sm text-destructive">
        {issuesOf(props.id)
          .filter(issue => issue.segmentId === segment()?.id)
          .map(issue => `${issue.kind}: ${issue.message}`)
          .join('\n')}
      </Text>
      <Text class="text-sm text-foreground">{state().message}</Text>
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
      <View class="flex-row gap-2">
        <OutlineButton
          label="单段重译"
          onPress={() => {
            const id = segment()?.id
            if (id) void workspace.retranslateCurrent(props.id, id)
          }}
        />
        <PrimaryButton
          label={
            task()?.kind === 'document' ? '保存并重新整理' : '保存并重新导出'
          }
          onPress={() => void workspace.saveReview(props.id)}
        />
      </View>
    </SectionCard>
  )
}

export function ReviewPage(props: { id: string }) {
  const selected = signal(0)
  const paused = signal(true)
  const current = signal(0)
  const duration = signal(0)
  const player: { current?: VideoRef } = {}
  const task = () => taskById(props.id)
  const issueText = () => {
    const currentTask = task()
    if (!currentTask) return ''
    const issues = issuesOf(props.id)
    if (issues.length === 0)
      return `暂无问题 · 共 ${currentTask.segments.length} 段字幕`
    return `${issues.length} 个问题 · 共 ${currentTask.segments.length} 段字幕`
  }
  return (
    <NavPage title="校对工作台" header={<ReviewHeader id={props.id} />}>
      <View class="flex-1 items-center px-6 py-5">
        <View class="w-full max-w-6xl flex-1 flex-row gap-5">
          <View class="max-w-lg flex-1 gap-4">
            <SectionCard class="p-0">
              <MediaBlock
                id={props.id}
                selected={() => selected()}
                setSelected={index => selected.set(index)}
                player={player}
                paused={paused}
                current={current}
                duration={duration}
              />
            </SectionCard>
            <SectionCard class="gap-3">
              <Text class="text-sm font-semibold text-foreground">
                检查问题
              </Text>
              <Text class="text-xs text-muted-foreground">{issueText()}</Text>
              <Scroll class="flex-1">
                <Text class="text-sm text-muted-foreground">
                  {issuesOf(props.id)
                    .slice(0, 12)
                    .map(issue => issue.message)
                    .join('\n')}
                </Text>
              </Scroll>
            </SectionCard>
          </View>
          <View class="flex-1 gap-3">
            <View class="flex-row items-center justify-between">
              <Text class="text-sm font-semibold text-foreground">
                字幕段落
              </Text>
              <Text class="text-xs text-muted-foreground">
                {selected() + 1} / {task()?.segments.length ?? 0}
              </Text>
            </View>
            <List
              each={task()?.segments ?? []}
              keyExtractor={item => item.id}
              estimatedItemSize={32}
              class="h-24 rounded-lg border border-border"
            >
              {(item, index) => (
                <GhostButton
                  label={`${item().start.toFixed(2)} – ${item().end.toFixed(2)}   ${item().original_text}`}
                  selected={selected() === index()}
                  align="start"
                  onPress={() => {
                    selected.set(index())
                    player.current?.seek(item().start)
                    current.set(item().start)
                    paused.set(true)
                  }}
                />
              )}
            </List>
            <Scroll class="flex-1">
              <Editor
                id={props.id}
                selected={selected}
                player={player}
                current={current}
                paused={paused}
                duration={duration}
              />
            </Scroll>
          </View>
        </View>
      </View>
    </NavPage>
  )
}
