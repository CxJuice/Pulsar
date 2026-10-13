import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const buildInfo = resolve(root, '.output/public/build-info.json')
const unpacked = resolve(root, 'release/desktop/win-unpacked')
if (!existsSync(buildInfo) || !existsSync(resolve(unpacked, 'Pulsar.exe'))) throw new Error('打包产物或构建版本清单缺失')
copyFileSync(buildInfo, resolve(unpacked, 'build-info.json'))
