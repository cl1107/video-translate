import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { checkSystemDependencies } from "./system-check";

const originalPath = process.env.PATH;
const originalHomebrewPrefix = process.env.HOMEBREW_PREFIX;
let testDirectory: string | undefined;

afterEach(async () => {
  process.env.PATH = originalPath;

  if (originalHomebrewPrefix === undefined) {
    Reflect.deleteProperty(process.env, "HOMEBREW_PREFIX");
  } else {
    process.env.HOMEBREW_PREFIX = originalHomebrewPrefix;
  }

  if (testDirectory) {
    await rm(testDirectory, { recursive: true, force: true });
    testDirectory = undefined;
  }
});

test("macOS 图形应用的 PATH 缺少 Homebrew 时仍能识别 keg-only ffmpeg-full", async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), "video-translate-"));
  const binDirectory = path.join(
    testDirectory,
    "opt",
    "ffmpeg-full",
    "bin"
  );
  await mkdir(binDirectory, { recursive: true });

  for (const command of ["ffmpeg", "ffprobe"]) {
    const executablePath = path.join(binDirectory, command);
    await writeFile(
      executablePath,
      `#!/bin/sh\nprintf '${command} version 8.1.2\\n'\n`
    );
    await chmod(executablePath, 0o755);
  }

  process.env.PATH = "/usr/bin:/bin";
  process.env.HOMEBREW_PREFIX = testDirectory;

  const results = await checkSystemDependencies({ autoDownloadAsr: false });
  const mediaTools = results.filter(({ name }) =>
    ["ffmpeg", "ffprobe"].includes(name)
  );

  assert.deepEqual(mediaTools, [
    { name: "ffmpeg", available: true, version: "8.1.2" },
    { name: "ffprobe", available: true, version: "8.1.2" },
  ]);
});
