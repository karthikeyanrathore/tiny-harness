/**
 * Built-in tools. All of them work in the session's current directory, which
 * starts at `root`. A `cd` inside bash moves it, but only to folders inside `root`.
 */
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Session } from './log.ts'
import type { ToolDefinition } from './tools.ts'

/** Printed after each bash command so the harness learns the folder the shell ended in. */
const CWD_MARK = '__TINY_HARNESS_CWD__'

/** The calendar script; it runs in the project folder, where credentials.json and token.json live. */
const GCAL_SCRIPT = fileURLToPath(new URL('../scripts/gcal_tool.py', import.meta.url))
/** The project venv's Python, which has the Google client libraries installed. */
const GCAL_PYTHON = fileURLToPath(new URL('../.venv/bin/python3', import.meta.url))
const PROJECT_DIR = fileURLToPath(new URL('..', import.meta.url))

/** The folder every tool works in: the last one recorded in the log, else `root`. */
export function currentDirectory(session: Session, root: string): string {
  return session.cwd ?? realpathSync(root)
}

/** How the calendar tools run their script: the program, the script it runs, and the folder to run it in. */
export type CalendarCommand = { python: string; script: string; cwd: string }

export function builtinTools(root: string, session: Session, calendar: CalendarCommand = { python: GCAL_PYTHON, script: GCAL_SCRIPT, cwd: PROJECT_DIR }): ToolDefinition[] {
  root = realpathSync(root)
  const cwd = () => currentDirectory(session, root)

  /** Record the folder a command ended in, or explain why it was not kept. */
  function moveTo(path: string): string {
    if (path === cwd()) return ''
    const rel = relative(root, path)
    if (isAbsolute(rel) || rel.split(sep)[0] === '..') {
      return `\nnote: the move to ${path} was not kept; tools stay in ${cwd()} because only folders inside ${root} are allowed`
    }
    session.append({ type: 'cwd', path })
    return ''
  }

  return [
    {
      name: 'list_dir',
      description: 'List the entries of a directory. Directories end with "/".',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] },
      async execute({ path }) {
        const entries = await readdir(resolve(cwd(), path as string), { withFileTypes: true })
        return entries.map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name).sort().join('\n') || '(empty)'
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] },
      async execute({ path }) {
        return readFile(resolve(cwd(), path as string), 'utf8')
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
        await writeFile(resolve(cwd(), path as string), content as string)
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
      description: 'Run a shell command and return its exit code and output. A `cd` carries over to later calls and to the other tools.',
      parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command' } }, required: ['command'] },
      execute({ command }) {
        return new Promise(done => {
          const script = `${command as string}\n__rc=$?\nprintf '\\n${CWD_MARK}%s' "$(pwd -P)"\nexit $__rc`
          execFile('sh', ['-c', script], { cwd: cwd(), timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
            // The mark is missing when the command itself called `exit`; the folder then stays put.
            const at = stdout.lastIndexOf(`\n${CWD_MARK}`)
            const output = at === -1 ? stdout : stdout.slice(0, at)
            const note = at === -1 ? '' : moveTo(stdout.slice(at + CWD_MARK.length + 1))
            done(`exit code: ${code}\n${output}${stderr}${note}`)
          })
        })
      },
    },
    {
      name: 'google_calendar_add_event',
      description: 'Add an event to the primary Google Calendar.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          startTime: { type: 'string', description: 'Start time in RFC 3339 format with the local UTC offset, e.g. 2026-05-19T14:00:00+02:00' },
          endTime: { type: 'string', description: 'End time in RFC 3339 format with the local UTC offset, e.g. 2026-05-19T16:00:00+02:00' },
          description: { type: 'string', description: 'Optional event description' },
        },
        required: ['summary', 'startTime', 'endTime'],
      },
      execute({ summary, startTime, endTime, description }) {
        return gcal(calendar, ['add', summary as string, startTime as string, endTime as string, (description as string | undefined) ?? ''])
      },
    },
    {
      name: 'google_calendar_list_events',
      description: 'List events in the primary Google Calendar between two times, with their ids. Use it to find the id of an event to delete.',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'Start of the range in RFC 3339 format with the local UTC offset, e.g. 2026-05-19T00:00:00+02:00' },
          timeMax: { type: 'string', description: 'End of the range in RFC 3339 format with the local UTC offset, e.g. 2026-05-20T00:00:00+02:00' },
          query: { type: 'string', description: 'Optional text to search for in the events' },
        },
        required: ['timeMin', 'timeMax'],
      },
      execute({ timeMin, timeMax, query }) {
        return gcal(calendar, ['list', timeMin as string, timeMax as string, (query as string | undefined) ?? ''])
      },
    },
    {
      name: 'google_calendar_delete_event',
      description: 'Delete (cancel) an event from the primary Google Calendar by its id, as shown by google_calendar_list_events.',
      parameters: { type: 'object', properties: { eventId: { type: 'string', description: 'Event id' } }, required: ['eventId'] },
      execute({ eventId }) {
        return gcal(calendar, ['delete', eventId as string])
      },
    },
  ]
}

/** Run the calendar script with the given subcommand and arguments; a failure becomes an error result. */
function gcal(calendar: CalendarCommand, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(calendar.python, [calendar.script, ...args], { cwd: calendar.cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error !== null) fail(new Error(`${stdout}${stderr}`.trim() || error.message))
      else done(stdout)
    })
  })
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
