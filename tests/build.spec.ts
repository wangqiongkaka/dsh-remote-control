import { execFile } from 'node:child_process'
import { watch } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const exec = promisify(execFile)
const bundle = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: { build: string }
}
let directory: string | undefined

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

/** Exercise the real build pipeline's cleanup, with compiler processes isolated from the live plugin. */
async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'dsh-build-'))
  const bin = join(directory, 'bin')
  const lib = join(directory, 'lib')
  await mkdir(bin)
  await mkdir(lib)
  await mkdir(join(directory, 'dist'))
  await writeFile(join(directory, 'dist', 'stale.js'), 'stale')
  await copyFile(bundle, join(lib, 'index.js'))
  for (const [name, body] of [
    ['tsc', "process.exit(Number(process.env.TEST_COMPILER_EXIT ?? 0))"],
    ['tsdown', "const fs = require('node:fs'); fs.mkdirSync('lib', { recursive: true }); fs.copyFileSync(process.env.TEST_BUNDLE, 'lib/index.js')"],
  ]) {
    const binary = join(bin, name!)
    await writeFile(binary, '#!/usr/bin/env node\n' + body + '\n')
    await chmod(binary, 0o700)
  }
  const build = (compilerExit = 0) => exec('/bin/sh', ['-c', manifest.scripts.build], {
    cwd: directory!,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_BUNDLE: bundle,
      TEST_COMPILER_EXIT: String(compilerExit) },
  })
  return { lib, build }
}

it.skipIf(process.platform === 'win32')('keeps the watched lib directory through repeated builds', async () => {
  const { lib, build } = await fixture()
  const original = await stat(lib)
  const watcher = watch(lib)
  try {
    for (let generation = 0; generation < 2; generation++) {
      await build()
      expect((await stat(lib)).ino).toBe(original.ino)
      expect(await readFile(join(lib, 'index.js'), 'utf8')).toBe(await readFile(bundle, 'utf8'))
    }
    await expect(stat(join(directory!, 'dist', 'stale.js'))).rejects.toThrow()
    const changed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The lib watcher no longer receives changes')), 2_000)
      watcher.on('change', (_event, filename) => {
        if (filename === 'index.js') { clearTimeout(timeout); resolve() }
      })
    })
    await writeFile(join(lib, 'index.js'), (await readFile(bundle, 'utf8')) + '\n// next generation\n')
    await changed
  } finally { watcher.close() }
})

it.skipIf(process.platform === 'win32')('retains the current plugin bundle when compilation fails', async () => {
  const { lib, build } = await fixture()
  const original = await stat(lib)
  await expect(build(1)).rejects.toThrow()
  expect((await stat(lib)).ino).toBe(original.ino)
  expect(await readFile(join(lib, 'index.js'), 'utf8')).toBe(await readFile(bundle, 'utf8'))
})
