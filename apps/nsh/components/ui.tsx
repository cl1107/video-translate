import type { JSX } from 'nsh'
import { Image, Text, View } from 'nsh'
import {
  Button,
  Checkbox,
  Input,
  Progress,
  Select,
  Slider,
  Switch,
} from 'nsh/base'
import { setColorScheme } from 'nsh'
import logo from '../assets/logo.png'
import { selectedService, state, workspace } from '../store'

const iconPaths: Record<string, string> = {
  check: 'M5 12l4 4L19 6',
  chevron: 'M6 9l6 6 6-6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  video: 'M3 5h13v14H3zM16 10l5-3v10l-5-3',
  link: 'M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2',
  captions: 'M2 4h20v16H2zM6 10h2m4 0h6M6 14h6m4 0h2',
  document:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
  tasks: 'M3 6l1 1 2-2m-3 7l1 1 2-2m-3 7l1 1 2-2M10 6h11M10 12h11M10 18h11',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  back: 'M12 5l-7 7 7 7M5 12h14',
}

export function Icon(props: { name: string; size?: number; class?: string }) {
  const d = iconPaths[props.name] ?? 'M4 3h16v18H4z'
  const size = props.size ?? 16
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
  return (
    <Image
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      class={`tint-foreground ${props.class ?? ''}`}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  )
}

export function Logo() {
  return <Image src={logo} class="h-8 w-8" />
}

export function PrimaryButton(props: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Button
      onPress={props.onPress}
      disabled={props.disabled}
      class="h-9 items-center justify-center rounded-md bg-primary px-4 active:opacity-85 hover:opacity-90 focus:outline-2 focus:outline-ring disabled:opacity-50"
    >
      <Text class="text-sm text-primary-foreground">{props.label}</Text>
    </Button>
  )
}

export function OutlineButton(props: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Button
      onPress={props.onPress}
      disabled={props.disabled}
      class="h-9 items-center justify-center rounded-md border border-border bg-background px-4 hover:bg-muted active:bg-muted focus:outline-2 focus:outline-ring disabled:opacity-50"
    >
      <Text class="text-sm text-foreground">{props.label}</Text>
    </Button>
  )
}

export function GhostButton(props: {
  label: string
  selected?: boolean
  onPress: () => void
  align?: 'start' | 'center'
}) {
  const start = props.align === 'start'
  return (
    <Button
      onPress={props.onPress}
      class={`h-8 items-center gap-1.5 rounded-md px-2.5 hover:bg-muted ${start ? 'flex-row justify-start' : 'justify-center'} ${props.selected ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'}`}
    >
      <Text
        class={
          props.selected
            ? 'text-sm text-foreground'
            : 'text-sm text-muted-foreground'
        }
      >
        {props.label}
      </Text>
    </Button>
  )
}

export function NavButton(props: {
  name: string
  label: string
  selected?: boolean
  onPress: () => void
  align?: 'start' | 'center'
}) {
  const start = props.align === 'start'
  return (
    <Button
      onPress={props.onPress}
      class={`h-8 flex-row items-center gap-1.5 rounded-md px-2.5 hover:bg-muted focus:outline-2 focus:outline-ring ${start ? 'w-full justify-start' : 'justify-center'} ${props.selected ? 'bg-muted' : 'bg-transparent'}`}
    >
      <Icon name={props.name} size={16} />
      <Text
        class={
          props.selected
            ? 'text-sm text-foreground'
            : 'text-sm text-muted-foreground'
        }
      >
        {props.label}
      </Text>
    </Button>
  )
}

export function Field(props: {
  value: string
  placeholder?: string
  onChange: (value: string) => void
  masked?: boolean
  multiline?: boolean
  class?: string
  accessibilityLabel?: string
}) {
  return (
    <Input
      value={props.value}
      placeholder={props.placeholder}
      masked={props.masked}
      multiline={props.multiline}
      accessibilityLabel={props.accessibilityLabel}
      onChange={({ value }) => props.onChange(value)}
      class={`h-9 flex-1 rounded-md border border-input px-3 text-sm text-foreground focus:border-ring ${props.multiline ? 'min-h-20 py-2' : ''} ${props.class ?? ''}`}
    />
  )
}

export function LabeledField(props: {
  label: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  masked?: boolean
}) {
  return (
    <View class="gap-1">
      <Text class="text-sm text-muted-foreground">{props.label}</Text>
      <Field
        value={props.value}
        accessibilityLabel={props.label}
        placeholder={props.placeholder}
        onChange={props.onChange}
        masked={props.masked}
      />
    </View>
  )
}

export function LabeledSwitch(props: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Switch
      checked={props.checked}
      onChange={({ checked }) => props.onChange(checked)}
      class="flex-row items-center gap-3"
      trackClass="w-11 rounded-full bg-muted p-0.5 transition-colors checked:bg-primary"
      thumbClass="size-5 rounded-full bg-background transition-transform checked:translate-x-5"
    >
      <Text class="text-sm text-foreground">{props.label}</Text>
    </Switch>
  )
}

export function BarProgress(props: { value: number }) {
  return (
    <Progress
      value={props.value}
      class="h-2"
      trackClass="h-2 overflow-hidden rounded-full bg-muted"
      indicatorClass="h-2 rounded-full bg-chart-1"
    />
  )
}

export function Timeline(props: {
  value: number
  max: number
  onChange: (value: number) => void
  range?: [number, number]
  onRangeChange?: (start: number, end: number) => void
}) {
  const isRange = props.range != null
  return (
    <Slider
      value={isRange ? props.range : props.value}
      min={0}
      max={Math.max(props.max, 0.1)}
      step={0.05}
      class="h-6"
      trackClass="h-6 justify-center"
      indicatorClass="h-1.5 rounded-full bg-muted"
      rangeClass="h-1.5 rounded-full bg-chart-1"
      thumbClass="size-4 rounded-full bg-primary"
      onChange={({ value }) => {
        if (Array.isArray(value)) props.onRangeChange?.(value[0], value[1])
        else props.onChange(value)
      }}
    />
  )
}

export function SectionCard(props: { children?: JSX.Element; class?: string }) {
  return (
    <View
      class={`gap-4 rounded-xl border border-border bg-card p-5 ${props.class ?? ''}`}
    >
      {props.children}
    </View>
  )
}

export function ThemeButton() {
  const modes = ['system', 'light', 'dark'] as const
  let index = 0
  return (
    <Button
      onPress={() => {
        index = (index + 1) % modes.length
        setColorScheme(modes[index])
      }}
      class="h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
      accessibilityLabel="外观"
    >
      <Icon name="sun" size={16} />
    </Button>
  )
}

export function BurnCheckbox() {
  return (
    <Checkbox
      checked={state().burn}
      onChange={({ checked }) => workspace.setBurn(checked)}
      class="flex-row items-center gap-2"
      indicatorClass="size-3.5 items-center justify-center rounded-xs border border-input bg-background checked:bg-primary"
      indicator={
        <If when={state().burn}>
          <Icon name="check" size={10} class="tint-primary-foreground" />
        </If>
      }
    >
      <Text class="text-xs text-muted-foreground">烧录硬字幕</Text>
    </Checkbox>
  )
}

export function ServiceSelect() {
  const settings = () => state().settings
  const current = () => selectedService()?.name ?? ''
  return (
    <Select
      items={settings().llm_services.map(service => ({
        value: service.id,
        title: service.name,
      }))}
      value={settings().selected_llm_service_id}
      onChange={({ value }) => {
        if (value) workspace.selectService(value)
      }}
      accessibilityLabel="模型服务"
      popupClass="rounded-md border border-border bg-popover p-1 shadow-md"
      itemClass="rounded-md px-3 py-2 focus:bg-accent selected:font-medium"
      trigger={
        <View class="h-8 w-72 flex-row items-center justify-between rounded-md border border-input px-3">
          <Text class="text-sm text-foreground">{current()}</Text>
          <Icon name="chevron" size={14} />
        </View>
      }
    />
  )
}

export function OptionField(props: {
  label: string
  value: string
  items: { value: string; title: string }[]
  onChange: (value: string) => void
}) {
  const title = () =>
    props.items.find(item => item.value === props.value)?.title ?? props.value
  return (
    <View class="gap-2">
      <Text class="text-sm text-foreground">{props.label}</Text>
      <Select
        items={props.items}
        value={props.value}
        onChange={({ value }) => {
          if (value) props.onChange(value)
        }}
        accessibilityLabel={props.label}
        popupClass="rounded-md border border-border bg-popover p-1 shadow-md"
        itemClass="rounded-md px-3 py-2 focus:bg-accent selected:font-medium"
        trigger={
          <View class="h-9 flex-row items-center justify-between rounded-md border border-input px-3">
            <Text class="text-sm text-foreground">{title()}</Text>
            <Icon name="chevron" size={14} />
          </View>
        }
      />
    </View>
  )
}
