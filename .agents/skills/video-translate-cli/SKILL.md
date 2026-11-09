---
name: video-translate-cli
description: 用 vt CLI 做视频/音频翻译、原文字幕提取、转录总结成 Markdown 文稿，以及任务查询、校对、烧录、模型与 ASR 配置。用户提到 vt、CLI 翻译视频、转写、生成字幕、整理文稿时使用。
---

# 视频翻译 CLI

优先调用 PATH 上的 `vt`（绑定 `/Applications/视频翻译助手.app`）。没有全局命令时，在仓库根用 `pnpm vt`。完整命令以 `vt --help` 为准。

## 约定

- 每条命令加 `--json`。进度在 stderr，结果在 stdout。
- 创建类命令会等到任务 `completed` 或失败后返回。
- 全局 `vt`（安装包启动）与桌面共用 userData。`pnpm vt` 默认用旁边的 `视频翻译助手-cli`；要共用桌面库时加 `--share-desktop`。
- API Key 用 `VIDEO_TRANSLATE_LLM_API_KEY` 或 `vt llm key set --value <key> --json`。不要把密钥写进任务日志或回复。

## 步骤

1. **定位 CLI**  
   先 `vt --help`，没有命令再在仓库根执行 `pnpm vt --help`。能打印帮助即完成。

2. **按意图选命令**

   | 意图                | 命令                             |
   | ------------------- | -------------------------------- |
   | 翻译并导出字幕      | `vt subtitle <文件或URL> --json` |
   | 只要原文字幕        | `vt extract <文件或URL> --json`  |
   | 整篇润色为 Markdown | `vt document <文件或URL> --json` |
   | 导入已有 SRT/VTT    | `vt import <字幕文件> --json`    |

   本地路径用绝对路径。http(s) 链接走 yt-dlp。

3. **补齐运行配置（缺什么补什么）**  
   翻译/文稿需要模型服务。先 `vt doctor --json`，再按需：

   ```bash
   vt config set llmBaseUrl http://127.0.0.1:11434 --json
   vt config set translateModel <model-id> --json
   vt llm models --json
   vt llm key set --value "$VIDEO_TRANSLATE_LLM_API_KEY" --json
   ```

   常用一次性覆盖：`--source-lang` `--target-lang` `--asr` `--llm-base-url` `--translate-model` `--no-polish` `--burn` `--glossary <file.json>`。

4. **执行并验收**  
   成功：`ok: true` 且 `task.status` 为 `completed`，并回报 `artifacts` 路径。  
   失败：把 `error` 与 `vt task logs <id> --json` 一并交给用户。  
   文稿再读 `vt task markdown <id> --json`。字幕问题用 `vt task issues <id> --json`。

5. **后续任务操作（仅在用户要求时）**  
   `task list|get|wait|pause|resume|retry|delete`、`task burn`、`task attach-media`、`task segment update|retranslate`、`task regenerate-subtitles`、`task reuse --kind subtitle|document --target-lang zh`、`glossary`、`cache`、`asr status`、`stats`。

## 完成标准

把产物路径（字幕 / Markdown / 烧录视频）和任务 ID 写回用户。未完成的任务不得称为成功。
