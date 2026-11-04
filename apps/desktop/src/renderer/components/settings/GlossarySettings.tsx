import { Plus, Trash2 } from 'lucide-react'
import type { GlossaryEntry } from '../../../shared/settings'
import { Button } from 'renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from 'renderer/components/ui/card'
import { Label } from 'renderer/components/ui/label'

const inputClassName =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

interface GlossarySettingsProps {
  glossary: GlossaryEntry[]
  onChange: (glossary: GlossaryEntry[]) => void
  disabled?: boolean
}

export function GlossarySettings({
  glossary,
  onChange,
  disabled = false,
}: GlossarySettingsProps) {
  const updateEntry = (
    index: number,
    field: keyof GlossaryEntry,
    value: string
  ) => {
    onChange(
      glossary.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      )
    )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base">术语库</CardTitle>
          <p className="text-xs text-muted-foreground">
            翻译时优先采用指定译法；留空的条目保存时会自动移除。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...glossary, { source: '', target: '' }])}
        >
          <Plus data-icon="inline-start" />
          添加术语
        </Button>
      </CardHeader>
      <CardContent>
        <fieldset disabled={disabled} className="space-y-3">
          {glossary.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
              还没有术语。为人名、产品名或专业词汇添加固定译法。
            </p>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 px-1 text-xs text-muted-foreground sm:grid">
                <Label>原文</Label>
                <Label>指定译法</Label>
                <span className="sr-only">操作</span>
              </div>
              {glossary.map((entry, index) => (
                <div
                  key={`glossary-${index}`}
                  className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem]"
                >
                  <div className="space-y-1 sm:space-y-0">
                    <Label className="text-xs text-muted-foreground sm:sr-only">
                      原文
                    </Label>
                    <input
                      className={inputClassName}
                      value={entry.source}
                      placeholder="原文术语"
                      onChange={event =>
                        updateEntry(index, 'source', event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1 sm:space-y-0">
                    <Label className="text-xs text-muted-foreground sm:sr-only">
                      指定译法
                    </Label>
                    <input
                      className={inputClassName}
                      value={entry.target}
                      placeholder="指定译法"
                      onChange={event =>
                        updateEntry(index, 'target', event.target.value)
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除术语 ${index + 1}`}
                    onClick={() =>
                      onChange(glossary.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      </CardContent>
    </Card>
  )
}
