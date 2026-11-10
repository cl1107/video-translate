import {
  ArrowRight,
  Bookmark,
  Check,
  FilePlus2,
  FileText,
  Languages,
  Link2,
  ListChecks,
  LockKeyhole,
  NotebookPen,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  Subtitles,
  WandSparkles,
  Waves,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import { GithubIcon } from '../components/GithubIcon'
import { DownloadCta } from '../components/DownloadCta'
import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { AppLink } from '../router'
import { APP_VERSION, repositoryUrl, siteUrl } from '../site'

const translations = {
  中文: '你的素材，始终留在自己的电脑里。',
  English: 'Your footage always stays on your own computer.',
  日本語: '映像素材は、いつも自分のパソコンの中に。',
}

/** 字幕工作流 */
const subtitleWorkflow = [
  {
    number: '01',
    label: '导入视频',
    detail: '本地文件、YouTube / B 站链接，或导入 SRT / VTT',
    icon: Link2,
  },
  {
    number: '02',
    label: '获取原文',
    detail: '平台字幕优先；无字幕再本地 ASR',
    icon: Subtitles,
  },
  {
    number: '03',
    label: '选择处理方式',
    detail: '仅提取原文无需模型服务；也可翻译并按需润色',
    icon: Languages,
  },
  {
    number: '04',
    label: '导出与校对',
    detail: 'SRT / ASS / 硬字幕；对照媒体改稿、单段重译',
    icon: ListChecks,
  },
]

/** 文稿工作流（独立入口） */
const documentWorkflow = [
  {
    number: '01',
    label: '导入音视频',
    detail: '本地文件或在线链接，支持常见音视频格式',
    icon: Link2,
  },
  {
    number: '02',
    label: '语音识别',
    detail: '平台字幕优先；否则本地 SenseVoice ASR',
    icon: Waves,
  },
  {
    number: '03',
    label: '整篇润色',
    detail: '大模型整理结构：标题、分段、列表，不丢信息',
    icon: NotebookPen,
  },
  {
    number: '04',
    label: '导出 Markdown',
    detail: '生成 .md，文末带来源时间索引，预览可跳转',
    icon: FileText,
  },
]

const waveformBars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123'
  .split('')
  .map(id => ({ id, height: id.charCodeAt(0) % 31 }))

const features = [
  {
    icon: Link2,
    eyebrow: 'URL IMPORT',
    title: '链接也能一键处理',
    description:
      '粘贴 YouTube、B 站等 yt-dlp 支持的链接，自动下载后进入字幕或文稿流水线。',
  },
  {
    icon: Subtitles,
    eyebrow: 'PLATFORM FIRST',
    title: '平台字幕优先',
    description:
      '有站内人工或自动字幕时直接采用，跳过语音识别；没有字幕再走本地 ASR。',
  },
  {
    icon: FileText,
    eyebrow: 'ORIGINAL ONLY',
    title: '只要原文，也能直接开始',
    description:
      '选择「仅提取原文」后，只生成原文 SRT，不启动翻译流程，也无需配置模型服务。',
  },
  {
    icon: NotebookPen,
    eyebrow: 'DOCUMENT MD',
    title: '音视频整理成 Markdown',
    description:
      '独立「文稿」工作流：识别后整篇润色为结构化 MD，文末附时间定位来源索引。',
  },
  {
    icon: ListChecks,
    eyebrow: 'REVIEW',
    title: '校对、术语与硬烧录',
    description:
      '对照媒体改原文/译文与时间轴，术语库固定译法；原文、译文、双语 SRT / ASS，可选硬字幕。',
  },
  {
    icon: LockKeyhole,
    eyebrow: 'LOCAL FIRST',
    title: '素材不离开设备',
    description:
      '视频、音频与 ASR 始终在本机。配置在线模型服务时，只发送识别后的文本。',
  },
]

const highlights = [
  '字幕工作台 + 文稿整理',
  '仅提取原文无需模型服务',
  '校对 / 导入 / 术语库',
  '断点恢复与结果复用',
  '在线链接 / 本地文件',
  '任务批量管理',
]

const releaseHighlights = [
  {
    icon: ListChecks,
    title: '字幕校对工作台',
    detail:
      '同步播放媒体，对照修改原文、译文与时间轴；问题清单标出空译、重叠和过长行。',
  },
  {
    icon: RotateCcw,
    title: '阶段断点恢复',
    detail:
      '识别、润色、翻译按成功块落盘。恢复任务只补未完成部分，成功 ASR 块不重复推理。',
  },
  {
    icon: Bookmark,
    title: '术语库与上下文',
    detail: '设置中维护固定译法；翻译时带上相邻原文，但只输出当前段。',
  },
  {
    icon: FilePlus2,
    title: '导入与跨工作流复用',
    detail:
      '导入 SRT / VTT 直接校对；完整转录可生成字幕或文稿，换语言重译不必重新识别。',
  },
]

export function HomePage() {
  const [language, setLanguage] = useState<keyof typeof translations>('中文')

  return (
    <main>
      <SiteHeader variant="home" />

      <section className="hero" id="top">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-copy reveal reveal-one">
          <p className="kicker">
            <span /> 本地优先 · 字幕工作台 · 文稿整理
          </p>
          <h1>
            让每段声音
            <br />
            <em>跨越语言。</em>
          </h1>
          <p className="hero-description">
            本地文件或在线链接：提取原文
            SRT、翻译字幕、校对与硬烧录，或把音视频整理成 Markdown
            文稿。仅提取原文无需模型服务，素材默认留在你的电脑里。
          </p>
          <DownloadCta
            appearance="primary"
            secondary={
              <a className="button button-ghost" href="#workflow">
                看它如何工作
                <ArrowRight size={18} />
              </a>
            }
          />
          <div className="platform-row">
            <span>macOS</span>
            <i />
            <span>Windows</span>
            <i />
            <span>Linux</span>
            <small>开源 · 离线优先 · MIT</small>
          </div>
          <ul className="hero-highlights" aria-label="核心能力速览">
            {highlights.map(item => (
              <li key={item}>
                <Check size={13} strokeWidth={2.6} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="studio-shell reveal reveal-two">
          <div className="studio-topbar">
            <div className="window-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span>interview-final.mp4</span>
            <span className="local-pill">
              <LockKeyhole size={12} /> LOCAL
            </span>
          </div>
          <div className="studio-canvas">
            <div className="video-frame">
              <div className="frame-grid" />
              <div className="subject-shape" aria-hidden="true">
                <span />
              </div>
              <button
                className="play-button"
                type="button"
                aria-label="播放演示视频"
              >
                <Play size={18} fill="currentColor" />
              </button>
              <div className="subtitle-preview">
                <span key={language} className="subtitle-preview-text">
                  {translations[language]}
                </span>
              </div>
              <span className="timecode">00:01:24:18</span>
              <span className="source-pill">
                <Link2 size={11} />
                youtube.com/…
              </span>
            </div>
            <fieldset className="language-switcher">
              <legend className="sr-only">字幕语言</legend>
              {(
                Object.keys(translations) as Array<keyof typeof translations>
              ).map(item => (
                <button
                  className={item === language ? 'active' : undefined}
                  key={item}
                  type="button"
                  onClick={() => setLanguage(item)}
                >
                  {item}
                </button>
              ))}
            </fieldset>
            <div className="timeline">
              <div className="timeline-head">
                <span>平台字幕 / 跳过 ASR</span>
                <span>01:42</span>
              </div>
              <div className="waveform" aria-hidden="true">
                {waveformBars.map((bar, index) => (
                  <span
                    key={bar.id}
                    style={
                      {
                        '--wave': bar.height,
                        '--i': index % 12,
                      } as CSSProperties
                    }
                  />
                ))}
                <i />
              </div>
              <div className="caption-track">
                <span>00:58</span>
                <strong>有字幕直接译 · 无字幕再识别</strong>
                <span>01:05</span>
              </div>
            </div>
          </div>
          <div className="floating-card status-card is-live">
            <ScanLine size={17} />
            <div>
              <span>原文字幕</span>
              <strong>无需模型服务</strong>
            </div>
            <i>
              <span />
            </i>
          </div>
          <div className="floating-card privacy-card is-live">
            <Check size={16} />
            视频未上传云端
          </div>
          <div className="floating-card url-card is-live">
            <WandSparkles size={15} />
            实际语言 → 文件名
          </div>
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div>
          在线链接下载 <Sparkles size={16} /> 平台字幕优先{' '}
          <Sparkles size={16} />
          本地语音识别 <Sparkles size={16} /> 字幕校对 <Sparkles size={16} />
          术语库 <Sparkles size={16} /> 断点恢复 <Sparkles size={16} />
          Markdown 文稿 <Sparkles size={16} /> 双语硬字幕 <Sparkles size={16} />{' '}
          仅提取原文 <Sparkles size={16} />
          在线链接下载 <Sparkles size={16} /> 平台字幕优先{' '}
          <Sparkles size={16} />
          本地语音识别
        </div>
      </div>

      <section
        className="section release-section"
        aria-labelledby="release-title"
      >
        <div className="release-heading">
          <p>NSH 原生重构 · 历史安装包 v{APP_VERSION}</p>
          <h2 id="release-title">字幕与文稿，迁入原生工作台。</h2>
          <span>
            当前源码使用 Longbridge Native
            Shell，提供校对、阶段断点与跨工作流复用。 NSH macOS arm64
            需从源码构建；下载按钮提供的 v{APP_VERSION}
            为历史 Electron 安装包。
          </span>
        </div>
        <div className="release-list">
          {releaseHighlights.map(({ icon: Icon, title, detail }) => (
            <article key={title}>
              <Icon size={20} strokeWidth={1.8} />
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section features-section" id="features">
        <div className="section-heading">
          <h2>
            字幕与文稿，
            <br />
            <span>两条本地流水线，一套隐私边界。</span>
          </h2>
        </div>
        <div className="feature-grid feature-grid-six">
          {features.map(({ icon: Icon, eyebrow, title, description }) => (
            <article className="feature-card" key={title}>
              <Icon size={27} strokeWidth={1.7} />
              <p>{eyebrow}</p>
              <h3>{title}</h3>
              <span>{description}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section workflow-section" id="workflow">
        <div className="workflow-intro">
          <h2>两条工作流，各自四步完成。</h2>
          <p>
            顶栏切换「字幕」或「文稿」：字幕线可仅提取原文、翻译、校对与导出；文稿线把识别结果整篇润色为
            Markdown。完整转录可跨工作流复用，不必重新识别。
          </p>
        </div>
        <div className="workflow-dual">
          <div className="workflow-track">
            <h3 className="workflow-track-title">
              <Subtitles size={18} strokeWidth={1.8} />
              字幕工作流
            </h3>
            <div className="workflow-list">
              {subtitleWorkflow.map(item => {
                const Icon = item.icon
                return (
                  <article key={`sub-${item.number}`}>
                    <span>{item.number}</span>
                    <div>
                      <h3>{item.label}</h3>
                      <p>{item.detail}</p>
                    </div>
                    <Icon size={22} strokeWidth={1.7} />
                  </article>
                )
              })}
            </div>
          </div>
          <div className="workflow-track">
            <h3 className="workflow-track-title">
              <NotebookPen size={18} strokeWidth={1.8} />
              文稿工作流
            </h3>
            <div className="workflow-list">
              {documentWorkflow.map(item => {
                const Icon = item.icon
                return (
                  <article key={`doc-${item.number}`}>
                    <span>{item.number}</span>
                    <div>
                      <h3>{item.label}</h3>
                      <p>{item.detail}</p>
                    </div>
                    <Icon size={22} strokeWidth={1.7} />
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="section privacy-section" id="privacy">
        <div className="privacy-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="privacy-core">
            <LockKeyhole size={33} />
            <span>100%</span>
            <small>LOCAL</small>
          </div>
          <span className="orbit-label label-one">视频文件</span>
          <span className="orbit-label label-two">语音文本</span>
          <span className="orbit-label label-three">翻译结果</span>
        </div>
        <div className="privacy-copy">
          <h2>你的素材，只属于你的设备。</h2>
          <p>
            视频翻译助手以离线工作流为核心。数据库、临时音频、识别文本、字幕与
            Markdown
            文稿都保存在本机路径中。配置在线模型服务时，只发送识别后的文本与必要提示词。
          </p>
          <ul>
            <li>
              <Check size={16} /> 无需注册账号
            </li>
            <li>
              <Check size={16} /> 无强制在线 API 额度
            </li>
            <li>
              <Check size={16} /> 开源代码可审查
            </li>
          </ul>
        </div>
      </section>

      <section className="cta-section">
        <div className="cta-lines" aria-hidden="true" />
        <p>READY WHEN YOU ARE</p>
        <h2>下一条字幕或文稿，从本地开始。</h2>
        <DownloadCta
          appearance="dark"
          className="cta-download"
          secondary={
            <>
              <AppLink className="button button-outline" to="/docs">
                阅读安装文档
              </AppLink>
              <a className="button button-outline" href={repositoryUrl}>
                <GithubIcon size={19} />
                查看源代码
              </a>
            </>
          }
        />
        <span>
          v{APP_VERSION} · MIT License · macOS / Windows / Linux ·{' '}
          <a href={siteUrl}>官网</a>
        </span>
      </section>

      <SiteFooter />
    </main>
  )
}
