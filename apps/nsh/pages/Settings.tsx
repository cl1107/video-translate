import { Scroll, Text, View, signal } from 'nsh'
import { AlertDialog } from 'nsh/base'
import { setColorScheme } from 'nsh'
import {
  Field,
  GhostButton,
  Icon,
  LabeledField,
  LabeledSwitch,
  NavButton,
  OptionField,
  OutlineButton,
  PrimaryButton,
  SectionCard,
  StyledSelect,
  ThemeButton,
} from '../components/ui'
import { patchSettings, selectedService, state, workspace } from '../store'

type ModelRequest<T> =
  | { scope: string; kind: 'pending' }
  | { scope: string; kind: 'success'; value: T }
  | { scope: string; kind: 'error'; message: string }

function modelRequest<T>(scope: () => string) {
  const result = signal<ModelRequest<T> | null>(null)
  return {
    current: () => {
      const request = result()
      return request?.scope === scope() ? request : null
    },
    async run(action: () => Promise<T>) {
      const request: ModelRequest<T> = { scope: scope(), kind: 'pending' }
      result.set(request)
      try {
        const value = await action()
        if (result() === request)
          result.set({ ...request, kind: 'success', value })
      } catch (error) {
        if (result() === request) {
          result.set({
            ...request,
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
  }
}

function ModelField(props: {
  label: string
  placeholder?: string
  value: string
  fallback?: string
  scope: string
  items: { value: string; title: string }[]
  onChange: (value: string) => void
}) {
  const model = () => props.value.trim() || props.fallback?.trim() || ''
  const test = modelRequest<void>(() => JSON.stringify([props.scope, model()]))
  const pending = () => test.current()?.kind === 'pending'
  const message = () => {
    const result = test.current()
    if (result?.kind === 'success') return '模型可用'
    if (result?.kind === 'error') return result.message
    return ''
  }

  return (
    <View class="gap-2">
      <LabeledField
        label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        onChange={props.onChange}
      />
      <View class="flex-row flex-wrap items-center gap-2">
        <If when={props.items.length > 0}>
          <StyledSelect
            items={props.items}
            value={props.value}
            accessibilityLabel={`选择${props.label}`}
            onChange={({ value }) => {
              if (value) props.onChange(value)
            }}
            trigger={
              <View class="h-9 flex-row items-center gap-2 rounded-md border border-border bg-background px-4 hover:bg-muted">
                <Text class="text-sm text-foreground">从列表选择</Text>
                <Icon name="chevron" size={14} />
              </View>
            }
          />
        </If>
        <OutlineButton
          label={pending() ? '测试中…' : `测试${props.label}`}
          disabled={!model() || pending()}
          onPress={() => void test.run(() => workspace.testModel(model()))}
        />
      </View>
      <If when={message()}>
        <Text
          class={
            test.current()?.kind === 'error'
              ? 'text-sm text-destructive'
              : 'text-sm text-muted-foreground'
          }
        >
          {message()}
        </Text>
      </If>
    </View>
  )
}

export function SettingsPage() {
  const category = signal(0)
  const glossarySource = signal('')
  const glossaryTarget = signal('')
  const settings = () => state().settings
  const service = () => selectedService()
  const canDelete = () => settings().llm_services.length > 1

  const modelScope = () =>
    JSON.stringify([
      settings().selected_llm_service_id,
      settings().llm_base_url,
      state().api_key,
    ])
  const models = modelRequest<string[]>(modelScope)
  const modelItems = () => {
    const result = models.current()
    return result?.kind === 'success'
      ? result.value.map(value => ({ value, title: value }))
      : []
  }
  const listMessage = () => {
    const result = models.current()
    if (result?.kind === 'error') return result.message
    if (result?.kind !== 'success') return ''
    return result.value.length
      ? `已获取 ${result.value.length} 个模型`
      : '服务未返回模型'
  }

  const removeService = async () => {
    if (!canDelete()) return
    const { action } = await AlertDialog.show({
      title: '删除此模型服务？',
      description: '将同时删除该服务保存在本机的 API Key。至少保留一个服务。',
      actions: [
        { id: 'cancel', label: '取消', role: 'cancel' },
        { id: 'delete', label: '删除', role: 'destructive' },
      ],
    })
    if (action === 'delete') workspace.removeService()
  }

  return (
    <View class="flex-1 flex-row">
      <View class="w-48 shrink-0 items-stretch gap-1 border-r border-sidebar-border bg-sidebar px-4 pt-12">
        <NavButton
          name="back"
          label="返回工作区"
          align="start"
          onPress={() => workspace.setPanel('add')}
        />
        <View class="my-3 h-px bg-border" />
        <NavButton
          name="settings"
          label="常规"
          align="start"
          selected={category() === 0}
          onPress={() => category.set(0)}
        />
        <NavButton
          name="document"
          label="模型"
          align="start"
          selected={category() === 1}
          onPress={() => category.set(1)}
        />
        <NavButton
          name="tasks"
          label="系统"
          align="start"
          selected={category() === 2}
          onPress={() => category.set(2)}
        />
        <View class="flex-1" />
        <View class="gap-1 border-t border-border py-3">
          <View class="flex-row items-center justify-between">
            <Text class="text-xs text-muted-foreground">外观</Text>
            <ThemeButton />
          </View>
        </View>
      </View>
      <Scroll class="flex-1">
        <View class="items-center px-6 py-8">
          <View class="w-full max-w-3xl gap-6">
            <Text class="text-lg font-semibold text-foreground">
              {category() === 1
                ? '模型设置'
                : category() === 2
                  ? '系统设置'
                  : '常规设置'}
            </Text>
            <If when={category() === 0}>
              <View class="gap-4">
                <SectionCard>
                  <Text class="text-base font-semibold text-foreground">
                    外观
                  </Text>
                  <View class="flex-row items-center justify-between">
                    <Text class="text-sm text-foreground">主题</Text>
                    <View class="flex-row gap-1 rounded-lg bg-muted p-1">
                      <OutlineButton
                        label="浅色"
                        onPress={() => setColorScheme('light')}
                      />
                      <OutlineButton
                        label="暗色"
                        onPress={() => setColorScheme('dark')}
                      />
                      <OutlineButton
                        label="跟随系统"
                        onPress={() => setColorScheme('system')}
                      />
                    </View>
                  </View>
                </SectionCard>
                <SectionCard>
                  <Text class="text-base font-semibold text-foreground">
                    语言与输出
                  </Text>
                  <OptionField
                    label="目标语言"
                    value={settings().target_language}
                    items={[
                      { value: 'zh', title: '中文' },
                      { value: 'en', title: '英语' },
                      { value: 'ja', title: '日语' },
                      { value: 'ko', title: '韩语' },
                      { value: 'fr', title: '法语' },
                      { value: 'de', title: '德语' },
                      { value: 'es', title: '西班牙语' },
                    ]}
                    onChange={value =>
                      patchSettings({ target_language: value })
                    }
                  />
                  <OptionField
                    label="源语言"
                    value={settings().source_language}
                    items={[
                      { value: 'auto', title: '自动检测' },
                      { value: 'zh', title: '中文' },
                      { value: 'en', title: '英语' },
                      { value: 'ja', title: '日语' },
                      { value: 'ko', title: '韩语' },
                      { value: 'yue', title: '粤语' },
                    ]}
                    onChange={value =>
                      patchSettings({ source_language: value })
                    }
                  />
                  <OptionField
                    label="字幕输出位置"
                    value={
                      settings().subtitle_output_location === 'source-directory'
                        ? 'source'
                        : 'output'
                    }
                    items={[
                      { value: 'output', title: 'output 子目录（默认）' },
                      { value: 'source', title: '源文件同目录' },
                    ]}
                    onChange={value =>
                      patchSettings({
                        subtitle_output_location:
                          value === 'source'
                            ? 'source-directory'
                            : 'output-subdirectory',
                      })
                    }
                  />
                </SectionCard>
                <SectionCard>
                  <Text class="text-base font-semibold text-foreground">
                    字幕颜色
                  </Text>
                  <View class="flex-row gap-4">
                    <View class="flex-1">
                      <LabeledField
                        label="原文颜色"
                        placeholder="#FFFFFF"
                        value={settings().original_subtitle_color}
                        onChange={value =>
                          patchSettings({ original_subtitle_color: value })
                        }
                      />
                    </View>
                    <View class="flex-1">
                      <LabeledField
                        label="译文颜色"
                        placeholder="#FFFF00"
                        value={settings().translated_subtitle_color}
                        onChange={value =>
                          patchSettings({ translated_subtitle_color: value })
                        }
                      />
                    </View>
                  </View>
                </SectionCard>
                <SectionCard>
                  <Text class="text-base font-medium text-foreground">
                    术语库
                  </Text>
                  <If when={settings().glossary.length === 0}>
                    <Text class="text-sm text-muted-foreground">
                      添加固定译法，统一字幕中的人名和术语
                    </Text>
                  </If>
                  <If when={settings().glossary.length > 0}>
                    <Text class="text-sm text-foreground">
                      {settings()
                        .glossary.map(
                          entry => `${entry.source} → ${entry.target}`
                        )
                        .join('\n')}
                    </Text>
                  </If>
                  <View class="flex-row gap-2">
                    <Field
                      placeholder="原文"
                      accessibilityLabel="术语原文"
                      value={glossarySource()}
                      onChange={value => glossarySource.set(value)}
                    />
                    <Field
                      placeholder="译文"
                      accessibilityLabel="术语译文"
                      value={glossaryTarget()}
                      onChange={value => glossaryTarget.set(value)}
                    />
                    <PrimaryButton
                      label="添加术语"
                      disabled={!glossarySource().trim()}
                      onPress={() => {
                        const source = glossarySource().trim()
                        const target = glossaryTarget()
                        if (!source) return
                        patchSettings({
                          glossary: [
                            ...settings().glossary,
                            { source, target },
                          ],
                        })
                        glossarySource.set('')
                        glossaryTarget.set('')
                      }}
                    />
                  </View>
                </SectionCard>
              </View>
            </If>
            <If when={category() === 1}>
              <View class="gap-4">
                <SectionCard>
                  <Text class="text-sm font-semibold text-foreground">
                    模型服务
                  </Text>
                  <View class="flex-row flex-wrap gap-2">
                    <Each of={settings().llm_services} key={item => item.id}>
                      {item => (
                        <GhostButton
                          label={item().name}
                          selected={
                            settings().selected_llm_service_id === item().id
                          }
                          onPress={() => workspace.selectService(item().id)}
                        />
                      )}
                    </Each>
                    <OutlineButton
                      label="添加模型服务"
                      onPress={() => workspace.addService()}
                    />
                    <OutlineButton
                      label="删除当前服务"
                      disabled={!canDelete()}
                      onPress={() => void removeService()}
                    />
                  </View>
                  <LabeledField
                    label="服务名称"
                    placeholder="服务名称"
                    value={service()?.name ?? ''}
                    onChange={value => {
                      const id = settings().selected_llm_service_id
                      patchSettings({
                        llm_services: settings().llm_services.map(item =>
                          item.id === id ? { ...item, name: value } : item
                        ),
                      })
                    }}
                  />
                  <LabeledField
                    label="模型服务 Endpoint"
                    placeholder="http://127.0.0.1:11434/v1"
                    value={settings().llm_base_url}
                    onChange={value => patchSettings({ llm_base_url: value })}
                  />
                  <LabeledField
                    label="API Key（仅存本机，文件权限 600）"
                    placeholder="可选；本地推理可留空"
                    value={state().api_key}
                    masked
                    onChange={value => workspace.setApiKey(value)}
                  />
                  <View class="flex-row flex-wrap items-center gap-2">
                    <OutlineButton
                      label={
                        models.current()?.kind === 'pending'
                          ? '获取中…'
                          : '获取模型列表'
                      }
                      disabled={
                        !settings().llm_base_url.trim() ||
                        models.current()?.kind === 'pending'
                      }
                      onPress={() =>
                        void models.run(() => workspace.listModels())
                      }
                    />
                    <If when={listMessage()}>
                      <Text
                        class={
                          models.current()?.kind === 'error'
                            ? 'text-sm text-destructive'
                            : 'text-sm text-muted-foreground'
                        }
                      >
                        {listMessage()}
                      </Text>
                    </If>
                  </View>
                  <ModelField
                    label="翻译模型"
                    placeholder="qwen2.5:7b"
                    value={settings().translate_model}
                    scope={modelScope()}
                    items={modelItems()}
                    onChange={value =>
                      patchSettings({ translate_model: value })
                    }
                  />
                  <ModelField
                    label="润色模型"
                    placeholder="留空时使用翻译模型"
                    value={settings().polish_model}
                    fallback={settings().translate_model}
                    scope={modelScope()}
                    items={modelItems()}
                    onChange={value => patchSettings({ polish_model: value })}
                  />
                </SectionCard>
                <SectionCard>
                  <Text class="text-sm font-semibold text-foreground">
                    语音识别
                  </Text>
                  <View class="flex-row gap-2">
                    <GhostButton
                      label="SenseVoice"
                      selected={settings().asr_engine !== 'funasr-nano'}
                      onPress={() =>
                        patchSettings({ asr_engine: 'sensevoice' })
                      }
                    />
                    <GhostButton
                      label="Fun-ASR-Nano"
                      selected={settings().asr_engine === 'funasr-nano'}
                      onPress={() =>
                        patchSettings({ asr_engine: 'funasr-nano' })
                      }
                    />
                  </View>
                  <Text class="text-sm text-muted-foreground">
                    内置 sherpa-onnx 本地识别；模型缺失时点「下载 SenseVoice」。
                  </Text>
                  <LabeledSwitch
                    label="模拟识别（仅供测试）"
                    checked={settings().mock_asr}
                    onChange={checked => patchSettings({ mock_asr: checked })}
                  />
                  <LabeledSwitch
                    label="模拟翻译"
                    checked={settings().mock_llm}
                    onChange={checked => patchSettings({ mock_llm: checked })}
                  />
                  <LabeledSwitch
                    label="识别后润色"
                    checked={settings().polish_transcript}
                    onChange={checked =>
                      patchSettings({ polish_transcript: checked })
                    }
                  />
                </SectionCard>
              </View>
            </If>
            <If when={category() === 2}>
              <SectionCard>
                <Text class="text-sm font-semibold text-foreground">
                  系统与下载
                </Text>
                <LabeledField
                  label="下载代理"
                  placeholder="127.0.0.1:7890"
                  value={settings().download_proxy}
                  onChange={value => patchSettings({ download_proxy: value })}
                />
                <OptionField
                  label="在线下载登录来源"
                  value={
                    settings().download_cookie_browser === 'auto'
                      ? 'none'
                      : settings().download_cookie_browser
                  }
                  items={[
                    { value: 'none', title: '匿名下载' },
                    { value: 'ego', title: 'Ego Lite（免授权）' },
                    { value: 'edge', title: 'Microsoft Edge' },
                    { value: 'chrome', title: 'Google Chrome' },
                    { value: 'safari', title: 'Safari' },
                    { value: 'firefox', title: 'Firefox' },
                    { value: 'brave', title: 'Brave' },
                    { value: 'chromium', title: 'Chromium' },
                  ]}
                  onChange={value =>
                    patchSettings({ download_cookie_browser: value })
                  }
                />
                <If when={settings().download_cookie_browser === 'ego'}>
                  <Text class="text-sm text-muted-foreground">
                    将从 Ego Lite 直接读取已登录站点的
                    Cookie，无需授予完全磁盘访问权限。请先在 Ego Lite
                    中登录目标网站（如 YouTube）。
                  </Text>
                </If>
                <If
                  when={
                    !['none', 'auto', '', 'ego'].includes(
                      settings().download_cookie_browser
                    )
                  }
                >
                  <View class="gap-2 rounded-md border border-border bg-muted p-3">
                    <Text class="text-sm font-medium text-foreground">
                      需要授予「完全磁盘访问权限」
                    </Text>
                    <Text class="text-xs text-muted-foreground">
                      1. 点击「准备拖拽授权」，同时打开系统设置与
                      Finder（已选中当前应用）；{'\n'}
                      2. 将 Finder
                      中的「视频翻译助手.app」直接拖入右侧权限列表；{'\n'}
                      3. 按提示重启应用后即可读取浏览器 Cookie。
                    </Text>
                    <View class="flex-row flex-wrap gap-2">
                      <OutlineButton
                        label="准备拖拽授权"
                        onPress={() => workspace.prepareFullDiskAccess()}
                      />
                      <OutlineButton
                        label="仅打开系统设置"
                        onPress={() => workspace.openFullDiskAccess()}
                      />
                    </View>
                  </View>
                </If>
                <If
                  when={['none', 'auto', ''].includes(
                    settings().download_cookie_browser
                  )}
                >
                  <Text class="text-sm text-muted-foreground">
                    YouTube 要求验证时，可选择「Ego
                    Lite（免授权）」或已在浏览器登录的来源并重试任务。
                  </Text>
                </If>
                <View class="flex-row gap-2">
                  <OutlineButton
                    label="系统自检"
                    onPress={() => void workspace.runSystemCheck()}
                  />
                  <OutlineButton
                    label="下载 SenseVoice"
                    onPress={() => void workspace.downloadSensevoice()}
                  />
                </View>
                <If when={state().checks.length > 0}>
                  <View class="rounded-lg border border-border bg-background px-3">
                    <Each of={state().checks} key={item => item.name}>
                      {(item, index) => (
                        <View
                          class={`gap-1 py-3 ${index() > 0 ? 'border-t border-border' : ''}`}
                        >
                          <View class="flex-row items-center justify-between gap-3">
                            <Text class="min-w-0 flex-1 text-sm font-medium text-foreground">
                              {item().name}
                            </Text>
                            <Text
                              class={`shrink-0 text-xs font-medium ${item().available ? 'text-chart-2' : 'text-destructive'}`}
                            >
                              {item().available ? '就绪' : '缺失'}
                            </Text>
                          </View>
                          <If when={item().error ?? item().version}>
                            <Text class="text-xs text-muted-foreground">
                              {item().error ?? item().version}
                            </Text>
                          </If>
                        </View>
                      )}
                    </Each>
                  </View>
                </If>
              </SectionCard>
              <SectionCard>
                <Text class="text-sm font-semibold text-foreground">关于</Text>
                <View class="flex-row items-center justify-between">
                  <Text class="text-sm text-foreground">视频翻译助手</Text>
                  <Text class="text-sm text-muted-foreground">
                    {`v${state().app_version}`}
                  </Text>
                </View>
              </SectionCard>
            </If>
          </View>
        </View>
      </Scroll>
    </View>
  )
}
