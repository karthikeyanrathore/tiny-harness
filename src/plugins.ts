/**
 * Plugins. The built-in ones attach to hooks and return a function that detaches them. Optional ones live in
 * plugins/ (next to src/): each folder with an index.ts is one plugin, whose default export says what it
 * offers right now. Without a plugins/ folder, as in the core package, only the built-in tools exist.
 */
import { existsSync, readdirSync } from 'node:fs'
import type { Hooks } from './hooks.ts'
import type { ToolDefinition } from './tools.ts'

/** Ask before running the named tools; a "no" becomes a denied result the model sees. */
export function approval(hooks: Hooks, ask: (question: string) => Promise<boolean>, tools: string[]): () => void {
  return hooks.on('pre-execute', async (decision) => {
    if (!decision.allow || !tools.includes(decision.call.name)) return
    const approved = await ask(approvalQuestion(decision.call.name, decision.call.args))
    if (!approved) return { ...decision, allow: false, reason: 'the user declined this call' }
  })
}

/** The approval prompt: one argument per line, strings unquoted, long values cut to their first lines. */
function approvalQuestion(name: string, args: unknown): string {
  const maxLines = 20
  const entries = typeof args === 'object' && args !== null && !Array.isArray(args) ? Object.entries(args) : [['args', args] as const]
  const width = Math.max(...entries.map(([key]) => key.length)) + 3
  const lines = entries.flatMap(([key, value]) => {
    const all = (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)).split('\n')
    const shown = all.length > maxLines ? [...all.slice(0, maxLines), `… ${all.length - maxLines} more lines`] : all
    return shown.map((line, i) => `│ ${(i === 0 ? `${key}:` : '').padEnd(width)}${line}`)
  })
  return [`┌ Approve ${name}?`, ...lines, '└ [y/N] '].join('\n')
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
