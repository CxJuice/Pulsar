import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const inputs = ['app', 'electron', 'service', 'public', 'scripts', 'package.json', 'package-lock.json', 'nuxt.config.ts', 'tsconfig.json', '启动.py']
const git = (...args) => execFileSync('git', args, { cwd: root })
const commit = git('rev-parse', 'HEAD').toString('utf8').trim()
const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...inputs)
  .toString('utf8').split('\0').filter(Boolean))].sort()
const hash = createHash('sha256')
for (const name of paths) {
  let bytes
  try { bytes = readFileSync(resolve(root, name)) } catch { bytes = Buffer.from('<deleted>') }
  hash.update(name).update('\0').update(bytes).update('\0')
}
const output = resolve(root, '.output/public/build-info.json')
mkdirSync(resolve(root, '.output/public'), { recursive: true })
writeFileSync(output, JSON.stringify({ commit, sourceFingerprint: hash.digest('hex'), builtAt: new Date().toISOString() }, null, 2) + '\n')
console.log(`Build source: ${commit.slice(0, 12)}`)
