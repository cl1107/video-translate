import {
  ArrowRight,
  Check,
  FileText,
  Github,
  Languages,
  Link2,
  LockKeyhole,
  NotebookPen,
  Play,
  ScanLine,
  Sparkles,
  Subtitles,
  WandSparkles,
  Waves,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { useState } from 'react'

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
    detail: '本地文件，或粘贴 YouTube / B 站链接',
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
    label: '翻译润色',
    detail: 'Ollama 本地翻译；可选 BYOK 润色识别原文',
    icon: Languages,
  },
  {
    number: '04',
    label: '导出字幕',
    detail: 'SRT / ASS，可选双语硬字幕烧录',
    icon: FileText,
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
    detail: '生成 .md 文稿，应用内全屏预览与复制',
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
    icon: Waves,
    eyebrow: 'SHERPA-ONNX',
    title: '听懂真实语境',
    description:
      'SenseVoice 支持中、英、日、韩、粤语，适合课程、访谈和内容创作。',
  },
  {
    icon: NotebookPen,
    eyebrow: 'DOCUMENT MD',
    title: '音视频整理成 Markdown',
    description:
      '独立「文稿」工作流：识别后整篇 AI 润色为结构化 MD，全屏预览，一键导出。',
  },
  {
    icon: Languages,
    eyebrow: 'SUBTITLES',
    title: '字幕翻译与硬烧录',
    description:
      '本地 Ollama 翻译；双语 SRT / ASS 导出，可选硬字幕烧录与颜色自定义。',
  },
  {
    icon: LockKeyhole,
    eyebrow: 'LOCAL FIRST',
    title: '素材不离开设备',
    description:
      '识别、翻译、文稿整理默认在本机完成。视频无需上传到第三方云端。',
  },
]

const highlights = [
  '字幕工作台 + 文稿整理',
  '在线链接 / 本地文件',
  '平台字幕优先于 ASR',
  'SenseVoice 本地识别',
  'Markdown 全屏预览',
  '双语字幕与硬烧录',
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
            本地文件或在线链接：一条流水线做字幕翻译与硬烧录，另一条把音视频整理成
            Markdown 文稿。平台字幕优先、没有再 ASR——素材默认留在你的电脑里。
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
              <span>平台字幕</span>
              <strong>已就绪</strong>
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
            链接 → 字幕 / 文稿
          </div>
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div>
          在线链接下载 <Sparkles size={16} /> 平台字幕优先{' '}
          <Sparkles size={16} />
          本地语音识别 <Sparkles size={16} /> 多语言翻译 <Sparkles size={16} />
          Markdown 文稿 <Sparkles size={16} /> 双语硬字幕{' '}
          <Sparkles size={16} /> 隐私优先 <Sparkles size={16} />
          在线链接下载 <Sparkles size={16} /> 平台字幕优先{' '}
          <Sparkles size={16} />
          本地语音识别
        </div>
      </div>

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
            顶栏切换「字幕」或「文稿」：字幕线做翻译与导出；文稿线把识别结果整篇润色为
            Markdown。共享 ASR 与下载，任务列表彼此独立。
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
            Markdown 文稿都保存在本机路径中。
            在线润色（BYOK）仅在你主动配置时才会请求你指定的接口。
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
                <Github size={19} />
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
