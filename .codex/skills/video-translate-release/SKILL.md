---
name: video-translate-release
description: Execute a complete release for the video-translate monorepo, including synchronizing the product version, validating release configuration, committing changes, creating a version tag, and pushing the commit and tag. Use when the user asks to release, bump the version, create a vX.Y.Z tag, or push a release from this repository.
---

# Video Translate Release

在当前仓库执行完整发版。用户给出明确版本号时，直接完成版本同步、验证、提交、打 tag 和推送。

## 版本同步

将目标版本写入以下当前产品文件：

- `apps/desktop/package.json` 的 `version`
- `apps/landing/package.json` 的 `version`
- `apps/landing/src/App.tsx` 中下载按钮和页脚展示的版本
- `README.md` 的版本徽章

只修改当前版本字段和展示文案。`tests/` 中用于验证历史 release notes 的旧版本样例保持不变。

## 发版前检查

1. 读取 `git status --short`、当前分支和远端，确认目标 tag 尚不存在。
2. 检查四处产品版本完全等于目标版本，并确认 `.github/workflows/release.yml` 的 tag 校验仍读取 `apps/desktop/package.json`。
3. 运行轻量验证，避免仅为版本字符串触发完整原生构建：

   ```bash
   pnpm exec vitest run tests/release-workflow.test.mjs tests/package-manager-config.test.mjs
   pnpm exec oxfmt --check package.json apps/desktop/package.json apps/landing/package.json apps/landing/src/App.tsx README.md .github/workflows/release.yml
   git diff --check
   ```

4. 检查完整 diff，避免把密钥、`.env` 或明显不属于当前发版的文件提交。当前工作区已有的业务改动按用户的发版指令纳入提交；发现范围不明确时先停下说明。

## GitHub Pages

仓库的 Landing 页面由 `.github/workflows/pages.yml` 构建并部署到 GitHub Pages。首次启用时，在仓库 Settings → Pages 将 Source 设为 GitHub Actions；之后每次推送 `main` 会自动部署 `apps/landing`。

发版后检查 Actions 中的 `Deploy Landing Page` workflow，并访问 `https://cl1107.github.io/video-translate/` 确认页面可打开。项目描述中的 Landing 链接使用该地址。

## 提交、tag 与推送

使用中文 Conventional Commit：

```text
chore(release): 发布 vX.Y.Z
```

提交后执行：

```bash
git tag -a vX.Y.Z -m "发布 vX.Y.Z"
git push origin HEAD
git push origin vX.Y.Z
```

禁止 force push。若 commit、tag 或 push 任一步失败，保留现场并报告具体失败点，不重复创建或覆盖 tag。

## 发布后验证

确认以下命令中的 commit 一致，并报告远端分支和 tag 的结果：

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main refs/tags/vX.Y.Z
```

只有远端分支和 tag 都指向本次提交时，才报告发版完成。
