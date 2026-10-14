import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { builtinTools, currentDirectory } from '../src/builtin.ts'
import { Hooks } from '../src/hooks.ts'
import { OpenAiCompatibleLlm, toWire } from '../src/llm.ts'
import type { Llm, LlmReply, LlmRequest } from '../src/llm.ts'
import { Session } from '../src/log.ts'
import type { LogEntry } from '../src/log.ts'
import { runTurn } from '../src/loop.ts'
import { approval, stats, truncate } from '../src/plugins.ts'
import { ToolRegistry } from '../src/tools.ts'

/** Replays a fixed list of replies and records every request it receives. */
class ScriptedLlm implements Llm {
  readonly requests: LlmRequest[] = []
  private readonly replies: LlmReply[]

  constructor(replies: LlmReply[]) {
    this.replies = [...replies]
  }

  async call(request: LlmRequest): Promise<LlmReply> {
    this.requests.push(request)
    const reply = this.replies.shift()
    if (reply === undefined) throw new Error('ScriptedLlm ran out of replies')
    return reply
  }
}

let callCount = 0

/** A reply that calls one tool. */
function use(name: string, args: Record<string, unknown>): LlmReply {
  return { content: '', toolCalls: [{ id: `c${++callCount}`, name, args }] }
}

/** A final text reply. */
function say(content: string): LlmReply {
  return { content, toolCalls: [] }
}

/** The content of the last tool result in the log. */
function lastResult(session: Session) {
  const entry = session.entries.findLast(entry => entry.type === 'tool_result')
  return entry?.type === 'tool_result' ? entry : undefined
}

/** A fresh agent over a temp directory holding a.txt and b.md. */
function setup(llm: Llm = new ScriptedLlm([])) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tiny-harness-')))
  writeFileSync(join(dir, 'a.txt'), 'hello')
  writeFileSync(join(dir, 'b.md'), '# b')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'loop.ts'), 'loop')
  const session = new Session(join(dir, 'sessions', 's.jsonl'))
  const tools = new ToolRegistry()
  for (const tool of builtinTools(dir, session)) tools.register(tool)
  const hooks = new Hooks()
  const agent = { llm, model: 'test', system: ['test'], tools, hooks, session, maxSteps: 5 }
  return { dir, tools, hooks, session, agent }
}

function types(entries: LogEntry[]) {
  return entries.map(entry => entry.type)
}

describe('1. OpenAI-compatible adapter', () => {
  /** Serve one canned reply and capture the request body. */
  async function serve(reply: unknown, status = 200) {
    const received: { body?: unknown; auth?: string } = {}
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', chunk => { data += chunk })
      req.on('end', () => {
        received.body = JSON.parse(data)
        received.auth = req.headers.authorization
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(reply))
      })
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    return { url: `http://127.0.0.1:${port}/v1/`, received, close: () => server.close() }
  }

  test('sends system, history and tools in the chat completions format', () => {
    const wire = toWire({
      model: 'm',
      system: 'sys',
      messages: [
        { role: 'user', content: 'list' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_dir', args: { path: '.' } }] },
        { role: 'tool', toolCallId: 'c1', name: 'list_dir', content: 'denied', isError: true },
      ],
      tools: [{ name: 'list_dir', description: 'd', parameters: { type: 'object', properties: {} } }],
    })
    assert.deepEqual(wire, {
      model: 'm',
      stream: false,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'list' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'Error: denied' },
      ],
      tools: [{ type: 'function', function: { name: 'list_dir', description: 'd', parameters: { type: 'object', properties: {} } } }],
    })
  })

  test('parses tool calls, keeping unparseable arguments for the registry to reject', async () => {
    const server = await serve({ choices: [{ message: { content: null, tool_calls: [
      { id: 'a', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
      { id: 'b', function: { name: 'read_file', arguments: '{oops' } },
    ] } }] })
    try {
      const reply = await new OpenAiCompatibleLlm(server.url, 'k').call({ model: 'm', system: '', messages: [], tools: [] })
      assert.deepEqual(reply, { content: '', toolCalls: [
        { id: 'a', name: 'read_file', args: { path: 'a.txt' } },
        { id: 'b', name: 'read_file', args: '{oops' },
      ] })
      assert.equal(server.received.auth, 'Bearer k')
      assert.equal((server.received.body as { model: string }).model, 'm')
    } finally {
      server.close()
    }
  })

  test('an HTTP error fails the call with the server message', async () => {
    const server = await serve({ error: 'model "x" not found' }, 404)
    try {
      await assert.rejects(new OpenAiCompatibleLlm(server.url).call({ model: 'x', system: '', messages: [], tools: [] }), /404.*not found/)
    } finally {
      server.close()
    }
  })
})

describe('2. tool registry', () => {
  test('schemas carry only name, description and parameters', () => {
    const { tools } = setup()
    for (const schema of tools.schemas()) assert.deepEqual(Object.keys(schema), ['name', 'description', 'parameters'])
    assert.deepEqual(tools.schemas().map(s => s.name), ['bash', 'fetch_url', 'list_dir', 'read_file', 'write_file'])
  })

  test('bad calls become error results instead of throwing', async () => {
    const { tools } = setup()
    assert.match((await tools.execute({ id: '1', name: 'nope', args: {} })).content, /unknown tool "nope"/)
    assert.match((await tools.execute({ id: '2', name: 'read_file', args: {} })).content, /missing required argument "path"/)
    assert.match((await tools.execute({ id: '3', name: 'read_file', args: { path: 7 } })).content, /must be a string/)
    assert.match((await tools.execute({ id: '4', name: 'read_file', args: '{bad json' })).content, /must be a JSON object/)
    const missing = await tools.execute({ id: '5', name: 'read_file', args: { path: 'missing.txt' } })
    assert.equal(missing.isError, true)
    assert.match(missing.content, /ENOENT/)
  })

  test('fetch_url returns page text without markup, and reports HTTP errors', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><head><style>p{}</style><script>x()</script></head><body><h1>Title</h1><p>Fish &amp; chips</p></body></html>')
      } else {
        res.writeHead(404).end()
      }
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const { tools } = setup()
      assert.deepEqual(await tools.execute({ id: '1', name: 'fetch_url', args: { url: `${base}/page` } }), { content: 'Title\nFish & chips', isError: false })
      assert.deepEqual(await tools.execute({ id: '2', name: 'fetch_url', args: { url: `${base}/missing` } }), { content: 'HTTP 404 Not Found', isError: true })
    } finally {
      server.close()
    }
  })

  test('fetch_url refuses non-http URLs', async () => {
    const { tools } = setup()
    const result = await tools.execute({ id: '1', name: 'fetch_url', args: { url: 'file:///etc/passwd' } })
    assert.deepEqual(result, { content: 'only http and https URLs are supported, got file:', isError: true })
  })

  test('register returns a disposer', () => {
    const { tools } = setup()
    const dispose = tools.register({ name: 'extra', description: 'x', parameters: { type: 'object', properties: {} }, execute: async () => '' })
    assert.ok(tools.schemas().some(s => s.name === 'extra'))
    dispose()
    assert.ok(!tools.schemas().some(s => s.name === 'extra'))
  })
})

describe('3. agent loop', () => {
  test('a tool call, then a final answer', async () => {
    const { agent, session } = setup(new ScriptedLlm([use('list_dir', { path: '.' }), say('two files')]))
    assert.equal(await runTurn(agent, 'what files are in this folder?'), 'two files')
    assert.equal(lastResult(session)?.content, 'a.txt\nb.md\nsessions/\nsrc/')
    assert.deepEqual(types(session.entries), ['turn_start', 'user', 'assistant', 'tool_result', 'assistant', 'turn_end'])
  })

  test('each step sends the history derived from the log', async () => {
    const llm = new ScriptedLlm([
      { content: '', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.txt' } }] },
      { content: 'it says hello', toolCalls: [] },
    ])
    const { agent } = setup(llm)
    assert.equal(await runTurn(agent, 'read a.txt'), 'it says hello')
    assert.equal(llm.requests.length, 2)
    assert.deepEqual(llm.requests[1]?.messages.at(-1), { role: 'tool', toolCallId: 'c1', name: 'read_file', content: 'hello', isError: false })
  })

  test('stops at maxSteps when the model never finishes', async () => {
    const loop = Array.from({ length: 5 }, (_, i) => ({ content: '', toolCalls: [{ id: `c${i}`, name: 'list_dir', args: { path: '.' } }] }))
    const { agent, session } = setup(new ScriptedLlm(loop))
    assert.match(await runTurn(agent, 'go'), /stopped after 5 steps/)
    assert.deepEqual(session.entries.at(-1), { type: 'turn_end', turn: 1, reason: 'step_limit' })
  })

  test('a failing model call ends the turn with an error', async () => {
    const llm = new ScriptedLlm([{ content: '', toolCalls: [{ id: 'c1', name: 'list_dir', args: { path: '.' } }] }])
    const { agent, session } = setup(llm)
    await assert.rejects(runTurn(agent, 'go'), /ran out of replies/)
    assert.deepEqual(session.entries.at(-1), { type: 'turn_end', turn: 1, reason: 'error' })
  })
})

describe('4. the log is the source of truth', () => {
  test('a reopened session sends the earlier conversation to the model', async () => {
    const { agent, session } = setup(new ScriptedLlm([use('list_dir', { path: '.' }), say('two files')]))
    await runTurn(agent, 'what files are in this folder?')
    const reopened = new Session(session.path)
    assert.deepEqual(reopened.deriveMessages(), session.deriveMessages())
    const llm = new ScriptedLlm([say('you asked about files')])
    await runTurn({ ...agent, llm, session: reopened }, 'what did I ask you before?')
    assert.deepEqual(llm.requests[0]?.messages.map(message => message.role), ['user', 'assistant', 'tool', 'assistant', 'user'])
    assert.deepEqual(llm.requests[0]?.messages[0], { role: 'user', content: 'what files are in this folder?' })
    assert.equal(reopened.turns, 2)
  })

  test('a turn cut off by a crash is closed on reopen', () => {
    const { session } = setup()
    session.append({ type: 'turn_start', turn: 1 })
    session.append({ type: 'user', content: 'go' })
    session.append({ type: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'bash', args: { command: 'sleep 99' } }] })
    const reopened = new Session(session.path)
    assert.deepEqual(types(reopened.entries).slice(-2), ['tool_result', 'turn_end'])
    assert.deepEqual(reopened.entries.at(-1), { type: 'turn_end', turn: 1, reason: 'interrupted' })
    const fileLines = readFileSync(session.path, 'utf8').trim().split('\n')
    assert.equal(fileLines.length, reopened.entries.length)
  })

  test('a log written elsewhere is read back as-is', () => {
    const { session } = setup()
    appendFileSync(session.path, `${JSON.stringify({ type: 'turn_start', turn: 1 })}\n${JSON.stringify({ type: 'turn_end', turn: 1, reason: 'completed' })}\n`)
    assert.equal(new Session(session.path).turns, 1)
  })
})

describe('4b. working directory', () => {
  test('a cd carries over to later bash calls and to the file tools', async () => {
    const { tools, dir } = setup()
    await tools.execute({ id: '1', name: 'bash', args: { command: 'cd src' } })
    assert.equal((await tools.execute({ id: '2', name: 'bash', args: { command: 'pwd' } })).content, `exit code: 0\n${dir}/src\n`)
    assert.equal((await tools.execute({ id: '3', name: 'bash', args: { command: 'ls loop.ts' } })).content, 'exit code: 0\nloop.ts\n')
    assert.equal((await tools.execute({ id: '4', name: 'read_file', args: { path: 'loop.ts' } })).content, 'loop')
    await tools.execute({ id: '5', name: 'write_file', args: { path: 'new.txt', content: 'x' } })
    assert.equal(readFileSync(join(dir, 'src', 'new.txt'), 'utf8'), 'x')
  })

  test('a cd outside the project is not kept, and the model is told why', async () => {
    const { tools, session, dir } = setup()
    const result = await tools.execute({ id: '1', name: 'bash', args: { command: 'cd .. && pwd' } })
    assert.match(result.content, /note: the move to .* was not kept; tools stay in /)
    assert.equal(session.cwd, undefined)
    assert.equal((await tools.execute({ id: '2', name: 'bash', args: { command: 'pwd' } })).content, `exit code: 0\n${dir}\n`)
  })

  test('exit codes and output are unchanged by the folder tracking', async () => {
    const { tools } = setup()
    assert.equal((await tools.execute({ id: '1', name: 'bash', args: { command: 'printf no-newline; exit 3' } })).content, 'exit code: 3\nno-newline')
    assert.equal((await tools.execute({ id: '2', name: 'bash', args: { command: 'false' } })).content, 'exit code: 1\n')
  })

  test('a resumed session keeps the folder', async () => {
    const { tools, session, dir } = setup()
    await tools.execute({ id: '1', name: 'bash', args: { command: 'cd src' } })
    assert.equal(new Session(session.path).cwd, `${dir}/src`)
  })

  test('the model is told the folder once, and again only when it changes', async () => {
    const llm = new ScriptedLlm([use('bash', { command: 'pwd' }), use('bash', { command: 'cd src' }), say('done')])
    const { agent, session, dir } = setup(llm)
    await runTurn({ ...agent, context: () => `Current directory: ${currentDirectory(session, dir)}` }, 'go')
    const contexts = (step: number) => llm.requests[step]?.messages.filter(m => m.role === 'user' && m.content.startsWith('Current directory:')).map(m => m.role === 'user' ? m.content : '')
    assert.deepEqual(contexts(0), [`Current directory: ${dir}`])
    assert.deepEqual(contexts(1), [`Current directory: ${dir}`])
    assert.deepEqual(contexts(2), [`Current directory: ${dir}`, `Current directory: ${dir}/src`])
    assert.equal(llm.requests[2]?.messages.at(-1)?.role, 'user')
  })
})

describe('5. hooks and plugins', () => {
  test('a declined bash call reaches the model as denied, and the turn completes', async () => {
    const llm = new ScriptedLlm([use('bash', { command: 'echo hi' }), say('ok, not running it')])
    const { agent, hooks, session } = setup(llm)
    const asked: string[] = []
    approval(hooks, async question => { asked.push(question); return false }, ['bash'])
    assert.equal(await runTurn(agent, 'run echo hi'), 'ok, not running it')
    assert.deepEqual(asked, ['Allow bash {"command":"echo hi"}? [y/N] '])
    assert.deepEqual(llm.requests[1]?.messages.at(-1), { role: 'tool', toolCallId: `c${callCount}`, name: 'bash', content: 'denied: the user declined this call', isError: true })
    assert.equal(session.entries.at(-1)?.type, 'turn_end')
  })

  test('an approved bash call runs', async () => {
    const { agent, hooks, session } = setup(new ScriptedLlm([use('bash', { command: 'echo hi' }), say('done')]))
    approval(hooks, async () => true, ['bash'])
    await runTurn(agent, 'run echo hi')
    assert.equal(lastResult(session)?.content, 'exit code: 0\nhi\n')
  })

  test('approval ignores tools it was not given', async () => {
    const { agent, hooks, session } = setup(new ScriptedLlm([use('read_file', { path: 'a.txt' }), say('done')]))
    approval(hooks, async () => { throw new Error('should not ask') }, ['bash'])
    await runTurn(agent, 'read a.txt')
    assert.equal(lastResult(session)?.content, 'hello')
  })

  test('truncate cuts long results before they are logged', async () => {
    const { agent, hooks, session } = setup(new ScriptedLlm([use('read_file', { path: 'a.txt' }), say('done')]))
    truncate(hooks, 3)
    await runTurn(agent, 'read a.txt')
    assert.equal(lastResult(session)?.content, 'hel\n… [truncated 2 characters]')
  })

  test('stats reports each turn', async () => {
    const { agent, hooks } = setup(new ScriptedLlm([use('list_dir', { path: '.' }), say('files'), say('hello')]))
    const lines: string[] = []
    stats(hooks, line => lines.push(line))
    await runTurn(agent, 'list files')
    await runTurn(agent, 'hi')
    assert.deepEqual(lines, ['[turn 1: completed, 2 step(s), 1 tool call(s)]', '[turn 2: completed, 1 step(s), 0 tool call(s)]'])
  })

  test('a request hook can hide a tool from the model', async () => {
    const llm = new ScriptedLlm([say('no tool for that')])
    const { agent, hooks } = setup(llm)
    hooks.on('request', request => ({ ...request, tools: request.tools.filter(tool => tool.name !== 'list_dir') }))
    await runTurn(agent, 'list files')
    assert.deepEqual(llm.requests[0]?.tools.map(tool => tool.name), ['bash', 'fetch_url', 'read_file', 'write_file'])
  })

  test('a disposed listener stops running', async () => {
    const { agent, hooks } = setup(new ScriptedLlm([say('hello')]))
    const lines: string[] = []
    const dispose = stats(hooks, line => lines.push(line))
    dispose()
    await runTurn(agent, 'hi')
    assert.deepEqual(lines, [])
  })
})
