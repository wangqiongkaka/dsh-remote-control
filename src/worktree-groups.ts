import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Only registered checkouts are grouped; names and directory prefixes never establish ownership. */
export async function worktreeParents(workspaces: readonly { id: string; path: string }[], signal?: AbortSignal): Promise<Record<string, string>> {
  const roots = new Map<string, string>()
  for (const workspace of workspaces) {
    signal?.throwIfAborted()
    if (roots.has(workspace.path)) continue
    try {
      const { stdout } = await exec('git', ['-C', workspace.path, 'worktree', 'list', '--porcelain', '-z'], {
        timeout: 3_000, maxBuffer: 2 * 1024 * 1024, ...(signal ? { signal } : {}),
      })
      const paths = stdout.split('\0').filter(field => field.startsWith('worktree ')).map(field => field.slice(9))
      if (paths[0]) for (const path of paths) roots.set(resolve(path), resolve(paths[0]))
    } catch {
      signal?.throwIfAborted()
      // Missing Git, unreadable paths and non-repositories retain the ordinary workspace rows.
    }
  }
  const ids = new Map(workspaces.map(workspace => [workspace.path, workspace.id]))
  return Object.fromEntries(workspaces.flatMap(workspace => {
    const root = roots.get(workspace.path)
    const parent = root === undefined ? undefined : ids.get(root)
    return parent !== undefined && parent !== workspace.id ? [[workspace.id, parent]] : []
  }))
}
