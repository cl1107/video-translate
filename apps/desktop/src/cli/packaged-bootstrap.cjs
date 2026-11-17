'use strict'
/**
 * 安装包内 CLI 入口：由 ELECTRON_RUN_AS_NODE=1 的应用可执行文件加载。
 * 放在 Contents/Resources，普通 Node 也能 existsSync 探测到。
 */
const fs = require('node:fs')
const path = require('node:path')

const resources = process.resourcesPath
if (!resources) {
  console.error(
    'cli-bootstrap: 缺少 process.resourcesPath，请通过应用可执行文件启动'
  )
  process.exit(1)
}

const candidates = [
  path.join(resources, 'app.asar', 'main', 'cli.js'),
  path.join(resources, 'app', 'main', 'cli.js'),
]
const entry = candidates.find(file => fs.existsSync(file))
if (!entry) {
  console.error('cli-bootstrap: 未找到 main/cli.js，请安装包含 CLI 的桌面版')
  process.exit(1)
}

require(entry)
