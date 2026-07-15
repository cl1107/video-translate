---
name: 视频翻译助手 · Desktop
description: 本地优先的字幕工作台 — 安静、利落、任务优先
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.97 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  accent: "oklch(0.97 0 0)"
  border: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  dark-background: "oklch(0.145 0 0)"
  dark-foreground: "oklch(0.985 0 0)"
  dark-primary: "oklch(0.985 0 0)"
  dark-muted: "oklch(0.269 0 0)"
typography:
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  sm: "calc(0.625rem - 4px)"
  md: "calc(0.625rem - 2px)"
  lg: "0.625rem"
  xl: "calc(0.625rem + 4px)"
spacing:
  page-x: "1.5rem"
  page-y: "1.5rem"
  content-max: "64rem"
  section-gap: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "oklch(0.205 0 0 / 0.9)"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.25rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "1.5rem 0"
---

# Design System: 视频翻译助手 · Desktop

## 1. Overview

**Creative North Star: "The Quiet Workbench"**

桌面端是**安静工作台**：中性、可扫读、密度服务任务。用户来是为了把视频变成可用字幕，不是来感受品牌秀场。视觉语言来自 shadcn/ui New York + neutral 基底，用 OKLCH 中性斜坡与克制圆角支撑「锋利 · 现代 · 自信」——自信来自准确状态与稳定反馈，而不是饱和强调色。

气质对齐 Linear / Raycast 一类桌面工具：短标签、清晰层级、少装饰。深度几乎只靠边框与轻微 `shadow-sm` / `shadow-xs`，不做舞台式抬升（那是官网的事）。

明确拒绝 PRODUCT.md 中的反例：通用 SaaS 仪表盘、企业沉重后台、花哨 AI 演示站、廉价绿色科技感。

**Key Characteristics:**

- 中性 OKLCH 斜坡；主色即近黑墨色，而非品牌饱和色
- 任务优先：上传 / 任务 / 设置路径永远清楚
- 扁平分层：边框 + 轻阴影，无戏剧 elevation
- 系统字体栈；字号以 `text-sm` / `text-base` 为主
- 支持 `.dark` 反转，同一套语义 token

## 2. Colors

单一中性主色 + 语义 destructive；无独立品牌色主轴（品牌酸绿留给 landing）。

### Primary

- **Near-black Ink** (`oklch(0.205 0 0)`): 主按钮、关键强调、导航选中态。在暗色主题反转为 `oklch(0.985 0 0)`。

### Neutral

- **Pure Surface** (`oklch(1 0 0)`): 页面与卡片底。
- **Ink Text** (`oklch(0.145 0 0)`): 正文与标题。
- **Muted Fill** (`oklch(0.97 0 0)`): 次级按钮、分段控件底、弱强调。
- **Muted Text** (`oklch(0.556 0 0)`): 说明文案、次要元信息。须保持可读；勿再洗成更浅灰。
- **Hairline Border** (`oklch(0.922 0 0)`): 分割线、卡片描边、输入框边。
- **Focus Ring** (`oklch(0.708 0 0)`): `focus-visible` 环。

### Semantic

- **Destructive** (`oklch(0.577 0.245 27.325)`): 删除、失败、危险操作。仅用于真正破坏性语义。

### Named Rules

**The Ink-Not-Brand Rule.** 桌面主色是墨色中性，不是 landing 的酸绿。应用内偶尔可引用品牌色，但不得把工具主 CTA 染成营销霓虹。

**The Readable Muted Rule.** `muted-foreground` 已是对比下限附近；说明文案禁止再叠透明灰或更浅色阶。

## 3. Typography

**Display Font:** 无独立 display 家族（工作台不需要英雄排版）  
**Body Font:** system-ui / -apple-system / Segoe UI（系统无衬线）  
**Label/Mono Font:** 继承 body；日志等可局部 mono，但非系统主轴

**Character:** 单一系统无衬线，权重与字号分层，不靠字体配对制造个性。个性来自布局节奏与文案利落度。

### Hierarchy

- **Title** (600, ~18px / `text-lg`, tight tracking): 页面主标题，如「添加要翻译的视频」。
- **Body** (400, 14px / `text-sm`, 1.5): 默认正文与说明。
- **Label** (500, 14px / `text-sm`): 按钮与控件标签。
- **Meta** (400–500, 11–12px): 角标、任务计数、次级状态。

### Named Rules

**The No-Hero-Type Rule.** 桌面禁止 marketing 级 clamp 大标题。最大标题停在 `text-lg`–`text-xl` 一带，把注意力留给任务控件。

## 4. Elevation

**扁平为默认。** 深度靠边框、背景阶（`background` / `card` / `muted`）与极轻阴影传达，不做大面积抬升。

### Shadow Vocabulary

- **Control lift** (`shadow-xs` on buttons): 主/描边按钮的轻微实体感。
- **Card rest** (`shadow-sm` on cards): 卡片与表面的安静落差。
- **No ambient stage shadows:** 禁止 `0 40px 100px` 级营销阴影。

### Named Rules

**The Flat-By-Default Rule.** 表面静止时几乎平坦。阴影只服务控件实体与卡片落差，不制造「漂浮产品渲染」。

## 5. Components

### Buttons

- **Shape:** 中等圆角（`rounded-md`，约 8px 级）
- **Primary:** 近黑底 + 浅色字；`h-9`，`px-4`；hover 略透明
- **Outline / Secondary / Ghost:** 描边或浅底；ghost 无边，hover 用 accent 底
- **Focus:** `ring` 色 3px 半透明环 + border
- **Character:** 克制精准 — 短标签、可扫读、无弹跳

### Cards / Containers

- **Corner Style:** `rounded-xl`（约 12–14px 级）
- **Background:** `card` 白/暗反转
- **Border:** 1px `border`
- **Shadow:** `shadow-sm` only
- **Internal Padding:** 水平 `px-6`，垂直区块 `py-6`，内部 gap `gap-6`

### Inputs / Fields

- **Style:** 描边输入（`border` / `input` token），背景随 surface
- **Focus:** ring token，非粗彩边
- **Error:** destructive 边与环

### Navigation

- **Top bar:** sticky，`h-14`，底部分割线，`bg-card`
- **Segmented tabs:** `bg-muted` 容器 + 选中 `default` 按钮
- **Settings:** outline 次级入口，不与主任务抢视觉

### Signature: Task + Upload surfaces

上传区与任务列表是核心：状态、进度、错误必须显式；空状态给出下一步（去上传），而非装饰插画堆砌。

## 6. Do's and Don'ts

### Do:

- **Do** 让每一屏的主路径指向导入 → 处理 → 导出字幕。
- **Do** 用语义 token（`primary` / `muted` / `destructive`）而不是任意灰。
- **Do** 保持依赖自检、任务失败等状态可行动（下一步按钮/说明）。
- **Do** 尊重 `prefers-reduced-motion`；动效仅状态反馈级。
- **Do** 文案短、准、中文优先（产品界面语境）。

### Don't:

- **Don't** 做成通用 SaaS 仪表盘：紫渐变、万能卡片网格、空泛 AI 口号。
- **Don't** 做成企业级沉重后台：信息过载、表格堆砌、冷冰冰运维感。
- **Don't** 做成花哨 AI 演示站：粒子、玻璃拟态、假大数字英雄区。
- **Don't** 做成廉价绿色科技感：黑客绿终端、矩阵雨。
- **Don't** 把 landing 的酸绿大面积搬进工具主色。
- **Don't** 使用侧边彩条（`border-left` > 1px）当强调、渐变文字、或 32px+ 夸张圆角卡片。
- **Don't** 用装饰性动效打断任务完成。
