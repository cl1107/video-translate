export const CLI_NAME = 'vt'

export const CLI_HELP = `
视频翻译助手 CLI — 本地字幕翻译 / 文稿整理

用法:
  vt <文件或URL> [选项]          默认创建字幕翻译任务并等待完成
  vt subtitle <输入> [选项]
  vt document <输入> [选项]
  vt extract <输入> [选项]       仅提取原文字幕（无需模型服务）
  vt import <srt|vtt> [选项]

任务:
  vt task list [--kind subtitle|document]
  vt task get <id> [--full]
  vt task wait <id>
  vt task logs <id>
  vt task artifacts <id>
  vt task markdown <id>
  vt task issues <id>
  vt task pause|resume|retry|delete <id>
  vt task delete --ids id1,id2
  vt task burn <id> [--mode bilingual|translated|original]
  vt task attach-media <id> <视频>
  vt task regenerate-subtitles <id>
  vt task reuse <id> --kind subtitle|document --target-lang zh
  vt task segment update <id> --segment-id <sid> [--start] [--end] [--original] [--translated]
  vt task segment retranslate <id> --segment-id <sid>

配置:
  vt config get [key]
  vt config set <key> <value>
  vt config path
  vt glossary list|add|remove
  vt llm key set|status|clear [--service-id] [--value]
  vt llm models [--base-url]
  vt asr status
  vt doctor
  vt cache stats|clear
  vt stats
  vt install [--bin ~/.local/bin/vt] [--app /Applications/视频翻译助手.app]

常用选项:
  --json                 机器可读 JSON（Agent 默认使用）
  --source-lang auto     源语言
  --target-lang zh       目标语言
  --asr sensevoice       ASR 引擎：sensevoice | funasr-nano
  --llm-base-url URL     模型服务 Endpoint
  --translate-model ID   翻译模型
  --polish-model ID      润色模型（空则跟随翻译模型）
  --no-polish            跳过识别润色
  --glossary file.json   术语表 [{source,target}]
  --burn                 完成后烧录硬字幕
  --burn-mode bilingual  bilingual | translated | original
  --output-location DIR  output-subdirectory | source-directory
  --detach               立即把 taskId 打到 stderr，并继续等待完成
  --user-data DIR        覆盖应用数据目录
  --share-desktop        与桌面应用共用 userData（安装包启动时默认开启）
  --help

环境变量:
  VIDEO_TRANSLATE_USER_DATA
  VIDEO_TRANSLATE_APP
  VIDEO_TRANSLATE_USE_SOURCE
  VIDEO_TRANSLATE_LLM_BASE_URL
  VIDEO_TRANSLATE_LLM_API_KEY
  VIDEO_TRANSLATE_TRANSLATE_MODEL
  VIDEO_TRANSLATE_POLISH_MODEL
  VIDEO_TRANSLATE_ASR_ENGINE
  VIDEO_TRANSLATE_ASR_MODELS
`.trim()
