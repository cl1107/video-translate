import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaClient } from "./client";

test("找不到 Ollama 可执行文件时启动守护进程返回失败而不抛出未捕获异常", async () => {
  const client = new OllamaClient(
    "http://127.0.0.1:1",
    `video-translate-missing-ollama-${process.pid}`
  );

  assert.equal(await client.startDaemon(), false);
});
