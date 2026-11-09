import { expect, open, test } from "nsh/test";

test("shows the workbench", async () => {
  const app = await open(".");
  expect(app.texts()).toContain("视频翻译助手");
  expect(app.texts()).toContain("字幕");
  expect(app.texts()).toContain("添加");
});
