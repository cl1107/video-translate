import type { TaskCreationSettings } from '../shared/settings'

/** 顶层 Endpoint/模型字段是所选服务的快照，改它们必须同步 llmServices。 */
export function syncSelectedLlmService(
  settings: TaskCreationSettings,
  patch: {
    llmBaseUrl?: string
    translateModel?: string
    polishModel?: string
    selectedLlmServiceId?: string
  }
): Partial<TaskCreationSettings> {
  const selectedId = patch.selectedLlmServiceId ?? settings.selectedLlmServiceId
  const llmServices = settings.llmServices.map(service => {
    if (service.id !== selectedId) return service
    return {
      ...service,
      llmBaseUrl: patch.llmBaseUrl ?? service.llmBaseUrl,
      translateModel: patch.translateModel ?? service.translateModel,
      polishModel: patch.polishModel ?? service.polishModel,
    }
  })
  const selected =
    llmServices.find(service => service.id === selectedId) ?? llmServices[0]
  if (!selected) throw new Error('请至少配置一个模型服务')
  return {
    llmServices,
    selectedLlmServiceId: selected.id,
    llmBaseUrl: selected.llmBaseUrl,
    translateModel: selected.translateModel,
    polishModel: selected.polishModel,
  }
}
