# select

2026-07-16 · golden pair（base-nova registry）· 成功

## Changed

- `@radix-ui/react-select` → `@base-ui/react/select`
- Content：Portal > Positioner > Popup；Viewport → List；ScrollButton → ScrollArrow
- IconPlaceholder → lucide `CheckIcon` / `ChevronDownIcon` / `ChevronUpIcon`
- CSS 变量：`--available-height` / `--anchor-width` / `--transform-origin`
- leftover 扫描：干净
- `SettingsPanel.tsx`：全部 Select 补 `items`、null 守卫、触发器全宽

## Left alone

- 无其他 Select 消费方

## Behavior changes

- SelectValue 默认显示 raw value，需 Root `items` 才能显示友好标签（已补）
- `onValueChange(value | null, eventDetails)`：空值时 return
- 弹层 ring + rounded-lg（base-nova）

## Verify by hand

- 各设置下拉标签文案
- 列表滚动箭头（长模型列表）
- 模型项内下载按钮仍可用
