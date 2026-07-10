# ASR 模型目录（sherpa-onnx）

本项目使用 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 做本地语音识别。

## SenseVoice Small（默认，已支持）

官方 int8 模型（推荐）：

```bash
cd models/asr
curl -L -O https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
tar xvf sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
ln -sfn sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17 sensevoice-small
```

期望结构：

```
models/asr/sensevoice-small/
  model.int8.onnx   # 或 model.onnx
  tokens.txt
```

> 注意：闪电说等 App 自带的 `model.onnx + tokens.json` 是 FunASR 原生导出，通常缺少 sherpa-onnx 需要的 ONNX metadata，**不能直接使用**。请使用上述官方转换模型。

## Fun-ASR-Nano（可选）

```bash
cd models/asr
curl -L -O https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2
tar xvf sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2
ln -sfn sherpa-onnx-funasr-nano-int8-2025-12-30 funasr-nano
```

期望结构：

```
models/asr/funasr-nano/
  encoder_adaptor.int8.onnx
  llm.int8.onnx
  embedding.int8.onnx
  Qwen3-0.6B/
```

也可通过环境变量指定模型根目录：

```bash
export VIDEO_TRANSLATE_ASR_MODELS=/path/to/models/asr
```
