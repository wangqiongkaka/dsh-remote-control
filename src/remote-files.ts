import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export interface ComputerFile {
  name: string
  path: string
  directory: boolean
  mention: string | null
}

export interface ComputerDirectory {
  path: string
  parent: string
  home: string
  entries: ComputerFile[]
  next: number | null
}

/** Read-only metadata, behind the host's authenticated fetch router and paired proxy. */
export async function computerFiles(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? homedir()
  const offset = Number(url.searchParams.get('offset') ?? '0')
  const query = (url.searchParams.get('query') ?? '').toLocaleLowerCase()
  if (!isAbsolute(path) || path.includes('\0') || !Number.isSafeInteger(offset) || offset < 0) {
    return new Response('Invalid path or offset', { status: 400 })
  }
  try {
    request.signal.throwIfAborted()
    const target = resolve(path)
    // ponytail: one directory in memory; use streamed pagination if huge directories become common.
    const children = await readdir(target, { withFileTypes: true })
    const entries = (await Promise.all(children.filter(child => child.name.toLocaleLowerCase().includes(query))
      .map(async (child): Promise<ComputerFile | null> => {
        const path = join(target, child.name)
        let directory = child.isDirectory()
        if (child.isSymbolicLink()) {
          try {
            const info = await stat(path)
            directory = info.isDirectory()
            if (!directory && !info.isFile()) return null
          } catch { return null }
        } else if (!directory && !child.isFile()) return null
        // Match the host's @file grammar: quotes/control characters are unrepresentable.
        const mentionPath = process.platform === 'win32' ? path.replaceAll('\\', '/') : path
        const mention = /[\u0000-\u001f\u007f-\u009f"]/u.test(mentionPath) ? null
          : /\s/u.test(mentionPath) ? `@"${mentionPath}"` : `@${mentionPath}`
        return { name: child.name, path, directory, mention }
      }))).filter((entry): entry is ComputerFile => entry !== null)
      .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    request.signal.throwIfAborted()
    return Response.json({ path: target, parent: dirname(target), home: homedir(),
      entries: entries.slice(offset, offset + 200), next: offset + 200 < entries.length ? offset + 200 : null,
    } satisfies ComputerDirectory, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return new Response(code === 'EACCES' || code === 'EPERM' ? '没有权限读取此目录'
      : code === 'ENOENT' || code === 'ENOTDIR' ? '目录不存在或不是文件夹' : '无法读取电脑目录',
    { status: code === 'EACCES' || code === 'EPERM' ? 403 : code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 500,
      headers: { 'cache-control': 'no-store' } })
  }
}
