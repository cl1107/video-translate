# project

2026-07-16 · whole-project · base-nova 视觉 + Base UI 底层 · 成功

## Changed

- `apps/desktop/components.json`：`style` 从 `new-york` → `base-nova`
- 依赖：新增 `@base-ui/react@^1.6.0`；移除全部 `@radix-ui/*`（label/progress/select/separator/slot）
- UI 包装器全部换为 base-nova 注册表源码（lucide 替换 IconPlaceholder）：
  - button / badge / label / progress / select / separator / alert / card
- 消费方：
  - `SettingsPanel.tsx`：Select 增加 `items` 标签映射、`onValueChange` 空值守卫、`value` 用 `null`、触发器 `w-full`
  - `TaskList.tsx`：Progress `className` 改为 `w-full`（base-nova 高度在 Track 上）

## Left alone

- `apps/landing`：无 shadcn / Radix UI
- 第三方非 Radix 库：本项目未使用 cmdk / vaul / sonner 等
- 主题 CSS 变量（`globals.css`）：仍为 neutral oklch 令牌，与 base-nova 兼容

## Behavior changes

- Select 关闭触发器默认展示：依赖 Root `items` 映射标签（已补）
- Progress 默认轨道高度为 `h-1`（原自定义 `h-1.5`）
- Card / Button / Badge 圆角与密度切换为 base-nova（ring、更紧凑按钮等）
- Button/Badge 不再暴露 `asChild`，改用 Base UI `render`（业务侧原先未使用 asChild）

## Verify by hand

1. 设置页打开每个下拉：标签显示中文/友好文案，而非 raw value
2. 翻译模型项内「下载」按钮仍可点击且不误关列表
3. 任务列表进度条宽度铺满、数值变化时指示条更新
4. 暗色模式下按钮/徽章/卡片对比度
5. 键盘：Tab 到 Select、方向键与 Enter 选中

## Build

- `pnpm typecheck`：通过
- `pnpm test`：70/70 通过
- postinstall `electron-vite build`：通过
- 剩余 Radix wrapper：0
