/** Built-in plugins. Each attaches to hooks and returns a function that detaches it. */
import type { Hooks } from './hooks.ts'

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
