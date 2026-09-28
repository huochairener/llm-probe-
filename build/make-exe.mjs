#!/usr/bin/env node
// 一键打包成单文件 exe（Node SEA - Single Executable Application）
//
// 用法:  node build/make-exe.mjs
// 产物:  dist/LLM-Probe.exe   （双击即启动，自动开浏览器）
//
// 原理:
//   1. pnpm -r build      构建 server(tsc) + web(vite)
//   2. esbuild            把 server/dist/index.js 及其依赖打成单文件 CJS
//                         （Node SEA 只支持 CommonJS 作为入口）
//   3. sea-config.json    把 web/dist 下的静态资源登记为内嵌 assets
//   4. node --experimental-sea-config  生成 sea-prep.blob
//   5. 复制 node.exe 并注入 blob（postject），得到独立 exe

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(root, 'build')
const distDir = path.join(root, 'dist')
const bundleFile = path.join(buildDir, 'sea-bundle.cjs')
const configFile = path.join(buildDir, 'sea-config.json')
const blobFile = path.join(buildDir, 'sea-prep.blob')
const exeFile = path.join(distDir, 'LLM-Probe.exe')

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function run(cmd, args) {
  console.log(`\n\x1b[36m$\x1b[0m ${cmd} ${args.join(' ')}`)
  // Windows 上 pnpm 是 .cmd，必须走 shell
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}

// 1. 构建前后端
run('pnpm', ['-r', 'build'])

// 2. 打成单文件 CJS
run(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  'server/dist/index.js',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node22',
  '--log-limit=0',
  `--outfile=${bundleFile}`,
])

// 3. 收集 web/dist 静态资源
const assets = {}
;(function walk(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
    else assets[`web/${prefix}${entry.name}`] = full
  }
})(path.join(root, 'web', 'dist'), '')

const config = {
  main: path.relative(root, bundleFile).split(path.sep).join('/'),
  output: path.relative(root, blobFile).split(path.sep).join('/'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
}
fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
console.log(`\n内嵌 ${Object.keys(assets).length} 个前端资源: ${Object.keys(assets).join(', ')}`)

// 4. 生成 SEA blob
run(process.execPath, ['--experimental-sea-config', path.relative(root, configFile)])

// 5. 复制 node.exe -> exe
fs.mkdirSync(distDir, { recursive: true })
fs.copyFileSync(process.execPath, exeFile)
console.log(`\n已复制 Node 运行时: ${process.execPath} -> ${exeFile}`)

// 6. 注入 blob
run(process.execPath, [
  path.join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
  exeFile,
  'NODE_SEA_BLOB',
  blobFile,
  '--sentinel-fuse',
  SEA_FUSE,
])

const mb = (fs.statSync(exeFile).size / 1024 / 1024).toFixed(1)
console.log(`\n\x1b[32m✓ 打包完成\x1b[0m  ${exeFile}  (${mb} MB)`)
console.log('  双击 exe 即可启动，会自动打开浏览器。')
