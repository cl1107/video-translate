import { Scroll, Text, View, signal } from 'nsh'
import { AlertDialog } from 'nsh/base'
import { setColorScheme } from 'nsh'
import {
  Field,
  GhostButton,
  LabeledField,
  LabeledSwitch,
  NavButton,
  OptionField,
  OutlineButton,
  PrimaryButton,
  SectionCard,
  ThemeButton,
} from '../components/ui'
import { patchSettings, selectedService, state, workspace } from '../store'

export function SettingsPage() {
  const category = signal(0)
  const glossarySource = signal('')
  const glossaryTarget = signal('')
  const settings = () => state().settings
  const service = () => selectedService()
  const canDelete = () => settings().llm_services.length > 1

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
      <View class="w-56 shrink-0 items-stretch gap-2 border-r border-border bg-card px-3 pt-12">
        <NavButton
          name="back"
          label="返回工作区"
          align="start"
          onPress={() => workspace.setPanel('add')}
        />
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
        <View class="flex-row items-center justify-between border-t border-border py-3">
          <Text class="text-xs text-muted-foreground">外观</Text>
          <ThemeButton />
        </View>
      </View>
      <Scroll class="flex-1">
        <View class="items-center p-8">
          <View class="w-full max-w-3xl gap-5">
            <Text class="text-xl font-semibold text-foreground">
              {category() === 1 ? '模型' : category() === 2 ? '系统' : '常规'}
            </Text>
            <If when={category() === 0}>
              <View class="gap-5">
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
                  <Text class="text-sm text-muted-foreground">
                    {settings()
                      .glossary.map(
                        entry => `${entry.source} → ${entry.target}`
                      )
                      .join('\n')}
                  </Text>
                  <View class="flex-row gap-2">
                    <Field
                      placeholder="原文"
                      value={glossarySource()}
                      onChange={value => glossarySource.set(value)}
                    />
                    <Field
                      placeholder="译文"
                      value={glossaryTarget()}
                      onChange={value => glossaryTarget.set(value)}
                    />
                    <PrimaryButton
                      label="添加术语"
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
              <View class="gap-5">
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
                  <LabeledField
                    label="翻译模型"
                    placeholder="qwen2.5:7b"
                    value={settings().translate_model}
                    onChange={value =>
                      patchSettings({ translate_model: value })
                    }
                  />
                  <LabeledField
                    label="润色模型（空=跟随翻译）"
                    value={settings().polish_model}
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
                <View class="flex-row gap-2">
                  <OutlineButton
                    label="系统自检"
                    onPress={() => void workspace.runSystemCheck()}
                  />
                  <OutlineButton
                    label="测试模型服务"
                    onPress={() => void workspace.listModels()}
                  />
                  <OutlineButton
                    label="下载 SenseVoice"
                    onPress={() => void workspace.downloadSensevoice()}
                  />
                </View>
                <Text class="text-sm text-muted-foreground">
                  {state()
                    .checks.map(
                      item =>
                        `${item.name} ${item.available ? '就绪' : '缺失'} ${item.version ?? item.error ?? ''}`
                    )
                    .join('\n')}
                </Text>
              </SectionCard>
            </If>
          </View>
        </View>
      </Scroll>
    </View>
  )
}
