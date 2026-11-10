# NSH 重构审查与验收（2026-11-10）

本次在 cindy/jolly-jang 上审查 2629c59 到 3ae9fd0 的迁移，并实施修复。按用户后续要求，以原 Electron 工作台的实际界面与源码为视觉基准还原 NSH。保留去 Electron、使用长桥 NSH 的方向。

## 已确认并修复

- 后台作业原先属于“添加”页的组件生命周期，切到任务页后接收器被取消，真实窗口任务一直排队。现由应用根节点持有作业；新增异步切页与导出回归。
- SQLite INSERT OR REPLACE 触发级联删除历史日志；改为事务内冲突更新，保存完整日志，失败回滚。删除运行中任务后不再被延迟事件重新写回；恢复不会重复启动同一任务。
- Runtime 过早加载 ASR，导致缺模型时连 SRT 导入都失败；改为需要识别时才初始化。恢复使用任务保存的配置与对应服务密钥，避免读取当前另一个服务的配置。
- 原 vt extract 无条件使用模拟识别；改为真实 ASR，只有显式模拟开关才模拟。
- 使用官方 sherpa-onnx 2.0.1 Rust API 静态链接，支持 SenseVoice 和可选 Fun-ASR-Nano。只读复用现有模型目录，无需安装 CLI。修复块内字幕 ID 重复及缓存指纹失效；使用真实 token 时间戳分句，对齐不足时保留块级时间，不估算假精度。
- 润色模型配置原先未生效；现按润色/翻译分别选择模型。空、缺字段或截断响应明确失败；文稿分块请求、保存块级检查点，附可跳转的来源索引。
- FFmpeg 和下载支持终止进程组；平台字幕按源语选择、人工优先。未知源语不会冒用任意语言字幕。恢复复用已下载媒体。
- 增加按服务保存的密钥，停止线程中修改全局环境变量；密钥输入遮罩，Unix 凭证文件权限 600，任务和日志不存密钥。
- 精确时间输入、拖改范围、播放头定起止、分段、合并、单段预览、当前字幕联动与重新导出；时间在统一写入边界验证，使用 FFprobe 的媒体时长。
- 显式只读导入 Electron 历史任务，映射实际旧配置契约，事务导入且幂等，不迁移密钥或不兼容的旧断点。
- 官网、安装说明、默认构建与发布配置改为真实 NSH 路径。历史 Electron 发布和测试保留为显式入口，未推送或发布。

## 界面还原

参考 apps/desktop 的 PRODUCT.md、DESIGN.md、main.tsx、VideoUploader.tsx、TaskList.tsx、settings.tsx 与 subtitle-review.tsx，并实际启动隔离配置的旧版 Electron 对照截图。

恢复原有 Logo、56px 顶栏、字幕/文稿工作流、添加/任务分段导航、主题控制、居中内容宽度、文件拖放区与在线链接卡片。任务页恢复全宽卡片、按状态显示操作、日志按需展开；设置恢复“常规/模型/系统”分类侧栏和分组表单。校对恢复左侧媒体/问题检查、右侧字幕编辑的双栏结构。沿用原中性主题与酸绿状态点缀。

NSH 原生控件与网页控件存在渲染差异，本次按结构、尺寸和视觉层级还原，并非像素级复刻。

## 实际运行证据

工作区绝对路径：/Users/cl/ai/video-translate/.cindy-worktrees/jolly-jang。

- 打包版实际启动：apps/nsh/.nsh/out/视频翻译助手.app/Contents/MacOS/App；验收数据目录隔离在 artifacts/nsh-review/restored-data。
- 官方中文语音样本经 FFmpeg 合成测试画面的视频，实际完成本地抽音、进程内识别及原文 SRT 导出；识别文本“开饭时间早上9点至下午5点。”。原始 token 起点 0.720 秒，校对后结束时间 5.500 秒，字幕文件为 artifacts/nsh-review/output/sample.und-3.srt。
- 宿主桌面工具实际操作视频导入、校对播放、精确时间修改、播放头分段、合并、重新导出。读取真实输出文件确认修改已写入。
- 300 秒本地音频实际进入识别后暂停，状态落盘为 paused；恢复后重新进入识别，随后取消并落盘为 cancelled。
- 同一转录复用到文稿，实际生成并在应用内显示 Markdown 与来源索引。此项开启了“模拟翻译”，验证的是复用/导出/预览路径，不能作为真实模型整理质量证明；结束后已关闭模拟识别和模拟翻译。
- 对真实旧库隔离导入 6 个任务、1477 个字幕段、193 条日志。旧库只读，不修改原数据。
- 实际运行安装脚本，将应用安装到隔离的 artifacts/nsh-review/install/；签名校验通过。

截图位于 artifacts/nsh-review/：reference-add.png、reference-electron.png、final-add.png、final-settings.png、final-tasks.png、final-review.png、final-document-mock.png、final-paused.png、final-cancelled.png。

## 技术选型与边界

NSH 官方最新稳定版本在本次核验时仍为 0.4.0，提交 e626a8d，与本机一致；不把 nightly 当稳定版。[官方发布记录](https://github.com/longbridge/nsh/releases)

Rust 领域层可复用于桌面与 CLI，SQLite 事务保存状态，FFmpeg 负责成熟的媒体处理。静态链接的 sherpa-onnx 移除额外 CLI 的安装门槛；macOS 包仅链接系统动态库，未依赖本机 sherpa/ONNX dylib。[官方 Rust 示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/rust-api-examples/examples/sense_voice.rs)、[静态链接说明](https://k2-fsa.github.io/sherpa/onnx/rust-api/advanced-install.html)

仍需明确区分：

- 没有可用的真实模型服务/凭证，真实翻译、润色与模型文稿整理尚未完成外部服务验收。自动化使用可观察 mock，真实本地 ASR 没有模拟。
- 单次原生 decode 需要完成当前最多 30 秒音频块；单次模型 HTTP 请求设置 120 秒上限，取消要等当前请求返回。外部 FFmpeg/下载进程可主动终止。
- 官方 Rust 安全封装未暴露 SenseVoice 的语言结果，auto 的源语言保持未知，文件标为 und；没有猜测语言。
- Fun-ASR-Nano 接口已接入，但本机未用其模型实际验收。Windows/Linux 原生代码和安装包未在目标机器验证，本次只交付 macOS arm64。
- 当前字幕导出为 SRT/ASS，尚未提供旧版所有输出格式和在线纯音频下载优化；下载 auto 使用匿名优先，需登录的网站应明确选择浏览器 Cookie。
- 旧设置与凭证不自动导入。macOS 应用为 ad hoc 签名，未做 Apple 公证。

## 检查与产物

NSH 共 43 项测试通过，包括领域、异步界面和历史导入；nsh check、官网类型检查/构建、仓库 lint、根目录发布配置测试通过。实际应用启动和桌面场景验证另列于上文，不能由测试替代。

完整旧测试入口曾出现 Electron 二进制安装异常（两组测试）和写死 FFmpeg 8.1.2 的测试在本机 9.0.2 上失败；这些废弃实现的问题未扩大处理。默认 pnpm test 已聚焦当前 NSH 与仓库配置；旧实现可用 pnpm test:electron 单独执行。

- 应用：apps/nsh/.nsh/out/视频翻译助手.app
- 分发包：apps/nsh/.nsh/release/v0.9.0/video-translate-v0.9.0-mac-arm64-nsh.zip
- 校验和：同目录 SHA256SUMS.txt
- 可复现构建：pnpm build:desktop；本地打包：pnpm make:release；安装：pnpm install:local。
- 原有未跟踪 .agents/skills/video-translate-cli 和 .claude/ 保留，未纳入提交。

末轮补截图时宿主桌面通道返回 CUA_UNAVAILABLE（驱动授权宿主 unavailable）。未绕过该限制；截图使用上文场景中已经真实拍摄的文件，校对图保存自实际视频播放/编辑验证时的捕获。最后一次代码调整仅清理暂停/取消完成后的过期提示；该提示调整经测试与打包，未再次取得桌面截图。
