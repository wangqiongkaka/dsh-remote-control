import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { computerFiles, type ComputerDirectory } from '../dist/remote-files.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})
let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); vi.clearAllMocks() })
const request = (path: string, extra: Record<string, string> = {}) =>
  new Request('http://localhost/api/remote-control/files?' + new URLSearchParams({ path, ...extra }))

it('browses outside a workspace and quotes absolute file references, with navigable symlinks', async () => {
  directory = await mkdtemp(join(tmpdir(), 'computer-files-'))
  await mkdir(join(directory, 'workspace'))
  await mkdir(join(directory, 'downloads'))
  await writeFile(join(directory, 'report notes.txt'), 'private content')
  await writeFile(join(directory, '.hidden'), 'hidden')
  if (process.platform !== 'win32') {
    await writeFile(join(directory, 'bad"name'), '')
    await symlink(join(directory, 'downloads'), join(directory, 'linked'))
    await symlink(join(directory, 'gone'), join(directory, 'broken'))
  }
  const response = await computerFiles(request(directory))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const listing = await response.json() as ComputerDirectory
  expect(listing.parent).toBe(dirname(directory))
  expect(listing.entries).toContainEqual({ name: 'report notes.txt', path: join(directory, 'report notes.txt'),
    directory: false, mention: `@"${join(directory, 'report notes.txt').replaceAll('\\', '/')}"` })
  expect(JSON.stringify(listing)).not.toContain('private content')
  expect(listing.entries.some(entry => entry.name === '.hidden')).toBe(true)
  const workspace = await (await computerFiles(request(join(directory, 'workspace')))).json() as ComputerDirectory
  expect(workspace.parent).toBe(directory)
  if (process.platform !== 'win32') {
    expect(listing.entries.find(entry => entry.name === 'linked')?.directory).toBe(true)
    expect(listing.entries.find(entry => entry.name === 'bad"name')?.mention).toBeNull()
    expect(listing.entries.some(entry => entry.name === 'broken')).toBe(false)
  }
})

it('filters before paging so files beyond the first page remain selectable', async () => {
  directory = await mkdtemp(join(tmpdir(), 'computer-files-'))
  await Promise.all(Array.from({ length: 205 }, (_, index) => writeFile(join(directory!, `file-${String(index).padStart(3, '0')}`), '')))
  const first = await (await computerFiles(request(directory))).json() as ComputerDirectory
  const second = await (await computerFiles(request(directory, { offset: '200' }))).json() as ComputerDirectory
  expect(first.entries).toHaveLength(200)
  expect(first.next).toBe(200)
  expect(second.entries).toHaveLength(5)
  expect(second.next).toBeNull()
  expect(new Set([...first.entries, ...second.entries].map(file => file.path)).size).toBe(205)
  const filtered = await (await computerFiles(request(directory, { query: 'FILE-204' }))).json() as ComputerDirectory
  expect(filtered.entries.map(entry => entry.name)).toEqual(['file-204'])
})

it('hides dot directories before paging, including directory symlinks, without blocking direct navigation', async () => {
  directory = await mkdtemp(join(tmpdir(), 'computer-files-'))
  await Promise.all(Array.from({ length: 201 }, (_, index) => mkdir(join(directory!, `.folder-${index}`))))
  await mkdir(join(directory, 'project'))
  await writeFile(join(directory, '.notes'), '')
  if (process.platform !== 'win32') await symlink(join(directory, 'project'), join(directory, '.linked'))
  const hidden = await (await computerFiles(request(directory, { showHiddenDirectories: 'false' }))).json() as ComputerDirectory
  expect(hidden.entries.map(entry => entry.name)).toEqual(['project', '.notes'])
  expect(hidden.next).toBeNull()
  const shown = await (await computerFiles(request(directory, { showHiddenDirectories: 'true' }))).json() as ComputerDirectory
  expect(shown.entries).toHaveLength(200)
  expect(shown.next).toBe(200)
  const inside = await (await computerFiles(request(join(directory, '.folder-0'), { showHiddenDirectories: 'false' }))).json() as ComputerDirectory
  expect(inside.path).toBe(join(directory, '.folder-0'))
  expect(inside.entries).toEqual([])
})

it('rejects invalid inputs and reports unreadable or missing directories without falling back', async () => {
  expect((await computerFiles(request('relative'))).status).toBe(400)
  expect((await computerFiles(request(tmpdir(), { offset: '-1' }))).status).toBe(400)
  expect((await computerFiles(request(tmpdir(), { offset: 'NaN' }))).status).toBe(400)
  expect((await computerFiles(request(join(tmpdir(), 'missing-' + crypto.randomUUID())))).status).toBe(404)
  vi.mocked(readdir).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  const denied = await computerFiles(request(tmpdir()))
  expect(denied.status).toBe(403)
  expect(await denied.text()).toBe('没有权限读取此目录')
})
