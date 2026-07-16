# button

2026-07-16 · golden pair（base-nova registry）· 成功

## Changed

- `apps/desktop/src/renderer/components/ui/button.tsx`：`@radix-ui/react-slot` + asChild → `@base-ui/react/button` 的 `ButtonPrimitive`
- 样式替换为 base-nova 变体（更紧凑高度、rounded-lg、destructive 半透明等）
- leftover 扫描：无 `radix-ui` / `@radix-ui`

## Left alone

- 业务侧 Button 调用（未使用 asChild）

## Behavior changes

- 默认高度约 h-8（原 h-9）；icon 尺寸 size-8（原 size-9）

## Verify by hand

- 主界面 / 设置页主按钮与 ghost 图标按钮点击、disabled、focus ring
