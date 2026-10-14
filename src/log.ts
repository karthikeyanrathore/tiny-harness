/**
 * Append-only session log (one JSON object per line). It is the only source
 * of model history: `deriveMessages()` rebuilds the conversation from it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Message, ToolCall } from './llm.ts'

export type TurnEndReason = 'completed' | 'step_limit' | 'error' | 'interrupted'

export type LogEntry =
  | { type: 'turn_start'; turn: number }
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { type: 'tool_result'; toolCallId: string; name: string; content: string; isError: boolean }
  | { type: 'turn_end'; turn: number; reason: TurnEndReason }
  /** The working directory changed; the latest one is current. */
  | { type: 'cwd'; path: string }
  /** Runtime facts shown to the model as a user message, e.g. the current directory. */
  | { type: 'context'; content: string }

export class Session {
  readonly entries: LogEntry[]
  readonly path: string

  /** Open the log at `path`, creating it on first append. A turn cut off by a crash is closed as interrupted. */
  constructor(path: string) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true })
    this.entries = existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as LogEntry)
      : []
    const lastStart = this.entries.findLast(entry => entry.type === 'turn_start')
    if (lastStart !== undefined && this.entries.at(-1)?.type !== 'turn_end') {
      this.closeOpenCalls('the session was interrupted before this call finished')
      this.append({ type: 'turn_end', turn: lastStart.turn, reason: 'interrupted' })
    }
  }

  /** Write to disk first, then to memory, so memory never holds an entry the file lacks. */
  append(entry: LogEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`)
    this.entries.push(entry)
  }

  /** The latest recorded working directory, or undefined if it never changed. */
  get cwd(): string | undefined {
    const entry = this.entries.findLast(entry => entry.type === 'cwd')
    return entry?.type === 'cwd' ? entry.path : undefined
  }

  /** The runtime context the model was last shown. */
  get context(): string | undefined {
    const entry = this.entries.findLast(entry => entry.type === 'context')
    return entry?.type === 'context' ? entry.content : undefined
  }

  get turns(): number {
    return this.entries.filter(entry => entry.type === 'turn_start').length
  }

  /** Record an error result for every tool call that has none, keeping the history valid for a model. */
  closeOpenCalls(reason: string): void {
    const answered = new Set(this.entries.flatMap(entry => entry.type === 'tool_result' ? [entry.toolCallId] : []))
    for (const entry of this.entries.filter(entry => entry.type === 'assistant')) {
      for (const call of entry.toolCalls) {
        if (!answered.has(call.id)) {
          this.append({ type: 'tool_result', toolCallId: call.id, name: call.name, content: reason, isError: true })
        }
      }
    }
  }

  deriveMessages(): Message[] {
    return this.entries.flatMap((entry): Message[] => {
      switch (entry.type) {
        case 'user':
        case 'context': return [{ role: 'user', content: entry.content }]
        case 'assistant': return [{ role: 'assistant', content: entry.content, toolCalls: entry.toolCalls }]
        case 'tool_result': return [{ role: 'tool', toolCallId: entry.toolCallId, name: entry.name, content: entry.content, isError: entry.isError }]
        case 'turn_start':
        case 'turn_end':
        case 'cwd': return []
      }
    })
  }
}
