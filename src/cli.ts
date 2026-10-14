/**
 * REPL. Usage: node src/cli.ts [--resume <session-id>]
 * Talks to an OpenAI-compatible server (default: gemma4:31b-cloud through local Ollama);
 * set LLM_BASE_URL, LLM_MODEL, LLM_API_KEY to change it.
 * Reads prompts (and approval answers) line by line from stdin, so it also works with piped input.
 */
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
const sessionPath = fileURLToPath(new URL(`../sessions/${sessionId}.jsonl`, import.meta.url))

const lines = createInterface({ input: process.stdin, output: process.stdout })[Symbol.asyncIterator]()
async function readLine(prompt: string): Promise<string | undefined> {
  process.stdout.write(prompt)
  const next = await lines.next()
  return next.done === true ? undefined : next.value
}

const root = process.cwd()
const session = new Session(sessionPath)
const tools = new ToolRegistry()
for (const tool of builtinTools(root, session)) tools.register(tool)
const hooks = new Hooks()
approval(hooks, async question => /^y(es)?$/i.test((await readLine(question)) ?? ''), ['bash', 'write_file', 'fetch_url'])
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
  context: () => `Current directory: ${currentDirectory(session, root)}`,
}

console.log(`session: ${sessionId}  model: ${agent.model}  (type "exit" to quit)`)
while (true) {
  const input = await readLine('> ')
  if (input === undefined || input.trim() === 'exit') break
  if (input.trim() === '') continue
  console.log(await runTurn(agent, input))
}
process.exit(0)
