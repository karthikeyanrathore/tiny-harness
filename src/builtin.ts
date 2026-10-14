/** Built-in tools. Paths resolve against `root`; bash runs with `root` as its working directory. */
import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ToolDefinition } from './tools.ts'

export function builtinTools(root: string): ToolDefinition[] {
  return [
    {
      name: 'list_dir',
      description: 'List the entries of a directory. Directories end with "/".',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] },
      async execute({ path }) {
        const entries = await readdir(resolve(root, path as string), { withFileTypes: true })
        return entries.map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name).sort().join('\n') || '(empty)'
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] },
      async execute({ path }) {
        return readFile(resolve(root, path as string), 'utf8')
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a UTF-8 text file.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Full file content' } },
        required: ['path', 'content'],
      },
      async execute({ path, content }) {
        await writeFile(resolve(root, path as string), content as string)
        return `wrote ${(content as string).length} characters to ${path}`
      },
    },
    {
      name: 'fetch_url',
      description: 'Fetch a web page over http(s) and return its text content (HTML tags removed).',
      parameters: { type: 'object', properties: { url: { type: 'string', description: 'Absolute http or https URL' } }, required: ['url'] },
      async execute({ url }) {
        const target = new URL(url as string)
        if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error(`only http and https URLs are supported, got ${target.protocol}`)
        const response = await fetch(target, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'tiny-harness' } })
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
        const body = await response.text()
        return /html/i.test(response.headers.get('content-type') ?? '') ? htmlToText(body) : body
      },
    },
    {
      name: 'bash',
      description: 'Run a shell command and return its exit code and output.',
      parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command' } }, required: ['command'] },
      execute({ command }) {
        return new Promise(done => {
          execFile('sh', ['-c', command as string], { cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
            done(`exit code: ${code}\n${stdout}${stderr}`)
          })
        })
      },
    },
  ]
}

/** Crude HTML to text: drop script/style, strip tags, decode common entities, collapse blank space. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}
