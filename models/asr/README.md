# ASR 模型目录（sherpa-onnx）

本项目使用 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 做本地语音识别。

## 默认行为：自动下载

**无需手动安装。** 应用在依赖检查 / 启动 / 首次任务时会自动下载并解压 **SenseVoice Small** 到本目录。

手动放模型也可以，路径任选其一：

```
models/asr/sensevoice-small/
  model.int8.onnx   # 或 model.onnx
  tokens.txt
```

或：

```
models/asr/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/
```

> 注意：闪电说等 App 自带的 `model.onnx + tokens.json` 是 FunASR 原生导出，通常缺少 sherpa-onnx 需要的 ONNX metadata，**不能直接使用**。

## Fun-ASR-Nano（可选，暂不自动下载）

体积较大（约 950MB），需要时手动下载：

```bash
cd models/asr
curl -L -O https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2
tar xvf sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2
ln -sfn sherpa-onnx-funasr-nano-int8-2025-12-30 funasr-nano
```

也可通过环境变量指定模型根目录：

```bash
export VIDEO_TRANSLATE_ASR_MODELS=/path/to/models/asr
```
