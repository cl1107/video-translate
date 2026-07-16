# separator

2026-07-16 · golden pair（base-nova registry）· 成功

## Changed

- `@radix-ui/react-separator` → 可调用 `@base-ui/react/separator`
- 去掉 `decorative` prop；class 用 `data-horizontal` / `data-vertical`
- leftover 扫描：干净

## Left alone

- DependencyChecker 中的 Separator 用法

## Behavior changes

- 始终语义 `role="separator"`（原 decorative 可装饰）

## Verify by hand

- 依赖检查页分隔线显示
