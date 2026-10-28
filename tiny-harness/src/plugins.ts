/**
 * Plugins. The built-in ones attach to hooks and return a function that detaches them. Optional ones live in
 * plugins/ (next to src/): each folder with an index.ts is one plugin, whose default export says what it
 * offers right now. Without a plugins/ folder, as in the core package, only the built-in tools exist.
 */
import { existsSync, readdirSync } from 'node:fs'
import type { Hooks } from './hooks.ts'
import type { ToolCall } from './llm.ts'
import type { ToolDefinition } from './tools.ts'

/**
 * What runs without asking ("allow") or never runs ("deny"): bash commands as words, and for any other tool,
 * its name, e.g. "google_calendar_add_event".
 */
export type Rules = { allow: string[]; deny: string[] }

/**
 * Ask before running the named tools; a "no" becomes a denied result the model sees. Calls are first checked
 * against `rules`: a denied one is blocked without asking, an allowed one runs without asking.
 */
export function approval(hooks: Hooks, ask: (question: string) => Promise<boolean>, tools: string[], rules: Rules = { allow: [], deny: [] }, describe: (call: ToolCall) => Promise<Record<string, string>> | undefined = () => undefined): () => void {
  return hooks.on('pre-execute', async (decision) => {
    const { name, args } = decision.call
    if (!decision.allow || !tools.includes(name)) return
    const command = (args as { command?: unknown } | null)?.command
    const verdict = name !== 'bash' ? { deny: rules.deny.find(rule => rule === name), allow: rules.allow.includes(name) }
      : typeof command === 'string' ? checkRules(command, rules) : { allow: false }
    if (verdict.deny !== undefined) return { ...decision, allow: false, reason: `blocked by the rule "${verdict.deny}"` }
    if (verdict.allow) return
    // Extra lines for the prompt, e.g. the event an id stands for. A failed lookup is shown, not hidden.
    const details = await describe(decision.call)?.catch((error: Error) => ({ lookup: `failed: ${error.message}` }))
    const approved = await ask(approvalQuestion(name, details === undefined ? args : { ...(args as object), ...details }))
    if (!approved) return { ...decision, allow: false, reason: 'the user declined this call' }
  })
}

/**
 * Ask before the named file tools reach outside the project. `outside` returns the real path a `path`
 * argument would touch when it is outside, so the user sees where a `../`, absolute path or symlink leads.
 */
export function outsideProject(hooks: Hooks, ask: (question: string) => Promise<boolean>, tools: string[], outside: (path: string) => string | undefined): () => void {
  return hooks.on('pre-execute', async (decision) => {
    const { name, args } = decision.call
    const path = (args as { path?: unknown } | null)?.path
    if (!decision.allow || !tools.includes(name) || typeof path !== 'string') return
    const target = outside(path)
    if (target === undefined) return
    const approved = await ask(approvalQuestion(`${name} outside the project`, { path: target }))
    if (!approved) return { ...decision, allow: false, reason: 'the user declined access outside the project' }
  })
}

/**
 * A command is split into parts at `&&`, `||`, `;`, `|`, `&` and new lines. A deny rule matches when its words
 * appear in a row anywhere in a part. The command is allowed only when every part starts with an allow rule's
 * words and nothing can hide another command or write a file: no `$`, backticks, redirects or brackets.
 * This is a guard against mistakes, not a security boundary: a determined command can get past it.
 */
export function checkRules(command: string, rules: Rules): { deny?: string; allow: boolean } {
  const parts = command.split(/&&|\|\||[;|&\n]/).map(part => part.trim().split(/\s+/).filter(Boolean)).filter(words => words.length > 0)
  const wordsOf = (rule: string) => rule.trim().split(/\s+/)
  const startsAt = (words: string[], rule: string[], at: number) => rule.every((word, i) => words[at + i] === word)
  const deny = rules.deny.find(rule => parts.some(words => words.some((_, at) => startsAt(words, wordsOf(rule), at))))
  if (deny !== undefined) return { deny, allow: false }
  const allow = !/[$`<>(){}\\]/.test(command) && parts.length > 0 && parts.every(words => rules.allow.some(rule => startsAt(words, wordsOf(rule), 0)))
  return { allow }
}

/**
 * The approval prompt: one argument per line, strings unquoted, long values cut to their first lines.
 * Control and bidi characters are shown as escapes, so a value cannot erase or reorder what the user reads.
 */
function approvalQuestion(name: string, args: unknown): string {
  const maxLines = 20
  const raw = typeof args === 'object' && args !== null && !Array.isArray(args) ? Object.entries(args) : [['args', args] as const]
  const entries = raw.map(([key, value]) => [visible(key), value] as const)
  const width = Math.max(...entries.map(([key]) => key.length)) + 3
  const lines = entries.flatMap(([key, value]) => {
    const all = (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)).split('\n')
    const shown = all.length > maxLines ? [...all.slice(0, maxLines), `… ${all.length - maxLines} more lines`] : all
    return shown.map((line, i) => `│ ${(i === 0 ? `${key}:` : '').padEnd(width)}${visible(line)}`)
  })
  return [`┌ Approve ${name}?`, ...lines, '└ [y/N] '].join('\n')
}

/** Replace characters a terminal acts on (ESC, CR, backspace, ...) or that reorder text (bidi) with visible escapes. */
function visible(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]/g, char => {
    const code = char.charCodeAt(0)
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u{${code.toString(16)}}`
  })
}

/** Cut tool output longer than `maxChars` so one result cannot flood the context. */
export function truncate(hooks: Hooks, maxChars: number): () => void {
  return hooks.on('post-execute', ({ call, result }) => {
    if (result.content.length <= maxChars) return
    const cut = result.content.length - maxChars
    return { call, result: { ...result, content: `${result.content.slice(0, maxChars)}\n… [truncated ${cut} characters]` } }
  })
}

/** Report each finished turn. */
export function stats(hooks: Hooks, print: (line: string) => void): () => void {
  return hooks.on('turn-end', ({ turn, reason, steps, toolCalls }) => {
    print(`[turn ${turn}: ${reason}, ${steps} step(s), ${toolCalls} tool call(s)]`)
  })
}

export type Plugin = {
  /** Empty until the plugin is set up, so the model only sees tools that can work. */
  tools: ToolDefinition[]
  /** Tool names that ask the user before running. */
  needsApproval: string[]
  /** Slash commands typed at the prompt, by name without the slash, e.g. 'install-gcal'. */
  commands: Record<string, () => Promise<void>>
  /** By tool name: extra lines the approval prompt shows for a call, looked up from its arguments. */
  describe?: Record<string, (args: Record<string, unknown>) => Promise<Record<string, string>>>
}

/** Load every plugin. Call it again after a command to pick up what that command set up. */
export async function loadPlugins(dir: URL = new URL('../plugins/', import.meta.url)): Promise<Plugin[]> {
  if (!existsSync(dir)) return []
  const plugins: Plugin[] = []
  for (const name of readdirSync(dir).sort()) {
    const index = new URL(`${name}/index.ts`, dir)
    if (!existsSync(index)) continue
    const module = await import(index.href) as { default: () => Plugin }
    plugins.push(module.default())
  }
  return plugins
}
