# progress

2026-07-16 · golden pair（base-nova registry）· 成功

## Changed

- `@radix-ui/react-progress` → `@base-ui/react/progress`
- 结构：Root + Track + Indicator（不再手写 transform 宽度）
- 导出额外 `ProgressTrack/Indicator/Label/Value`
- leftover 扫描：干净
- `TaskList.tsx`：`className="w-full"`

## Left alone

- 系统检查进度视图（非 shadcn Progress）

## Behavior changes

- 默认轨道 `h-1`、背景 `bg-muted`（原 `h-2` + `bg-primary/20`）
- 宽度由 Base UI 根据 value/max 驱动

## Verify by hand

- 任务进度 0→100 动画是否平滑
