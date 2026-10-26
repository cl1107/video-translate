import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { resolve, normalize, dirname } from 'node:path'
import tailwindcss from '@tailwindcss/vite'

import injectProcessEnvPlugin from 'rollup-plugin-inject-process-env'
import reactPlugin from '@vitejs/plugin-react'

import { settings } from './src/lib/electron-router-dom'
import { main, resources } from './package.json'

const [nodeModules, devFolder] = normalize(dirname(main)).split(/\/|\\/g)
const devPath = [nodeModules, devFolder].join('/')

export default defineConfig({
  main: {
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [externalizeDepsPlugin()],

    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // ASR 独立 worker：utilityProcess.fork 执行 sherpa-onnx 推理，
          // 原生层崩溃只死 worker 不拖垮主进程；产物随 main/**/* 打包
          'asr-worker': resolve('src/main/services/asr/asr-worker.ts'),
        },

        output: {
          dir: resolve(devPath, 'main'),
        },
      },
    },
  },

  preload: {
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [externalizeDepsPlugin()],

    build: {
      outDir: resolve(devPath, 'preload'),
    },
  },

  renderer: {
    resolve: {
      tsconfigPaths: true,
    },

    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.platform': JSON.stringify(process.platform),
    },

    server: {
      port: settings.port,
    },

    plugins: [
      tailwindcss(),
      // 需在 @vitejs/plugin-react 之前注册（官方要求）
      codeInspectorPlugin({
        bundler: 'vite',
        hotKeys: ['altKey'],
        hideConsole: true,
      }),
      reactPlugin(),
    ],

    publicDir: resolve(resources, 'public'),

    build: {
      outDir: resolve(devPath, 'renderer'),

      rollupOptions: {
        plugins: [
          injectProcessEnvPlugin({
            NODE_ENV: 'production',
            platform: process.platform,
          }),
        ],

        input: {
          index: resolve('src/renderer/index.html'),
        },

        output: {
          dir: resolve(devPath, 'renderer'),
        },
      },
    },
  },
})
