/** Built-in plugins. Each attaches to hooks and returns a function that detaches it. */
import type { Hooks } from './hooks.ts'

/** Ask before running the named tools; a "no" becomes a denied result the model sees. */
export function approval(hooks: Hooks, ask: (question: string) => Promise<boolean>, tools: string[]): () => void {
  return hooks.on('pre-execute', async (decision) => {
    if (!decision.allow || !tools.includes(decision.call.name)) return
    const approved = await ask(`Allow ${decision.call.name} ${JSON.stringify(decision.call.args)}? [y/N] `)
    if (!approved) return { ...decision, allow: false, reason: 'the user declined this call' }
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
