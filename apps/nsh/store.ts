import { signal } from 'nsh'
import { Workspace } from 'video-translate/native'
import type { Snapshot, TaskKind, TranslationTask } from './types'

export const workspace = new Workspace()

const snap = signal(workspace.snapshot() as Snapshot)
let messageTimer: ReturnType<typeof setTimeout> | undefined
let lastMessage = snap().message

function scheduleMessageDismiss(message: string) {
  if (message === lastMessage) return
  lastMessage = message
  if (messageTimer !== undefined) {
    clearTimeout(messageTimer)
    messageTimer = undefined
  }
  if (message) {
    messageTimer = setTimeout(() => {
      messageTimer = undefined
      if (snap().message === message) {
        workspace.setMessage('')
      }
    }, 3000)
  }
}

scheduleMessageDismiss(lastMessage)
workspace.onChange(value => {
  const next = value as Snapshot
  snap.set(next)
  scheduleMessageDismiss(next.message)
})

export const state = () => snap()

export function visibleTasks(): TranslationTask[] {
  const current = snap()
  return current.tasks.filter(task => task.kind === current.kind)
}

export function selectedTask(): TranslationTask | undefined {
  const current = snap()
  if (!current.selected_id) return undefined
  return current.tasks.find(task => task.id === current.selected_id)
}

export function canReuseTask(task: TranslationTask | undefined) {
  return (
    !!task && task.segments.some(segment => segment.original_text.trim() !== '')
  )
}

export function taskById(id: string): TranslationTask | undefined {
  return snap().tasks.find(task => task.id === id)
}

export function selectedService() {
  const settings = snap().settings
  return settings.llm_services.find(
    item => item.id === settings.selected_llm_service_id
  )
}

export function patchSettings(patch: Partial<Snapshot['settings']>) {
  workspace.updateSettings({ ...snap().settings, ...patch })
}

export const statusLabel: Record<string, string> = {
  pending: '排队中',
  downloading: '下载中',
  extracting_audio: '提取音频',
  transcribing: '识别中',
  polishing: '润色中',
  translating: '翻译中',
  generating_subtitles: '生成字幕',
  burning_subtitles: '烧录字幕',
  completed: '已完成',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消',
}

export function isRunning(status: string) {
  return !isTerminal(status) && status !== 'paused' && status !== 'pending'
}

export function isTerminal(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function formatStamp(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

export function pathsFromUris(uris: string[]) {
  return uris.map(uri => {
    const raw = uri.startsWith('file://') ? uri.slice('file://'.length) : uri
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })
}

export async function pickAndAdd(kind: string) {
  const paths = await workspace.pickFiles(kind)
  if (paths.length) await workspace.addPaths(paths)
}

export function setKind(kind: TaskKind) {
  workspace.setKind(kind)
}
