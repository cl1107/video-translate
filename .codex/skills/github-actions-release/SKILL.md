---
name: github-actions-release
description: Execute and troubleshoot GitHub Actions releases for this monorepo, including pnpm setup, multi-platform Electron packaging, tag replacement, artifact publication, and post-release verification. Use when a user asks to trigger, rerun, repair, or verify a GitHub Actions release, especially when pnpm/action-setup, setup-node caching, release tags, unsigned bundled/slim artifacts, or the Publish GitHub Release job is involved.
---

# GitHub Actions Release

按“配置检查 → 本地轻量验证 → 提交与 tag → 观察 Actions → 验证 Release”执行发布。先检查仓库当前状态和 workflow，再决定是否需要修改；不要因为 CI 失败直接删除根目录 `packageManager`。

## 1. 固定包管理器安装路径

本仓库的版本真值是根 `package.json` 的：

```json
"packageManager": "pnpm@11.12.0"
```

`turbo` 依赖这个字段解析 workspace。CI 使用 Node 22，并按以下顺序安装 pnpm：

```yaml
- name: Set up Node.js
  uses: actions/setup-node@v5
  with:
    node-version: 22
    package-manager-cache: false

- name: Set up pnpm
  run: npm install --global pnpm@11.12.0
```

随后显式执行 `pnpm --version` 和版本校验。`package-manager-cache: false` 必须保留：`setup-node` 会读取根 `packageManager` 并在 pnpm 尚未安装时自动尝试缓存，导致 `Unable to locate executable file: pnpm`。

### pnpm/action-setup 的已知故障

遇到以下错误时，先移除 `pnpm/action-setup`，不要继续尝试删掉 `packageManager`：

- `Cannot use 'in' operator to search for 'integrity' in undefined`
- action 从 bootstrap 版本切换到 `11.12.0` 时失败
- `standalone: true` 后出现 `This: not found` 或 `@pnpm/exe` 无效
- Windows runner 无法执行 self-installer 生成的 pnpm

固定 `pnpm/action-setup@v6.0.8` 仍可能失败，因为 action 会先自举一个 pnpm，再执行 self-update。`standalone: true` 又可能让 setup-node 缓存到损坏的可执行文件。当前验证通过的方案是 Node 先安装，再用 npm 全局安装目标 pnpm，并关闭 setup-node 自动缓存。

## 2. 发布 workflow 检查

修改前检查：

```bash
git status --short
git branch --show-current
sed -n '1,260p' .github/workflows/release.yml
sed -n '1,220p' .github/workflows/pages.yml
```

确认以下约束仍成立：

- tag 校验读取 `apps/desktop/package.json` 的版本。
- 矩阵只包含 macOS arm64、Windows x64、Linux x64。
- 每个平台同时生成 `bundled-ffmpeg` 和 `slim`，artifact 名称必须区分两者。
- Electron 构建从桌面包上下文执行：`pnpm --filter video-translate run build:ci`。
- Linux target 只保留项目要求的格式；不要让额外平台或 `.blockmap` 混入发布资产。
- Pages workflow 与 release workflow 使用同一套可验证的 pnpm 安装策略。

轻量验证优先于完整原生构建：

```bash
pnpm exec vitest run tests/release-workflow.test.mjs tests/package-manager-config.test.mjs
pnpm exec oxfmt --check package.json apps/desktop/package.json apps/landing/package.json apps/landing/src/App.tsx README.md .github/workflows/release.yml
git diff --check
```

测试应验证真实版本、安装命令、缓存开关、构建脚本和 artifact 规则；不要只断言字段存在。

## 3. 提交、tag 和重发

用户只要求触发已存在版本时，先确认是否允许替换远端 tag。只有得到明确确认后，才执行删除并重建；不使用 force push：

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
git tag -a vX.Y.Z -m "发布 vX.Y.Z"
git push origin HEAD
git push origin vX.Y.Z
```

版本变更使用中文 Conventional Commit，例如：

```text
chore(release): 发布 v0.4.1
```

若 tag、commit 或 push 失败，保留现场并报告失败点，不自动重复覆盖。

## 4. 观察 Actions

触发后记录运行 ID 和 URL：

```bash
gh run list --workflow release.yml --limit 5
gh run watch RUN_ID --exit-status
gh run view RUN_ID --json status,conclusion,jobs
```

按阶段判断：

1. `Set up Node.js` 失败：检查 `package-manager-cache: false` 是否存在。
2. `Set up pnpm` 失败：确认没有残留 `pnpm/action-setup`，并查看 npm 全局安装输出。
3. `Verify release version` 失败：比较 tag、`apps/desktop/package.json` 和 workflow 读取路径。
4. 依赖安装失败：先确认 pnpm 版本，再区分 registry、原生依赖和 workflow 配置问题。
5. 构建步骤持续较久：以 job 状态和最终日志为准，不因等待时间长提前重跑；bundled Linux/Windows 构建可能明显慢于 slim。
6. `Publish GitHub Release` 必须完成后，才报告发布完成；矩阵构建成功不等于 Release 已创建。

如果 GitHub API 触发 rate limit，改用公开 Actions 页面和 Release 页面确认，不要连续高频轮询 API。

## 5. 发布后验证

验证远端分支、tag 和实际 Release：

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main 'refs/tags/vX.Y.Z^{}'
```

只有两者都指向本次提交，并且 Release 页面显示目标 tag、六个构建产物（或当前矩阵约定的完整数量）及 checksum，才报告完成。若页面仍显示旧状态，重新打开页面确认；不要仅凭一次 API 响应下结论。

## 失败模式速查

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `Could not resolve workspace` | 根 `packageManager` 缺失 | 恢复并固定 `pnpm@11.12.0` |
| self-installer 的 `integrity` 错误 | action 自举版本切换失败 | 改为 Node 后 `npm install --global` |
| standalone 生成 `This: not found` | `@pnpm/exe` 下载或缓存异常 | 移除 standalone，并关闭自动缓存 |
| setup-node 找不到 pnpm | 自动缓存早于 pnpm 安装 | 设置 `package-manager-cache: false` |
| `electron-builder: command not found` | 从错误 workspace 上下文直接调用 | 使用桌面包的 `build:ci` 脚本 |
| Release 没有资产 | 只完成了矩阵 job | 等待并检查 `Publish GitHub Release` |
