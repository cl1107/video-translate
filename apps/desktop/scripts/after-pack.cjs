/**
 * electron-builder afterPack 钩子脚本
 * 负责在应用打包后、代码签名与生成安装包前，执行深度体积精简与剔除无用资源
 */

const fs = require('node:fs')
const path = require('node:path')

const KEEP_LOCALES = new Set([
  'zh_CN.lproj',
  'zh_TW.lproj',
  'zh-Hans.lproj',
  'zh-Hant.lproj',
  'en.lproj',
  'en_US.lproj',
  'zh-CN.pak',
  'zh-TW.pak',
  'en-US.pak',
  'en-GB.pak',
])

function removeDirectoryRecursive(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }
}

function removeFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // ignore
    }
  }
}

/**
 * 递归删除匹配扩展名或名称的无用文件
 */
function pruneUnneededFiles(dir) {
  if (!fs.existsSync(dir)) return

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (
        entry.name === '__tests__' ||
        entry.name === 'tests' ||
        entry.name === 'test' ||
        entry.name === '.github'
      ) {
        removeDirectoryRecursive(fullPath)
      } else {
        pruneUnneededFiles(fullPath)
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (
        ext === '.map' ||
        ext === '.ts' ||
        ext === '.gyp' ||
        ext === '.mk' ||
        ext === '.cc' ||
        ext === '.cpp' ||
        ext === '.c' ||
        ext === '.h' ||
        entry.name.endsWith('.d.ts') ||
        entry.name.endsWith('.d.ts.map') ||
        (ext === '.md' && !entry.name.toLowerCase().startsWith('license')) ||
        entry.name === 'Makefile'
      ) {
        removeFileIfExists(fullPath)
      }
    }
  }
}

/**
 * 清理 better-sqlite3 构建与源码残留 (可节省约 20MB+)
 */
function pruneBetterSqlite3(unpackedDir) {
  const betterSqliteDir = path.join(
    unpackedDir,
    'node_modules',
    'better-sqlite3'
  )
  if (!fs.existsSync(betterSqliteDir)) return

  // 删除源码与中间构建目录
  removeDirectoryRecursive(path.join(betterSqliteDir, 'deps'))
  removeDirectoryRecursive(path.join(betterSqliteDir, 'src'))
  removeDirectoryRecursive(path.join(betterSqliteDir, 'bin'))
  removeDirectoryRecursive(
    path.join(betterSqliteDir, 'build', 'Release', 'obj')
  )
  removeDirectoryRecursive(
    path.join(betterSqliteDir, 'build', 'Release', 'obj.target')
  )
  removeDirectoryRecursive(path.join(betterSqliteDir, 'build', 'deps'))

  // 删除编译产生的静态库及测试模块
  removeFileIfExists(
    path.join(betterSqliteDir, 'build', 'Release', 'sqlite3.a')
  )
  removeFileIfExists(
    path.join(betterSqliteDir, 'build', 'Release', 'test_extension.node')
  )
  removeFileIfExists(path.join(betterSqliteDir, 'build', 'Makefile'))
  removeFileIfExists(path.join(betterSqliteDir, 'build', 'config.gypi'))
  removeFileIfExists(path.join(betterSqliteDir, 'binding.gyp'))

  console.log(
    '  ✓ [afterPack] 已清理 better-sqlite3 源码、中间编译产物与临时文件'
  )
}

/**
 * 去重 sherpa-onnx 中的 libonnxruntime.dylib (可节省约 28MB)
 */
function deduplicateSherpaOnnxDylib(unpackedDir) {
  const nodeModulesDir = path.join(unpackedDir, 'node_modules')
  if (!fs.existsSync(nodeModulesDir)) return

  const entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('sherpa-onnx-darwin-')) {
      const packageDir = path.join(nodeModulesDir, entry.name)
      const versionedDylib = path.join(
        packageDir,
        'libonnxruntime.1.27.0.dylib'
      )
      const unversionedDylib = path.join(packageDir, 'libonnxruntime.dylib')

      if (fs.existsSync(versionedDylib) && fs.existsSync(unversionedDylib)) {
        try {
          const stat1 = fs.lstatSync(unversionedDylib)
          if (!stat1.isSymbolicLink()) {
            fs.unlinkSync(unversionedDylib)
            fs.symlinkSync('libonnxruntime.1.27.0.dylib', unversionedDylib)
            console.log(
              `  ✓ [afterPack] 已将 ${entry.name}/libonnxruntime.dylib 替换为相对软链接 (节省 ~28MB)`
            )
          }
        } catch (err) {
          console.warn(
            `  ! [afterPack] 处理 ${entry.name} 动态库去重失败:`,
            err.message
          )
        }
      }
    }
  }
}

/**
 * 清理 macOS 冗余多语言资源 (.lproj)
 */
function pruneMacLocales(resourcesDir, frameworkResourcesDir) {
  let prunedCount = 0

  const cleanDir = targetDir => {
    if (!fs.existsSync(targetDir)) return
    const items = fs.readdirSync(targetDir)
    for (const item of items) {
      if (item.endsWith('.lproj') && !KEEP_LOCALES.has(item)) {
        removeDirectoryRecursive(path.join(targetDir, item))
        prunedCount++
      }
    }
  }

  cleanDir(resourcesDir)
  cleanDir(frameworkResourcesDir)

  if (prunedCount > 0) {
    console.log(
      `  ✓ [afterPack] 已移除 ${prunedCount} 个非中英文 .lproj 语言包`
    )
  }
}

/**
 * 清理 Windows / Linux 冗余多语言资源 (.pak)
 */
function pruneOtherLocales(localesDir) {
  if (!fs.existsSync(localesDir)) return
  let prunedCount = 0
  const items = fs.readdirSync(localesDir)
  for (const item of items) {
    if (item.endsWith('.pak') && !KEEP_LOCALES.has(item)) {
      removeFileIfExists(path.join(localesDir, item))
      prunedCount++
    }
  }
  if (prunedCount > 0) {
    console.log(
      `  ✓ [afterPack] 已移除 ${prunedCount} 个非中英文 locales pak 语言文件`
    )
  }
}

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context
  const platform = packager.platform.name

  console.log(`\n==> [afterPack] 开始执行应用体积深度精简优化 (${platform})...`)

  if (platform === 'mac') {
    const appName = packager.appInfo.productFilename
    const appDir = path.join(appOutDir, `${appName}.app`)
    const contentsDir = path.join(appDir, 'Contents')
    const resourcesDir = path.join(contentsDir, 'Resources')
    const frameworkResourcesDir = path.join(
      contentsDir,
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources'
    )
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')

    // 1. 语言包精简
    pruneMacLocales(resourcesDir, frameworkResourcesDir)

    // 2. 原生模块瘦身
    if (fs.existsSync(unpackedDir)) {
      deduplicateSherpaOnnxDylib(unpackedDir)
      pruneBetterSqlite3(unpackedDir)
      pruneUnneededFiles(unpackedDir)
    }
  } else {
    // Windows / Linux
    const resourcesDir = path.join(appOutDir, 'resources')
    const localesDir = path.join(appOutDir, 'locales')
    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')

    pruneOtherLocales(localesDir)

    if (fs.existsSync(unpackedDir)) {
      pruneBetterSqlite3(unpackedDir)
      pruneUnneededFiles(unpackedDir)
    }
  }

  console.log(`==> [afterPack] 体积深度精简优化完成！\n`)
}
