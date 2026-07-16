import {
  ArrowDownToLine,
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
} from "lucide-react";
import { useEffect, useState } from "react";

import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { APP_VERSION, releaseUrl, repositoryUrl } from "../site";

const toc = [
  { id: "overview", label: "概览" },
  { id: "install-app", label: "安装应用" },
  { id: "packages", label: "bundled / slim" },
  { id: "unsigned", label: "非签名包" },
  { id: "ffmpeg", label: "FFmpeg" },
  { id: "ollama", label: "Ollama" },
  { id: "ytdlp", label: "yt-dlp" },
  { id: "asr", label: "ASR 模型" },
  { id: "usage", label: "使用教程" },
  { id: "faq", label: "常见问题" },
] as const;

type CodeBlockProps = {
  label?: string;
  children: string;
};

function CodeBlock({ label, children }: CodeBlockProps) {
  return (
    <div className="docs-code">
      {label ? <span className="docs-code-label">{label}</span> : null}
      <pre>
        <code>{children.trim()}</code>
      </pre>
    </div>
  );
}

function PlatformTabs({
  mac,
  windows,
  linux,
}: {
  mac: string;
  windows: string;
  linux: string;
}) {
  const [os, setOs] = useState<"mac" | "windows" | "linux">("mac");

  return (
    <div className="docs-os">
      <div className="docs-os-tabs" role="tablist" aria-label="操作系统">
        {(
          [
            ["mac", "macOS"],
            ["windows", "Windows"],
            ["linux", "Linux"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={os === key}
            className={os === key ? "active" : undefined}
            onClick={() => setOs(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <CodeBlock
        label={os === "mac" ? "macOS" : os === "windows" ? "Windows" : "Linux"}
      >
        {os === "mac" ? mac : os === "windows" ? windows : linux}
      </CodeBlock>
    </div>
  );
}

export function DocsPage() {
  const [activeId, setActiveId] = useState<string>(toc[0].id);

  useEffect(() => {
    document.title = "文档｜视频翻译助手";
    return () => {
      document.title = "视频翻译助手｜让每段声音跨越语言";
    };
  }, []);

  useEffect(() => {
    const sections = toc
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0.1, 0.25, 0.5],
      },
    );

    for (const section of sections) {
      observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

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
          <em>跑通第一条字幕。</em>
        </h1>
        <p className="docs-lead">
          从系统工具到应用内流程：FFmpeg、Ollama、yt-dlp 怎么装，以及本地文件 /
          在线链接如何翻译导出。依赖缺失时应用启动会自检并给出安装提示。
        </p>
        <div className="docs-hero-actions">
          <a className="button button-primary" href={releaseUrl}>
            <ArrowDownToLine size={18} />
            下载应用
          </a>
          <a className="button button-ghost" href="#usage">
            直接看使用教程
          </a>
        </div>
      </div>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="文档目录">
          <p className="docs-toc-title">目录</p>
          <nav>
            {toc.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                data-active={activeId === item.id ? "true" : undefined}
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
              视频翻译助手是本地优先的字幕工作台：导入视频 →
              获取原文（平台字幕或 ASR）→ 翻译 →
              导出字幕。大部分处理发生在你的电脑上。
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
                    <strong>Ollama</strong>
                    ：必需。批量<strong>翻译</strong>走本地 Ollama；可选在设置中用
                    BYOK 仅做识别结果<strong>润色</strong>（不替代翻译）
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
                打开{" "}
                <a href={releaseUrl} target="_blank" rel="noreferrer">
                  GitHub Releases
                </a>
                ，按平台下载安装包（macOS arm64 / Windows x64 / Linux x64）。
              </li>
              <li>
                每个平台有 <strong>bundled-ffmpeg</strong> 与{" "}
                <strong>slim</strong> 两种（见下节）；不确定时选 bundled。
              </li>
              <li>
                安装并启动。首次启动会跑<strong>系统依赖检查</strong>
                ：缺什么会直接告诉你。
              </li>
              <li>
                可选依赖（如 yt-dlp）缺失<strong>不会</strong>
                挡住进入主界面——只影响在线链接下载。
              </li>
              <li>
                下载后建议用 Release 中的 <code>SHA256SUMS.txt</code>{" "}
                校验文件。
              </li>
            </ol>
          </section>

          <section id="packages" className="docs-section">
            <h2>
              <HardDrive size={22} />
              bundled-ffmpeg 与 slim
            </h2>
            <p>
              CI 为每个平台打两种包，区别只在于<strong>是否内置
              FFmpeg</strong>。Ollama、yt-dlp 与 ASR 模型与此无关。
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
                      不内置 FFmpeg，使用系统 PATH（及 macOS Homebrew
                      常见路径）
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
              选了 <strong>slim</strong> 就必须自行安装 FFmpeg（见下节）。硬字幕烧录需要带{" "}
              <code>subtitles</code> 滤镜的完整构建。每个 GitHub Release
              正文顶部也会固定展示上述区别。
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
              浏览器下载会带隔离属性（quarantine）。若提示「已损坏」「无法打开」或无法验证开发者，对{" "}
              <code>.app</code> 执行：
            </p>
            <CodeBlock label="终端">
              {`xattr -cr "/Applications/视频翻译助手.app"
# 路径按实际安装位置修改

# 仍失败时可试：
# sudo xattr -cr "/path/to/视频翻译助手.app"`}
            </CodeBlock>
            <p className="docs-note">
              也可在「系统设置 → 隐私与安全性」中对拦截提示选择仍要打开（视系统版本而定）。
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
              deb / rpm / pacman 包未做发行版仓库签名，请用本地包管理器安装，并与{" "}
              <code>SHA256SUMS.txt</code>{" "}
              核对。部分环境运行 AppImage 可能需要 FUSE。
            </p>
          </section>

          <section id="ffmpeg" className="docs-section">
            <h2>
              <Terminal size={22} />
              安装 FFmpeg
            </h2>
            <p>
              FFmpeg 负责音频提取、分段，以及硬字幕烧录。应用会在 PATH 中查找{" "}
              <code>ffmpeg</code> / <code>ffprobe</code>
              。在 macOS 图形启动时 PATH 可能不含 Homebrew，应用会额外尝试
              Homebrew keg 路径。使用{" "}
              <strong>bundled-ffmpeg</strong> 包时一般无需本机再装
              FFmpeg；<strong>slim</strong> 包必须安装。
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
              安装 Ollama
            </h2>
            <p>
              默认通过本机 Ollama 做批量翻译。安装后需保证服务在运行（菜单栏 App
              或 <code>ollama serve</code>），默认 API 地址为{" "}
              <code>http://127.0.0.1:11434</code>。
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
            <h3>拉取翻译模型</h3>
            <p>
              应用默认模型为 <code>kaelri/hy-mt2:1.8b</code>
              。你也可以在设置中换成其它已拉取的模型。
            </p>
            <CodeBlock label="终端">
              {`# 默认推荐
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
                <strong>BYOK 是什么？</strong>
                <p>
                  设置里的「在线 BYOK」只用于可选步骤：识别结果先<strong>润色</strong>再翻译（校对错字、补标点，不翻译语言）。兼容
                  OpenAI 的 Base URL + API Key + 模型 ID。
                  <strong>正式翻译仍由本机 Ollama 完成</strong>
                  ，目前不能用 BYOK 替代 Ollama 做整段翻译。FFmpeg /
                  ASR / 字幕生成也始终在本地。
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
              若自动下载失败，检查网络后在应用内点「重新检查」。也可通过环境变量{" "}
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
              <li>若 FFmpeg / Ollama 缺失，按提示安装后点「重新检查」。</li>
              <li>进入主界面后，可在设置中确认翻译模型与目标语言。</li>
            </ol>

            <h3>2. 导入素材（二选一）</h3>
            <div className="docs-cards">
              <article>
                <h4>本地文件</h4>
                <p>
                  拖拽或选择视频（常见格式如 MP4 / MOV / MKV / WebM
                  等）。适合已下载课程、成片、访谈素材。
                </p>
              </article>
              <article>
                <h4>在线链接</h4>
                <p>
                  粘贴 YouTube、B 站等链接。需已安装
                  yt-dlp；应用会下载视频并尽量带上平台字幕。
                </p>
              </article>
            </div>

            <h3>3. 流水线会做什么</h3>
            <ol className="docs-steps docs-steps-pipeline">
              <li>
                <strong>获取原文</strong>
                ：有平台字幕 → 直接用；没有 → FFmpeg 抽音频 + SenseVoice 识别。
              </li>
              <li>
                <strong>翻译</strong>：Ollama
                批量翻译；若开启润色，则先用 Ollama 或 BYOK 校对原文，再翻译。
              </li>
              <li>
                <strong>导出</strong>：生成 SRT / ASS 等字幕文件。
              </li>
              <li>
                <strong>可选</strong>：烧录双语硬字幕到视频（需带 libass 的
                FFmpeg）。
              </li>
            </ol>

            <h3>4. 任务与结果</h3>
            <ul className="docs-list">
              <li>在任务列表查看进度、日志；支持暂停 / 恢复（视状态而定）。</li>
              <li>完成后在任务详情中打开字幕或导出目录。</li>
              <li>临时音频等中间文件会在流程结束后清理。</li>
            </ul>

            <h3>5. 常用设置入口</h3>
            <ul className="docs-list">
              <li>ASR 引擎（SenseVoice / Fun-ASR-Nano）</li>
              <li>源语言 / 目标语言</li>
              <li>Ollama 翻译模型；可选润色（本地 Ollama 或在线 BYOK）</li>
              <li>硬字幕样式：仅原文 / 仅译文 / 双语堆叠与颜色</li>
            </ul>
          </section>

          <section id="faq" className="docs-section">
            <h2>常见问题</h2>
            <div className="docs-faq">
              <details open>
                <summary>该下 bundled-ffmpeg 还是 slim？</summary>
                <p>
                  多数用户选 <strong>bundled-ffmpeg</strong>
                  （内置 FFmpeg）。本机已装完整 FFmpeg 且希望包更小时选{" "}
                  <strong>slim</strong>。详见上文「bundled-ffmpeg 与 slim」。
                </p>
              </details>
              <details>
                <summary>macOS / Windows 打不开或被系统拦截？</summary>
                <p>
                  CI 包未签名。macOS 对 <code>.app</code> 执行{" "}
                  <code>xattr -cr</code>；Windows 在 SmartScreen 选「更多信息 →
                  仍要运行」。详见「非签名包注意事项」。
                </p>
              </details>
              <details>
                <summary>提示找不到 ffmpeg / ffprobe？</summary>
                <p>
                  若使用 <strong>slim</strong>：确认终端里{" "}
                  <code>ffmpeg -version</code> 可用。macOS 从 Dock
                  启动时 PATH 可能不含 Homebrew，可装{" "}
                  <code>ffmpeg-full</code> 或改用{" "}
                  <strong>bundled-ffmpeg</strong> 包。若已是 bundled 仍失败，请反馈版本与日志。
                </p>
              </details>
              <details>
                <summary>翻译失败或 Ollama 不可用？</summary>
                <p>
                  翻译依赖本机 Ollama，BYOK 不能代替。请确认托盘/菜单栏
                  Ollama 已运行，执行 <code>ollama list</code>{" "}
                  能列出模型；未拉取默认模型时执行{" "}
                  <code>ollama pull kaelri/hy-mt2:1.8b</code>。
                </p>
              </details>
              <details>
                <summary>在线链接下载失败？</summary>
                <p>
                  安装或升级 yt-dlp（<code>pip install -U yt-dlp</code> 或{" "}
                  <code>brew upgrade yt-dlp</code>
                  ）。部分站点需要更新的 yt-dlp 版本；仅本地文件可忽略此依赖。
                </p>
              </details>
              <details>
                <summary>硬字幕烧录失败？</summary>
                <p>
                  当前 FFmpeg 可能不含 libass。macOS 可试{" "}
                  <code>brew install ffmpeg-full</code>
                  ；Linux 确保安装了 <code>libass</code> 相关包；Windows
                  使用完整构建而非精简版。
                </p>
              </details>
              <details>
                <summary>SenseVoice 模型一直下不下来？</summary>
                <p>
                  检查网络与磁盘空间，在依赖检查界面重试。仍失败时查看任务/系统日志中的下载错误，或手动按仓库{" "}
                  <code>apps/desktop/models/asr/README.md</code> 准备模型目录。
                </p>
              </details>
            </div>
          </section>

          <section className="docs-footer-cta">
            <p>准备好了？</p>
            <a className="button button-primary" href={releaseUrl}>
              <ArrowDownToLine size={18} />
              下载 v{APP_VERSION}
            </a>
          </section>
        </article>
      </div>

      <SiteFooter />
    </main>
  );
}
