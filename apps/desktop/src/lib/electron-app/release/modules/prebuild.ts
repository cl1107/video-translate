import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import trustedDependencies from '../../../../../trusted-dependencies-scripts.json'
import packageJSON from '../../../../../package.json'
import { getDevFolder } from '../utils/path'

const ONLY_BUILT_DEPENDENCIES_FILE = 'trusted-dependencies-scripts.json'

const ALLOWED_RUNTIME_DEPENDENCIES = new Set([
  'better-sqlite3',
  'dayjs',
  'openai',
  'sherpa-onnx-node',
  'uuid',
])

async function createPackageJSONDistVersion() {
  const {
    main,
    scripts: _scripts,
    resources: _resources,
    devDependencies: _devDependencies,
    dependencies,
    ...rest
  } = packageJSON as any

  const filteredDependencies: Record<string, string> = {}
  if (dependencies) {
    for (const [key, value] of Object.entries(dependencies)) {
      if (ALLOWED_RUNTIME_DEPENDENCIES.has(key)) {
        filteredDependencies[key] = value as string
      }
    }
  }

  const packageJSONDistVersion = {
    main: './main/index.js',
    ...rest,
    dependencies: filteredDependencies,
  }

  try {
    await Promise.all([
      writeFile(
        resolve(getDevFolder(main), 'package.json'),
        JSON.stringify(packageJSONDistVersion, null, 2)
      ),

      writeFile(
        resolve(getDevFolder(main), ONLY_BUILT_DEPENDENCIES_FILE),
        JSON.stringify(trustedDependencies, null, 2)
      ),
    ])
  } catch ({ message }: any) {
    console.log(`
    🛑 Something went wrong!\n
      🧐 There was a problem creating the package.json dist version...\n
      👀 Error: ${message}
    `)
  }
}

createPackageJSONDistVersion()
