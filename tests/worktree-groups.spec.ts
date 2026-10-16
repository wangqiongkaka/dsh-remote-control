import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { worktreeParents } from '../dist/worktree-groups.js'

const exec = promisify(execFile)
let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

it('groups real Git worktrees under their registered main directory regardless of names or order', async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'worktree-groups-')))
  const main = join(directory, 'project')
  const child = join(directory, process.platform === 'win32' ? 'unrelated name checkout' : 'unrelated name\ncheckout')
  const lookalike = join(directory, 'project-01')
  const nested = join(main, 'subfolder')
  await mkdir(main)
  await mkdir(lookalike)
  await exec('git', ['init', main])
  await exec('git', ['-C', main, '-c', 'user.name=Check', '-c', 'user.email=check@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'initial'])
  await exec('git', ['-C', main, 'worktree', 'add', '-b', 'feature', child])
  await mkdir(nested)
  const workspaces = [
    { id: 'child', path: child }, { id: 'lookalike', path: lookalike }, { id: 'main', path: main },
    { id: 'nested', path: nested }, { id: 'missing', path: join(directory, 'missing') },
  ]
  expect(await worktreeParents(workspaces)).toEqual({ child: 'main' })
  expect(await worktreeParents(workspaces.filter(workspace => workspace.id !== 'main'))).toEqual({})
  const controller = new AbortController()
  controller.abort()
  await expect(worktreeParents(workspaces, controller.signal)).rejects.toThrow()
})

it('leaves workspaces independent if Git is unavailable', async () => {
  const path = process.env.PATH
  try {
    process.env.PATH = ''
    expect(await worktreeParents([{ id: 'main', path: '/project' }, { id: 'child', path: '/project-01' }])).toEqual({})
  } finally {
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
  }
})
