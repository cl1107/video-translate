import {
  BookOpen,
  Check,
  Download,
  ExternalLink,
  FileVideo,
  HardDrive,
  Languages,
  Link2,
  Terminal,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { SiteFooter } from '../components/SiteFooter'
import { SiteHeader } from '../components/SiteHeader'
import { DownloadCta } from '../components/DownloadCta'
import { APP_VERSION, releaseUrl, repositoryUrl } from '../site'

const toc = [
  { id: 'overview', label: '概览' },
  { id: 'install-app', label: '安装应用' },
  { id: 'packages', label: 'bundled / slim' },
  { id: 'unsigned', label: '非签名包' },
  { id: 'ffmpeg', label: 'FFmpeg' },
  { id: 'ollama', label: '模型服务' },
  { id: 'ytdlp', label: 'yt-dlp' },
  { id: 'asr', label: 'ASR 模型' },
  { id: 'usage', label: '使用教程' },
  { id: 'faq', label: '常见问题' },
] as const

type CodeBlockProps = {
  label?: string
  children: string
}

function CodeBlock({ label, children }: CodeBlockProps) {
  return (
    <div className="docs-code">
      {label ? <span className="docs-code-label">{label}</span> : null}
      <pre>
        <code>{children.trim()}</code>
      </pre>
    </div>
  )
}

function PlatformTabs({
  mac,
  windows,
  linux,
}: {
  mac: string
  windows: string
  linux: string
}) {
  const [os, setOs] = useState<'mac' | 'windows' | 'linux'>('mac')

  return (
    <div className="docs-os">
      <div className="docs-os-tabs" role="tablist" aria-label="操作系统">
        {(
          [
            ['mac', 'macOS'],
            ['windows', 'Windows'],
            ['linux', 'Linux'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={os === key}
            className={os === key ? 'active' : undefined}
            onClick={() => setOs(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <CodeBlock
        label={os === 'mac' ? 'macOS' : os === 'windows' ? 'Windows' : 'Linux'}
      >
        {os === 'mac' ? mac : os === 'windows' ? windows : linux}
      </CodeBlock>
    </div>
  )
}

export function DocsPage() {
  const [activeId, setActiveId] = useState<string>(toc[0].id)

  useEffect(() => {
    document.title = '文档｜视频翻译助手'
    return () => {
      document.title = '视频翻译助手｜让每段声音跨越语言'
    }
  }, [])

  useEffect(() => {
    const sections = toc
      .map(item => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el))

    if (sections.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id)
        }
      },
      {
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0.1, 0.25, 0.5],
      }
    )

    for (const section of sections) {
      observer.observe(section)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <main className="docs-page">
      <SiteHeader variant="docs" />

      <div className="docs-hero">
        <p className="docs-kicker">
          <BookOpen size={14} />
          文档 v{APP_VERSION}
        </p>
        <h1>
          装好依赖，
          <em>跑通第一条任务。</em>
        </h1>
        <p className="docs-lead">
          从系统工具到应用内流程：FFmpeg、模型服务、yt-dlp 怎么配，以及本地文件 /
          在线链接如何提取原文、翻译字幕、校对或生成 Markdown
          文稿。依赖缺失时应用启动会自检并给出安装提示。
        </p>
        <DownloadCta
          appearance="primary"
          className="docs-download"
          secondary={
            <a className="button button-ghost" href="#usage">
              直接看使用教程
            </a>
          }
        />
      </div>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="文档目录">
          <p className="docs-toc-title">目录</p>
          <nav>
            {toc.map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                data-active={activeId === item.id ? 'true' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="docs-content">
          <section id="overview" className="docs-section">
            <h2>概览</h2>
            <p>
              视频翻译助手是本地优先的字幕与文稿工作台。顶栏可切换两条流水线：
              <strong>字幕</strong>
              （导入或导入 SRT → 原文/ASR → 仅提取原文或翻译 → 导出 / 校对 /
              可选硬烧录）与
              <strong>文稿</strong>
              （导入音视频 → ASR → 整篇润色 → 导出
              Markdown）。完整转录可跨工作流复用。视频与 ASR 始终在本机。
            </p>
            <div className="docs-callout">
              <HardDrive size={18} />
              <div>
                <strong>依赖分工</strong>
                <ul>
                  <li>
                    <strong>FFmpeg</strong>：必需。抽音频、分段、可选硬字幕烧录
                  </li>
                  <li>
                    <strong>模型服务</strong>
                    ：按需配置。仅提取原文时无需模型服务；字幕翻译、润色与文稿整理使用
                    OpenAI 兼容 Endpoint（本机 Ollama / LM Studio / vLLM
                    或在线 API）
                  </li>
                  <li>
                    <strong>yt-dlp</strong>：可选。仅「在线链接」下载视频时需要
                  </li>
                  <li>
                    <strong>SenseVoice ASR</strong>：默认自动下载，无需手动装
                    Python
                  </li>
                </ul>
              </div>
            </div>
            <div className="docs-callout docs-callout-soft">
              <Check size={18} />
              <div>
                <strong>源码新能力</strong>
                <p>
                  字幕校对工作台、术语库、阶段断点恢复与跨工作流复用已进入当前源码。GitHub
                  Releases 安装包仍为 v{APP_VERSION}
                  ；从源码运行可立即使用，下一版本随包发布。
                </p>
              </div>
            </div>
            <div className="docs-meta-grid">
              <div>
                <span>系统</span>
                <strong>macOS · Windows · Linux</strong>
              </div>
              <div>
                <span>内存建议</span>
                <strong>8GB+</strong>
              </div>
              <div>
                <span>磁盘</span>
                <strong>约 10GB+（含模型）</strong>
              </div>
              <div>
                <span>源码</span>
                <strong>
                  <a href={repositoryUrl} target="_blank" rel="noreferrer">
                    GitHub
                    <ExternalLink size={12} />
                  </a>
                </strong>
              </div>
            </div>
          </section>

          <section id="install-app" className="docs-section">
            <h2>
              <Download size={22} />
              安装应用
            </h2>
            <ol className="docs-steps">
              <li>
                使用上方下载按钮（自动匹配本机平台），或打开{' '}
                <a href={releaseUrl} target="_blank" rel="noreferrer">
                  GitHub Releases
                </a>{' '}
                自选安装包（macOS arm64 / Windows x64 / Linux x64）。
              </li>
              <li>
                每个平台有 <strong>bundled-ffmpeg</strong>（完整版）与{' '}
                <strong>slim</strong>
                （精简版）两种（见下节）；不确定时选完整版。
              </li>
              <li>
                安装并启动。首次启动会跑<strong>系统依赖检查</strong>
                ：缺什么会直接告诉你。
              </li>
              <li>
                可选依赖缺失<strong>不会</strong>
                挡住进入主界面：模型服务只影响翻译与润色，yt-dlp
                只影响在线链接下载。
              </li>
              <li>
                下载后建议用 Release 中的 <code>SHA256SUMS.txt</code> 校验文件。
              </li>
            </ol>
          </section>

          <section id="packages" className="docs-section">
            <h2>
              <HardDrive size={22} />
              bundled-ffmpeg 与 slim
            </h2>
            <p>
              CI 为每个平台打两种包，区别只在于<strong>是否内置 FFmpeg</strong>
              。模型服务、yt-dlp 与 ASR 模型不随这两种包提供。
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>文件名标记</th>
                    <th>说明</th>
                    <th>适合谁</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>bundled-ffmpeg</strong>
                    </td>
                    <td>
                      <code>-bundled-ffmpeg.</code>
                    </td>
                    <td>
                      内置 FFmpeg / FFprobe（含硬字幕所需
                      libass），优先用包内二进制
                    </td>
                    <td>
                      <strong>推荐大多数用户</strong>，开箱即用
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <strong>slim</strong>
                    </td>
                    <td>
                      <code>-slim.</code>
                    </td>
                    <td>
                      不内置 FFmpeg，使用系统 PATH（及 macOS Homebrew 常见路径）
                    </td>
                    <td>本机已装完整 FFmpeg，或希望安装包更小</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <CodeBlock label="文件名示例">
              {`video-translate-vX.Y.Z-mac-arm64-bundled-ffmpeg.dmg
video-translate-vX.Y.Z-mac-arm64-slim.dmg
video-translate-vX.Y.Z-win-x64-bundled-ffmpeg.exe
video-translate-vX.Y.Z-linux-x64-bundled-ffmpeg.AppImage`}
            </CodeBlock>
            <p className="docs-note">
              选了 <strong>slim</strong> 就必须自行安装
              FFmpeg（见下节）。硬字幕烧录需要带 <code>subtitles</code>{' '}
              滤镜的完整构建。GitHub Release
              正文顶部会附带精简对照表，完整说明以本页为准。
            </p>
          </section>

          <section id="unsigned" className="docs-section">
            <h2>
              <Wrench size={22} />
              非签名包注意事项
            </h2>
            <p>
              当前 CI 产物均为 <strong>未代码签名</strong> 构建（
              <code>UNSIGNED_BUILD=1</code>
              ），未做 Apple 公证或 Windows Authenticode，仅适合自用 / 内测。
            </p>

            <h3>macOS</h3>
            <p>
              浏览器下载会带隔离属性（quarantine）。若提示「已损坏」「无法打开」或无法验证开发者，对{' '}
              <code>.app</code> 执行：
            </p>
            <CodeBlock label="终端">
              {`xattr -cr "/Applications/视频翻译助手.app"
# 路径按实际安装位置修改

# 仍失败时可试：
# sudo xattr -cr "/path/to/视频翻译助手.app"`}
            </CodeBlock>
            <p className="docs-note">
              也可在「系统设置 →
              隐私与安全性」中对拦截提示选择仍要打开（视系统版本而定）。
            </p>

            <h3>Windows</h3>
            <p>SmartScreen 可能提示「Windows 已保护你的电脑」：</p>
            <ol className="docs-steps">
              <li>
                点击 <strong>更多信息</strong>
              </li>
              <li>
                再点 <strong>仍要运行</strong>
              </li>
            </ol>
            <p className="docs-note">
              请仅从本仓库 Releases 下载。若被 Defender
              隔离，可在安全中心还原后再按上式打开。
            </p>

            <h3>Linux</h3>
            <CodeBlock label="AppImage">
              {`chmod +x video-translate-vX.Y.Z-linux-x64-*.AppImage
./video-translate-vX.Y.Z-linux-x64-*.AppImage`}
            </CodeBlock>
            <p>
              deb / rpm / pacman
              包未做发行版仓库签名，请用本地包管理器安装，并与{' '}
              <code>SHA256SUMS.txt</code> 核对。部分环境运行 AppImage 可能需要
              FUSE。
            </p>
          </section>

          <section id="ffmpeg" className="docs-section">
            <h2>
              <Terminal size={22} />
              安装 FFmpeg
            </h2>
            <p>
              FFmpeg 负责音频提取、分段，以及硬字幕烧录。应用会在 PATH 中查找{' '}
              <code>ffmpeg</code> / <code>ffprobe</code>
              。在 macOS 图形启动时 PATH 可能不含 Homebrew，应用会额外尝试
              Homebrew keg 路径。使用 <strong>bundled-ffmpeg</strong>{' '}
              包时一般无需本机再装 FFmpeg；<strong>slim</strong> 包必须安装。
            </p>
            <PlatformTabs
              mac={`# 基础安装
brew install ffmpeg

# 需要烧录硬字幕时，推荐完整版（含 libass / subtitles 滤镜）
brew install ffmpeg-full`}
              windows={`# Chocolatey
choco install ffmpeg

# 或 Scoop
scoop install ffmpeg

# 也可从官网下载完整构建并加入 PATH
# https://ffmpeg.org/download.html`}
              linux={`# Ubuntu / Debian
sudo apt update
sudo apt install ffmpeg libass9

# Fedora
sudo dnf install ffmpeg`}
            />
            <div className="docs-verify">
              <Terminal size={16} />
              <div>
                <strong>验证</strong>
                <CodeBlock>ffmpeg -version</CodeBlock>
                <CodeBlock>ffprobe -version</CodeBlock>
              </div>
            </div>
            <p className="docs-note">
              硬字幕烧录依赖 FFmpeg 的 <code>subtitles</code> 滤镜（libass）。
              精简构建可能没有该滤镜；需要烧录时请安装完整版FFmpeg。
            </p>
          </section>

          <section id="ollama" className="docs-section">
            <h2>
              <Languages size={22} />
              配置模型服务（翻译 / 润色）
            </h2>
            <p>
              字幕翻译、字幕润色和文稿整理使用设置中的
              <strong>OpenAI 兼容 Endpoint</strong>
              。仅提取原文时可以跳过本节。可以是本机 Ollama、LM Studio、vLLM
              或在线 API。使用在线服务时，应用只发送识别后的文本，不会上传视频、音频或
              ASR 模型。
            </p>
            <p>
              以本机 Ollama 为例：安装后需保证服务在运行（菜单栏 App 或{' '}
              <code>ollama serve</code>），默认地址为{' '}
              <code>http://127.0.0.1:11434/v1</code>
              。其他服务请填写其 Base URL、模型 ID，以及服务要求的 API Key。
            </p>
            <PlatformTabs
              mac={`# 官方安装脚本
curl -fsSL https://ollama.com/install.sh | sh

# 或 Homebrew
brew install ollama

# 启动服务（若未以 App 形式常驻）
ollama serve`}
              windows={`# 下载安装包
# https://ollama.com/download/windows

# 安装后从开始菜单启动 Ollama
# 托盘图标常驻即表示服务可用`}
              linux={`# 官方安装脚本
curl -fsSL https://ollama.com/install.sh | sh

# 启动
ollama serve`}
            />
            <h3>拉取翻译模型（Ollama 示例）</h3>
            <p>
              模型 ID 由你配置的 Endpoint 提供。本机 Ollama 可使用{' '}
              <code>kaelri/hy-mt2:1.8b</code>，也可换成其它已拉取的模型。
            </p>
            <CodeBlock label="终端">
              {`# 常用翻译模型
ollama pull kaelri/hy-mt2:1.8b

# 其它常用选择（按需）
# ollama pull qwen3:4b-instruct
# ollama pull qwen2.5:7b

# 查看本机已有模型
ollama list`}
            </CodeBlock>
            <div className="docs-callout docs-callout-soft">
              <Check size={18} />
              <div>
                <strong>可配置多套模型服务</strong>
                <p>
                  设置里可添加多套 OpenAI 兼容服务（名称、Base URL、翻译/润色模型），创建任务时选择其中一套。API
                  Key 只保存在本机，不会写入任务记录。FFmpeg / ASR /
                  字幕生成始终在本地。
                </p>
              </div>
            </div>
          </section>

          <section id="ytdlp" className="docs-section">
            <h2>
              <Link2 size={22} />
              安装 yt-dlp（可选）
            </h2>
            <p>
              仅当你使用<strong>在线视频链接</strong>
              （YouTube、B 站等）时需要。只做本地文件翻译可以跳过。
            </p>
            <PlatformTabs
              mac={`brew install yt-dlp

# 或保持最新
# brew upgrade yt-dlp`}
              windows={`# pip
pip install -U yt-dlp

# 或 Scoop
scoop install yt-dlp

# 也可从 GitHub Releases 下载 exe 并加入 PATH
# https://github.com/yt-dlp/yt-dlp/releases`}
              linux={`# pip（推荐，更新快）
pip install -U yt-dlp

# 或包管理器（版本可能偏旧）
# sudo apt install yt-dlp`}
            />
            <div className="docs-verify">
              <Terminal size={16} />
              <div>
                <strong>验证</strong>
                <CodeBlock>yt-dlp --version</CodeBlock>
              </div>
            </div>
            <p className="docs-note">
              应用会优先尝试拉取平台站内字幕；有字幕时会跳过 ASR，速度更快。
            </p>
          </section>

          <section id="asr" className="docs-section">
            <h2>
              <FileVideo size={22} />
              ASR 语音识别模型
            </h2>
            <p>
              默认引擎为 <strong>SenseVoice Small</strong>
              （sherpa-onnx），支持中 / 英 / 日 / 韩 /
              粤。应用在依赖检查、启动或首次任务时会
              <strong>自动下载并解压</strong>，无需单独安装 Python。
            </p>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>引擎</th>
                    <th>说明</th>
                    <th>获取</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>sensevoice</code>
                    </td>
                    <td>默认，速度快，适合常见字幕场景</td>
                    <td>自动下载</td>
                  </tr>
                  <tr>
                    <td>
                      <code>funasr-nano</code>
                    </td>
                    <td>方言 / 远场 / 嘈杂更强，体积更大</td>
                    <td>手动准备（见仓库模型说明）</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="docs-note">
              若自动下载失败，检查网络后在应用内点「重新检查」。也可通过环境变量{' '}
              <code>VIDEO_TRANSLATE_ASR_MODELS</code> 指定模型目录。
            </p>
          </section>

          <section id="usage" className="docs-section">
            <h2>
              <BookOpen size={22} />
              简单使用教程
            </h2>

            <h3>1. 启动与自检</h3>
            <ol className="docs-steps">
              <li>打开应用，等待系统依赖检查完成。</li>
              <li>若必需依赖缺失，按提示安装后点「重新检查」。</li>
              <li>
                只提取原文可不配置模型服务；需要翻译时再在设置中确认
                Endpoint、模型与目标语言。
              </li>
            </ol>

            <h3>2. 选择工作流并导入素材</h3>
            <p>
              主界面顶栏左侧切换 <strong>字幕</strong> 或 <strong>文稿</strong>
              ；右侧「添加 / 任务」在当前工作流内切换面板。两条线任务列表独立，完整识别结果可互相复用。
            </p>
            <div className="docs-cards">
              <article>
                <h4>本地文件</h4>
                <p>
                  字幕线：拖拽或选择视频（MP4 / MOV / MKV / WebM
                  等）。文稿线还支持常见音频（MP3 / WAV / M4A 等）。
                </p>
              </article>
              <article>
                <h4>在线链接</h4>
                <p>
                  粘贴 YouTube、B 站等链接。需已安装
                  yt-dlp；应用会下载视频并尽量带上平台字幕。
                </p>
              </article>
              <article>
                <h4>导入字幕</h4>
                <p>
                  任务列表可导入 SRT / VTT，直接进入校对，或复用为翻译任务。可关联本地视频同步播放与烧录。
                </p>
              </article>
            </div>

            <h3>3. 字幕流水线</h3>
            <ol className="docs-steps docs-steps-pipeline">
              <li>
                <strong>获取原文</strong>
                ：有平台字幕 → 直接用；没有 → FFmpeg 抽音频 + SenseVoice 识别。
              </li>
              <li>
                <strong>选择处理方式</strong>
                ：「仅提取原文」只生成原文 SRT，无需模型服务；「翻译字幕」可先润色原文，再由所选
                Endpoint 翻译。
              </li>
              <li>
                <strong>导出</strong>
                ：翻译模式生成原文、译文、双语 SRT 与 ASS；仅原文模式生成原文
                SRT。文件名使用实际识别语言，已有同名文件不会被覆盖。
              </li>
              <li>
                <strong>可选</strong>
                ：创建任务时选择烧录内容。翻译模式支持原文、译文或双语，原文模式烧录原文（需带
                libass 的 FFmpeg）。
              </li>
              <li>
                <strong>校对</strong>
                ：完成后在任务列表点「校对」，对照媒体修改原文/译文与时间轴，可单段重译。保存后重新导出。问题清单会标出空译、回退、重叠和过长行。
              </li>
            </ol>

            <h3>4. 文稿流水线</h3>
            <ol className="docs-steps docs-steps-pipeline">
              <li>
                <strong>识别</strong>
                ：同样优先平台字幕，否则本地 ASR 得到全文。
              </li>
              <li>
                <strong>整篇润色</strong>
                ：用所选模型服务的润色模型整理为结构化 Markdown。
              </li>
              <li>
                <strong>来源索引</strong>
                ：文末附转录首句时间定位目录，预览可跳到对应媒体时间。这是可追溯来源目录，不是模型生成的语义章节摘要。
              </li>
              <li>
                <strong>导出与预览</strong>：写入本机 <code>.md</code>
                ；任务右下角「预览」可全屏阅读，也可复制或打开文件。
              </li>
            </ol>
            <p className="docs-note">
              文稿润色依赖已配置的润色模型（勿使用 hy-mt
              等翻译专用模型）。未配置时任务会失败并提示去设置。
            </p>

            <h3>5. 任务与结果</h3>
            <ul className="docs-list">
              <li>
                在对应工作流的任务列表查看进度、日志、本地创建时间与处理耗时；支持暂停
                / 恢复。识别、润色、翻译会按阶段保存断点，恢复时只补未完成部分。
              </li>
              <li>字幕完成：打开字幕或结果文件夹；可进入校对、补烧硬字幕，或复用识别结果生成文稿。</li>
              <li>
                文稿完成：全屏预览 Markdown、复制、打开 .md 或结果文件夹。
              </li>
              <li>
                完成、失败或取消的任务可批量删除；只清理任务记录、断点缓存与应用缓存，源文件和结果文件保留。
              </li>
              <li>临时音频等中间文件会在流程结束后清理。</li>
            </ul>

            <h3>6. 常用设置入口</h3>
            <ul className="docs-list">
              <li>ASR 引擎（SenseVoice / Fun-ASR-Nano）</li>
              <li>源语言 / 目标语言（字幕线）</li>
              <li>字幕与烧录视频的输出位置：output 子目录或源视频同目录</li>
              <li>
                模型服务：可添加多套 OpenAI 兼容 Endpoint，分别指定翻译 / 润色模型
              </li>
              <li>术语库：翻译时优先采用指定译法</li>
              <li>原文 / 译文字幕颜色；烧录内容在创建字幕任务时选择</li>
            </ul>
          </section>

          <section id="faq" className="docs-section">
            <h2>常见问题</h2>
            <div className="docs-faq">
              <details open>
                <summary>该下 bundled-ffmpeg 还是 slim？</summary>
                <p>
                  多数用户选 <strong>bundled-ffmpeg</strong>
                  （内置 FFmpeg）。本机已装完整 FFmpeg 且希望包更小时选{' '}
                  <strong>slim</strong>。详见上文「bundled-ffmpeg 与 slim」。
                </p>
              </details>
              <details>
                <summary>macOS / Windows 打不开或被系统拦截？</summary>
                <p>
                  CI 包未签名。macOS 对 <code>.app</code> 执行{' '}
                  <code>xattr -cr</code>；Windows 在 SmartScreen 选「更多信息 →
                  仍要运行」。详见「非签名包注意事项」。
                </p>
              </details>
              <details>
                <summary>提示找不到 ffmpeg / ffprobe？</summary>
                <p>
                  若使用 <strong>slim</strong>：确认终端里{' '}
                  <code>ffmpeg -version</code> 可用。macOS 从 Dock 启动时 PATH
                  可能不含 Homebrew，可装 <code>ffmpeg-full</code> 或改用{' '}
                  <strong>bundled-ffmpeg</strong> 包。若已是 bundled
                  仍失败，请反馈版本与日志。
                </p>
              </details>
              <details>
                <summary>如何校对字幕、导入现成字幕？</summary>
                <p>
                  任务完成后点「校对」，对照视频修改原文、译文和时间轴，可单段重译。任务列表也可导入
                  SRT / VTT。完整识别结果可复用到字幕或文稿，不必重新跑 ASR。
                </p>
              </details>
              <details>
                <summary>暂停后恢复会从头再跑吗？</summary>
                <p>
                  识别、润色、翻译会按阶段保存断点。恢复时复用匹配的结果；ASR
                  未完成时仍会重新抽音频，但已成功的识别块不重复推理。旧版中断任务首次恢复时，未能确认完成的阶段可能需要重做。
                </p>
              </details>
              <details>
                <summary>翻译失败或模型服务不可用？</summary>
                <p>
                  翻译依赖设置中的 OpenAI 兼容 Endpoint。请确认 Base URL、模型
                  ID 与 API Key 正确；使用本机 Ollama 时确认服务已运行，并执行{' '}
                  <code>ollama list</code> 能列出模型。如果只需要原文
                  SRT，创建任务时选择「仅提取原文」即可跳过模型服务。
                </p>
              </details>
              <details>
                <summary>在线链接下载失败？</summary>
                <p>
                  安装或升级 yt-dlp（<code>pip install -U yt-dlp</code> 或{' '}
                  <code>brew upgrade yt-dlp</code>
                  ）。部分站点需要更新的 yt-dlp 版本；仅本地文件可忽略此依赖。
                </p>
              </details>
              <details>
                <summary>硬字幕烧录失败？</summary>
                <p>
                  当前 FFmpeg 可能不含 libass。macOS 可试{' '}
                  <code>brew install ffmpeg-full</code>
                  ；Linux 确保安装了 <code>libass</code> 相关包；Windows
                  使用完整构建而非精简版。
                </p>
              </details>
              <details>
                <summary>SenseVoice 模型一直下不下来？</summary>
                <p>
                  检查网络与磁盘空间，在依赖检查界面重试。仍失败时查看任务/系统日志中的下载错误，或手动按仓库{' '}
                  <code>apps/desktop/models/asr/README.md</code> 准备模型目录。
                </p>
              </details>
            </div>
          </section>

          <section className="docs-footer-cta">
            <p>准备好了？</p>
            <DownloadCta
              appearance="dark"
              className="docs-footer-download"
              showHint={false}
            />
          </section>
        </article>
      </div>

      <SiteFooter />
    </main>
  )
}
