import { Check, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Button } from 'renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from 'renderer/components/ui/card'
import { Label } from 'renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/components/ui/select'
import { cn } from 'renderer/lib/utils'
import {
  selectLlmService,
  type AppSettings,
  type LlmServiceConfig,
} from '../../../shared/settings'

interface ServiceState {
  apiKeyDraft: string
  configured: boolean
  keyMessage: string
  clearing: boolean
  models: string[]
  testing: boolean
  testResult: { ok: boolean; message: string } | null
}

const EMPTY_SERVICE_STATE: ServiceState = {
  apiKeyDraft: '',
  configured: false,
  keyMessage: '',
  clearing: false,
  models: [],
  testing: false,
  testResult: null,
}

/** Credentials and request results belong to a service ID, including while switching drafts. */
export function useModelServicesSettings(services: LlmServiceConfig[]) {
  const [states, setStates] = useState<Record<string, ServiceState>>({})
  const loadedStatuses = useRef(new Set<string>())
  const revisions = useRef(new Map<string, number>())
  const keyRevisions = useRef(new Map<string, number>())

  function updateState(id: string, update: Partial<ServiceState>) {
    setStates(prev => ({
      ...prev,
      [id]: { ...EMPTY_SERVICE_STATE, ...prev[id], ...update },
    }))
  }

  useEffect(() => {
    for (const service of services) {
      if (loadedStatuses.current.has(service.id)) continue
      loadedStatuses.current.add(service.id)
      const revision = keyRevisions.current.get(service.id) ?? 0
      void window.App.getLlmApiKeyStatus(service.id)
        .then(result => {
          if ((keyRevisions.current.get(service.id) ?? 0) !== revision) return
          if (!result.success) throw new Error('无法读取已保存 Key')
          updateState(service.id, { configured: result.configured })
        })
        .catch(error => {
          if ((keyRevisions.current.get(service.id) ?? 0) !== revision) return
          updateState(service.id, {
            keyMessage: `读取 Key 状态失败：${error instanceof Error ? error.message : String(error)}`,
          })
        })
    }
  }, [services])

  function invalidate(id: string) {
    revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1)
    updateState(id, { models: [], testing: false, testResult: null })
  }

  function setApiKeyDraft(id: string, value: string) {
    invalidate(id)
    updateState(id, { apiKeyDraft: value, keyMessage: '' })
  }

  async function saveKeys() {
    for (const service of services) {
      const draft = states[service.id]?.apiKeyDraft ?? ''
      if (!draft.trim()) continue
      keyRevisions.current.set(
        service.id,
        (keyRevisions.current.get(service.id) ?? 0) + 1
      )
      const result = await window.App.setLlmApiKey(draft.trim(), service.id)
      if (!result.success)
        throw new Error(
          `${service.name} 的 API Key 保存失败：${result.error || '未知错误'}`
        )
      setStates(prev => ({
        ...prev,
        [service.id]: {
          ...EMPTY_SERVICE_STATE,
          ...prev[service.id],
          configured: true,
          apiKeyDraft:
            prev[service.id]?.apiKeyDraft === draft
              ? ''
              : (prev[service.id]?.apiKeyDraft ?? ''),
          keyMessage: '',
        },
      }))
    }
  }

  async function clearKey(id: string) {
    keyRevisions.current.set(id, (keyRevisions.current.get(id) ?? 0) + 1)
    updateState(id, { clearing: true, keyMessage: '' })
    try {
      const result = await window.App.clearLlmApiKey(id)
      if (!result.success) throw new Error(result.error || '未知错误')
      invalidate(id)
      updateState(id, { configured: false, keyMessage: '已清除已保存的 Key' })
    } catch (error) {
      updateState(id, {
        keyMessage: `清除失败：${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      updateState(id, { clearing: false })
    }
  }

  async function testConnection(service: LlmServiceConfig) {
    const revision = (revisions.current.get(service.id) ?? 0) + 1
    revisions.current.set(service.id, revision)
    updateState(service.id, { testing: true, testResult: null, models: [] })
    try {
      const result = await window.App.listLlmModels(
        service.llmBaseUrl.trim(),
        states[service.id]?.apiKeyDraft.trim() || undefined,
        service.id
      )
      if (revisions.current.get(service.id) !== revision) return
      updateState(
        service.id,
        result.success
          ? {
              models: result.models,
              testResult: {
                ok: true,
                message: `已连接 · ${result.models.length} 个模型`,
              },
            }
          : { testResult: { ok: false, message: result.error || '连接失败' } }
      )
    } catch (error) {
      if (revisions.current.get(service.id) !== revision) return
      updateState(service.id, {
        testResult: {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      if (revisions.current.get(service.id) === revision)
        updateState(service.id, { testing: false })
    }
  }

  return {
    states,
    setApiKeyDraft,
    saveKeys,
    clearKey,
    testConnection,
    invalidate,
  }
}

const inputClassName =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

interface ModelServicesSettingsProps {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  controller: ReturnType<typeof useModelServicesSettings>
  disabled?: boolean
}

export function ModelServicesSettings({
  settings,
  setSettings,
  controller,
  disabled = false,
}: ModelServicesSettingsProps) {
  const service = settings.llmServices.find(
    item => item.id === settings.selectedLlmServiceId
  )
  if (!service) throw new Error('当前模型服务不存在')
  const state = controller.states[service.id] ?? EMPTY_SERVICE_STATE
  const translateItems = Object.fromEntries(
    [...new Set([service.translateModel, ...state.models].filter(Boolean))].map(
      model => [model, model]
    )
  )
  const polishItems = {
    '': '跟随翻译模型',
    ...Object.fromEntries(
      [...new Set([service.polishModel, ...state.models].filter(Boolean))].map(
        model => [model, model]
      )
    ),
  }

  function updateService(update: Partial<Omit<LlmServiceConfig, 'id'>>) {
    if (!service) return
    if (update.llmBaseUrl !== undefined) controller.invalidate(service.id)
    setSettings(prev =>
      selectLlmService(
        {
          ...prev,
          llmServices: prev.llmServices.map(item =>
            item.id === service.id ? { ...item, ...update } : item
          ),
        },
        prev.selectedLlmServiceId
      )
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">模型服务</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset
          disabled={disabled}
          className="grid min-w-0 gap-5 md:grid-cols-[10rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,1fr)]"
        >
          <aside className="flex min-w-0 flex-col gap-3 md:sticky md:top-20 md:self-start">
            <nav className="flex flex-col gap-1" aria-label="模型服务列表">
              {settings.llmServices.map(item => {
                const selected = item.id === service.id
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant={selected ? 'secondary' : 'ghost'}
                    className="w-full justify-start"
                    aria-current={selected ? 'true' : undefined}
                    aria-controls="llm-service-editor"
                    title={item.name}
                    onClick={() =>
                      setSettings(prev => selectLlmService(prev, item.id))
                    }
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {item.name || '未命名服务'}
                    </span>
                    {selected && <Check data-icon="inline-end" />}
                  </Button>
                )
              })}
            </nav>
            <div className="flex flex-col gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  const added = {
                    id: crypto.randomUUID(),
                    name: `服务 ${settings.llmServices.length + 1}`,
                    llmBaseUrl: '',
                    translateModel: '',
                    polishModel: '',
                  }
                  setSettings(prev =>
                    selectLlmService(
                      { ...prev, llmServices: [...prev.llmServices, added] },
                      added.id
                    )
                  )
                }}
              >
                <Plus data-icon="inline-start" />
                新增服务
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                disabled={settings.llmServices.length <= 1}
                onClick={() => {
                  controller.invalidate(service.id)
                  setSettings(prev => {
                    const remaining = prev.llmServices.filter(
                      item => item.id !== service.id
                    )
                    const first = remaining[0]
                    return first
                      ? selectLlmService(
                          { ...prev, llmServices: remaining },
                          first.id
                        )
                      : prev
                  })
                }}
              >
                <Trash2 data-icon="inline-start" />
                删除服务
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              保存后默认使用所选服务，开始任务时可切换。
            </p>
          </aside>
          <div
            id="llm-service-editor"
            className="flex min-w-0 flex-col gap-4 border-t pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-5"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="llm-service-name">服务名称</Label>
              <input
                id="llm-service-name"
                className={inputClassName}
                value={service.name}
                onChange={event => updateService({ name: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="llm-base-url">API Endpoint</Label>
              <input
                id="llm-base-url"
                type="url"
                className={inputClassName}
                placeholder="http://127.0.0.1:11434 或 https://api.deepseek.com"
                value={service.llmBaseUrl}
                onChange={event =>
                  updateService({ llmBaseUrl: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                支持 OpenAI 兼容服务：Ollama、LM Studio、vLLM 或在线 API。
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="llm-api-key">API Key（可选）</Label>
              <input
                id="llm-api-key"
                type="password"
                autoComplete="off"
                className={inputClassName}
                placeholder={
                  state.configured
                    ? '已配置（输入新 Key 可覆盖）'
                    : '本地服务通常无需填写'
                }
                value={state.apiKeyDraft}
                onChange={event =>
                  controller.setApiKeyDraft(service.id, event.target.value)
                }
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  各服务独立加密存储；填写后点击「保存设置」。
                </p>
                {state.configured && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={state.clearing}
                    onClick={() => void controller.clearKey(service.id)}
                  >
                    {state.clearing ? '清除中…' : '清除已保存 Key'}
                  </Button>
                )}
              </div>
              {state.keyMessage && (
                <p className="text-xs text-muted-foreground" role="status">
                  {state.keyMessage}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={state.testing || !service.llmBaseUrl.trim()}
                onClick={() => void controller.testConnection(service)}
              >
                {state.testing ? (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                测试连接
              </Button>
              {state.testResult && (
                <span
                  className={cn(
                    'flex items-center gap-1 text-xs',
                    state.testResult.ok ? 'text-brand-ink' : 'text-destructive'
                  )}
                  role="status"
                >
                  {state.testResult.ok && <Check className="size-3.5" />}
                  {state.testResult.message}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="translate-model">翻译模型</Label>
              <Select
                value={service.translateModel || null}
                items={translateItems}
                onValueChange={value => {
                  if (value != null) updateService({ translateModel: value })
                }}
              >
                <SelectTrigger id="translate-model" className="w-full min-w-0">
                  <SelectValue placeholder="先测试连接获取模型列表" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(translateItems).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="polish-model">润色模型</Label>
              <Select
                value={service.polishModel}
                items={polishItems}
                onValueChange={value => {
                  if (value != null) updateService({ polishModel: value })
                }}
              >
                <SelectTrigger id="polish-model" className="w-full min-w-0">
                  <SelectValue placeholder="跟随翻译模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(polishItems).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                建议使用通用对话模型润色；hy-mt 等翻译专用模型不适合润色。
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="polish-transcript"
                  checked={settings.polishTranscript}
                  onChange={event =>
                    setSettings(prev => ({
                      ...prev,
                      polishTranscript: event.target.checked,
                    }))
                  }
                  className="rounded"
                />
                <Label htmlFor="polish-transcript">识别结果先润色再翻译</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                校对识别文本的错字和标点，仅向所选服务发送文本，不上传音视频。
              </p>
            </div>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  )
}
