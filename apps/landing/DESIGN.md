---
name: 视频翻译助手 · Landing
description: 创作者的本地字幕工作台 — 锋利深色营销页
colors:
  ink: "#0b0d0c"
  paper: "#f0efe7"
  acid: "#d9ff65"
  acid-hover: "#e5ff91"
  orange: "#ff6b3d"
  text: "#f4f4ef"
  muted: "#aaa9a2"
  muted-soft: "#a09f98"
  muted-dim: "#777872"
  line: "rgba(255, 255, 255, 0.14)"
  studio: "#161917"
  studio-canvas: "#0e100f"
typography:
  display:
    fontFamily: "'Noto Sans SC Variable', sans-serif"
    fontSize: "clamp(57px, 6.2vw, 102px)"
    fontWeight: 820
    lineHeight: 0.98
    letterSpacing: "-0.075em"
  headline:
    fontFamily: "'Noto Sans SC Variable', sans-serif"
    fontSize: "clamp(42px, 5.2vw, 76px)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  body:
    fontFamily: "'Noto Sans SC Variable', sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.85
  label:
    fontFamily: "'Noto Sans SC Variable', sans-serif"
    fontSize: "11px"
    fontWeight: 670
    letterSpacing: "0.15em"
  button:
    fontFamily: "'Noto Sans SC Variable', sans-serif"
    fontSize: "13px"
    fontWeight: 740
rounded:
  pill: "99px"
  brand-mark: "9px"
  studio: "24px"
  studio-inner: "16px"
  frame: "11px"
spacing:
  page-gutter: "48px"
  hero-gap: "clamp(50px, 7vw, 112px)"
  section-y: "150px"
  header-h: "84px"
components:
  button-primary:
    backgroundColor: "{colors.acid}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 23px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.acid-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 23px"
    height: "52px"
  header-download:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "11px 16px"
  chip:
    backgroundColor: "rgba(255, 255, 255, 0.04)"
    textColor: "#c5c6bf"
    rounded: "{rounded.pill}"
    padding: "7px 11px"
---

# Design System: 视频翻译助手 · Landing

## 1. Overview

**Creative North Star: "The Acid Studio"**

官网是**酸绿演播室**：深色舞台、一句主张打穿、真实工具感演示壳，而不是 SaaS 模板。品牌个性「锋利 · 现代 · 自信」在这里可以比桌面应用更大声——酸绿（`#d9ff65`）是记忆点与主 CTA 燃料，纸色与橙色作辅。字体为 Noto Sans SC Variable，中文营销排版优先。

访客 10 秒应记住：**创作者的本地字幕工作台**。主 CTA 永远是免费下载；次 CTA「看它如何工作」服务犹豫者。信念阶梯：在线/本地都能出字幕 → 本地安全 → 流程简单 → 可选软/硬字幕。

明确拒绝：通用 SaaS 仪表盘、企业沉重后台、花哨 AI 演示站、廉价绿色科技感。酸绿是品牌酸，不是黑客终端绿。

**Key Characteristics:**

- 深底 `#0b0d0c` + 酸绿强调 + 纸色 CTA 反衬
- 全圆角 pill 按钮与芯片；工作室 壳可更大圆角
- Display 超大标题 + 强调色斜体行
- 舞台式 elevation：studio 壳大阴影、微旋转
- 180ms ease 微交互（抬起 / 色变），非编排长动画

## 2. Colors

### Primary

- **Acid Lime** (`#d9ff65`): 主 CTA、标题强调词、关键高亮、hover 目标。稀缺而锋利。
- **Acid Hover** (`#e5ff91`): 主按钮 hover。

### Secondary

- **Signal Orange** (`#ff6b3d`): 次级点缀（链接导入等示意），勿与酸绿抢主 CTA。

### Neutral

- **Void Ink** (`#0b0d0c`): 页面底、主文字反色目标。
- **Paper** (`#f0efe7`): 顶栏下载钮、浅色控件。
- **Stage Text** (`#f4f4ef`): 默认亮字。
- **Muted Copy** (`#aaa9a2` / `#a09f98` / `#777872`): 说明、kicker、平台行 — 保持可读，勿再洗淡。
- **Hairline** (`rgba(255,255,255,0.14)`): 分割与 ghost 边。
- **Studio Shell** (`#161917` / `#0e100f`): 产品演示窗外壳与画布。

### Named Rules

**The Acid Spotlight Rule.** 酸绿是聚光灯：主 CTA、标题一处强调、关键状态。禁止整页刷绿或做成矩阵终端。

**The No-Fake-Proof Rule.** 无客户证言时不伪造社会证明；用真实能力与工作流演示建立信任。

## 3. Typography

**Display Font:** Noto Sans SC Variable  
**Body Font:** Noto Sans SC Variable  
**Label/Mono Font:** 同族；元数据可用 `ui-monospace` 小字

**Character:** 单一中文无衬线家族，靠极端字重与字距制造锋利感。Display 紧、重、大；body 行高宽松以托住主张。

### Hierarchy

- **Display** (820, `clamp(57px, 6.2vw, 102px)`, lh 0.98, ls ~-0.075em): Hero 主标题。注意：字距已偏紧，新增时不要再压到更负；优先改 copy 或缩小 clamp。
- **Headline** (800, `clamp(42px, 5.2vw, 76px)`): 区块大标题。
- **Body** (400, 17px, lh 1.85): Hero 说明与长文。
- **Label / Kicker** (670, 11px, ls 0.15em, uppercase): 少量 kicker — 禁止每个 section 都贴一条。
- **Button** (740, 13px): CTA 标签。

### Named Rules

**The One-Kicker Rule.** 全页最多审慎使用 uppercase kicker；禁止每节 `01 / 02 / 03` 式脚手架（工作流若本身是序列可保留一处编号）。

**The Display Ceiling Rule.** 标题 clamp 上限不超过约 102px；字距不要比现网更紧到字母粘连。

## 4. Elevation

**舞台抬升。** 页面底是平坦深色；产品 studio 壳、卡片与按钮通过阴影与微位移进入「前景」。

### Shadow Vocabulary

- **Studio stage** (`0 42px 110px rgba(0,0,0,0.45)`): 主演示壳。
- **Panel float** (`0 18px 38px` / `0 30px 80px` 级): 次级浮层。
- **Control** (`0 8px 35px rgba(0,0,0,0.26)`): 播放钮等控件。

### Named Rules

**The Stage-Not-Card-Grid Rule.** 大阴影只给真正的「舞台物件」（studio 壳、关键面板），禁止给每一张能力卡都套同款巨型阴影网格。

## 5. Components

### Buttons

- **Shape:** 全 pill（`border-radius: 99px`）
- **Primary:** 酸绿底 + ink 字；`min-height: 52px`；hover 更亮绿 + `translateY(-3px)`
- **Ghost:** 透明 + hairline 边；hover 边更亮
- **Header download:** 纸色底 pill，hover 转酸绿

### Chips

- **Style:** 半透明白底 + 细边 + pill；酸绿 check 图标
- **Use:** Hero 能力速览，非导航

### Cards / Containers

- **Feature cards:** 大内边距、细边或弱底，hover 可轻位移；避免同质三列 icon 卡无限复制
- **Studio shell:** 24px 圆角、12px 内垫、微旋转、舞台阴影 — 签名物件

### Navigation

- **Header:** 三栏 grid（品牌 | 锚点 | 下载），高 84px，底部分割线
- **Links:** 灰字，hover 酸绿
- **Mobile:** 保持下载 CTA 可达（实现时折叠导航不得吞掉主 CTA）

### Signature: Studio shell

假窗口 + 视频帧 + 字幕预览 + 本地 pill，用来**展示工作流真实感**，不是装饰插画。新增示意时保持克制几何，禁止手绘 SVG 涂鸦。

## 6. Do's and Don'ts

### Do:

- **Do** 让首屏与记忆点对齐「创作者的本地字幕工作台」。
- **Do** 主 CTA「免费下载」在首屏与页内重复可达。
- **Do** 用工作流与真实能力推进信念阶梯（在线/本地、本地安全、简单、可导出/烧录）。
- **Do** 酸绿作聚光灯；纸色作反衬 CTA。
- **Do** 与 desktop 同源气质：下完安装包应感到是同一个产品。

### Don't:

- **Don't** 通用 SaaS 仪表盘：紫渐变、万能卡片网格、空泛 AI 口号。
- **Don't** 企业级沉重后台感。
- **Don't** 花哨 AI 演示站：粒子、玻璃拟态、假大数字英雄区。
- **Don't** 廉价绿色科技感：黑客绿终端、矩阵雨（酸绿 ≠ 终端绿）。
- **Don't** 伪造证言或虚标数据。
- **Don't** 每节 uppercase kicker + 编号脚手架。
- **Don't** 渐变文字、侧边彩条强调、手绘 sketch SVG。
- **Don't** 让动效挡住可读性；必须尊重减弱动画。
