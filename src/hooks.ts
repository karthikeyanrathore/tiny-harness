/**
 * Hook bus. Listeners run in registration order; each may return a replacement
 * value (a waterfall) or nothing to pass the current value on unchanged.
 */
import type { LlmRequest, ToolCall } from './llm.ts'
import type { TurnEndReason } from './log.ts'
import type { ToolResult } from './tools.ts'

export type HookMap = {
  /** The request about to be sent to the model. */
  'request': LlmRequest
  /** A tool call the model chose; set `allow: false` to block it. */
  'pre-execute': { call: ToolCall; allow: boolean; reason?: string }
  /** A tool result before it is logged and shown to the model. */
  'post-execute': { call: ToolCall; result: ToolResult }
  /** A finished turn. */
  'turn-end': { turn: number; reason: TurnEndReason; steps: number; toolCalls: number }
}

type Listener<K extends keyof HookMap> = (value: HookMap[K]) => HookMap[K] | void | Promise<HookMap[K] | void>

export class Hooks {
  private readonly listeners: { [K in keyof HookMap]?: Listener<K>[] } = {}

  /** Add a listener; returns a function that removes it again. */
  on<K extends keyof HookMap>(name: K, listener: Listener<K>): () => void {
    const list: Listener<K>[] = this.listeners[name] ??= []
    list.push(listener)
    return () => { list.splice(list.indexOf(listener), 1) }
  }

  async run<K extends keyof HookMap>(name: K, value: HookMap[K]): Promise<HookMap[K]> {
    const list: Listener<K>[] = this.listeners[name] ?? []
    for (const listener of [...list]) {
      const replacement = await listener(value)
      if (replacement !== undefined) value = replacement
    }
    return value
  }
}
