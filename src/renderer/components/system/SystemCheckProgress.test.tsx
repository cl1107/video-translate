import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemCheckProgressView } from "./SystemCheckProgress";

test("SenseVoice 下载期间展示明确阶段和真实下载百分比", () => {
  const html = renderToStaticMarkup(
    <SystemCheckProgressView
      progress={{
        stage: "downloading",
        percent: 62,
        message: "正在下载 SenseVoice 模型... 62%",
      }}
    />
  );

  assert.match(html, /正在下载 SenseVoice 模型/);
  assert.match(html, /62%/);
  assert.match(html, /aria-valuenow="62"/);
});
