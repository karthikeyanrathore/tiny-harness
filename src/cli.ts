/**
 * REPL. Usage: node src/cli.ts [--resume <session-id>]
 * Talks to an OpenAI-compatible server (default: gemma4:31b-cloud through local Ollama);
 * set LLM_BASE_URL, LLM_MODEL, LLM_API_KEY to change it.
 * Reads prompts (and approval answers) line by line from stdin, so it also works with piped input.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { builtinTools, currentDirectory } from './builtin.ts'
import { Hooks } from './hooks.ts'
import { OpenAiCompatibleLlm } from './llm.ts'
import { Session } from './log.ts'
import { runTurn } from './loop.ts'
import { approval, stats, truncate } from './plugins.ts'
import { ToolRegistry } from './tools.ts'

const resumeAt = process.argv.indexOf('--resume')
const sessionId = resumeAt === -1 ? new Date().toISOString().replace(/[:.]/g, '-') : process.argv[resumeAt + 1]
if (sessionId === undefined) throw new Error('--resume needs a session id')
// The installed package keeps sessions in the user's data folder; a checkout keeps them in the project.
const sessionsDir = process.env.TINY_HARNESS_DATA_DIR === undefined ? fileURLToPath(new URL('../sessions', import.meta.url)) : join(process.env.TINY_HARNESS_DATA_DIR, 'sessions')
const sessionPath = join(sessionsDir, `${sessionId}.jsonl`)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const lines = rl[Symbol.asyncIterator]()
async function readLine(prompt: string, redraw = () => {}): Promise<string | undefined> {
  // readline must know the prompt's last line, or editing (e.g. backspace) redraws the line without it.
  const at = prompt.lastIndexOf('\n') + 1
  process.stdout.write(prompt.slice(0, at))
  rl.setPrompt(prompt.slice(at))
  rl.prompt()
  // Each readline redraw (the prompt itself, then every key) clears everything below the cursor, so put back
  // what lives there: the caller's part and the status line.
  const after = () => { redraw(); if (process.stdout.isTTY) drawStatus() }
  after()
  process.stdin.on('keypress', after)
  const next = await lines.next()
  process.stdin.off('keypress', after)
  return next.done === true ? undefined : next.value
}

const root = process.cwd()
const session = new Session(sessionPath)
const tools = new ToolRegistry()
for (const tool of builtinTools(root, session)) tools.register(tool)
const hooks = new Hooks()
// Bold yellow header in a terminal, so approval prompts stand out from the model's text.
const highlight = (question: string) => process.stdout.isTTY ? question.replace(/^.*/, header => `\x1b[1;33m${header}\x1b[0m`) : question
approval(hooks, async question => /^y(es)?$/i.test((await readLine(highlight(question))) ?? ''), ['bash', 'write_file', 'fetch_url', 'google_calendar_add_event', 'google_calendar_delete_event'])
truncate(hooks, 2000)
stats(hooks, line => console.log(line))

const agent = {
  llm: new OpenAiCompatibleLlm(process.env.LLM_BASE_URL ?? 'http://127.0.0.1:11434/v1', process.env.LLM_API_KEY),
  model: process.env.LLM_MODEL ?? 'gemma4:31b-cloud',
  system: [
    'You are a coding assistant.',
    'Relative paths are resolved against the current directory, which is given in "Current directory:" messages.',
    'Use tools to inspect and change files. Answer briefly.',
  ],
  tools,
  hooks,
  session,
  maxSteps: 10,
  context: () => `Current directory: ${currentDirectory(session, root)}\nCurrent local time: ${new Date().toString()}`,
}

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`
const width = () => process.stdout.columns || 80
const height = () => process.stdout.rows || 24

/** Draw the status line on the terminal's last row, leaving the cursor where it was. */
/** The git branch of the folder the tools work in, or '' outside a repository or on a detached HEAD. */
function gitBranch(): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd: currentDirectory(session, root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** Looked up once per prompt rather than on every key, since drawStatus runs after each keypress. */
let branch = ''

function drawStatus() {
  const branchPart = branch === '' ? '' : ` · branch: ${branch}`
  const status = dim(`  session: ${sessionId}${branchPart} · model: ${agent.model} · "exit" to quit`.slice(0, width()))
  process.stdout.write(`\x1b7\x1b[${height()};1H\x1b[2K${status}\x1b8`)
}

/** Keep the last row for the status line: everything else scrolls in the rows above it. */
function pinStatus() {
  process.stdout.write(`\x1b7\x1b[1;${height() - 1}r\x1b8`)
  drawStatus()
}

/** In a terminal, the prompt sits between two dim rules, like Claude Code's input box. */
async function readPrompt(): Promise<string | undefined> {
  if (!process.stdout.isTTY) return readLine('> ')
  branch = gitBranch()
  const rule = dim('─'.repeat(width()))
  process.stdout.write(`${rule}\n\n${rule}\x1b[1A\r`)
  const input = await readLine('> ', () => process.stdout.write(`\x1b7\x1b[1B\r${rule}\x1b8`))
  process.stdout.write(`\x1b[J${rule}\n`)
  drawStatus()
  return input
}

if (process.stdout.isTTY) {
  // Start at the bottom, like Claude Code: a screenful of new lines moves what was on screen into the
  // scrollback and leaves the cursor on the last blank row of the scroll region.
  process.stdout.write(`${'\n'.repeat(height())}\x1b[1A`)
  pinStatus()
  process.stdout.on('resize', pinStatus)
  // Give the whole screen back to the shell on the way out, even after Ctrl+C or a crash.
  process.on('exit', () => process.stdout.write(`\x1b7\x1b[r\x1b[${height()};1H\x1b[2K\x1b8`))
} else {
  console.log(`session: ${sessionId}  model: ${agent.model}  (type "exit" to quit)`)
}
while (true) {
  const input = await readPrompt()
  if (input === undefined || input.trim() === 'exit') break
  if (input.trim() === '') continue
  console.log(await runTurn(agent, input))
}
process.exit(0)
