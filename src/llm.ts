/**
 * The model seam: the loop sends an LlmRequest and gets an LlmReply back.
 * OpenAiCompatibleLlm implements `Llm` over HTTP (Ollama, DeepSeek, ...).
 */

export type ToolCall = { id: string; name: string; args: unknown }

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError: boolean }

export type JsonSchema = {
  type: 'object'
  properties: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string }>
  required?: string[]
}

/** What the model sees about a tool: never its implementation. */
export type ToolSchema = { name: string; description: string; parameters: JsonSchema }

export type LlmRequest = { model: string; system: string; messages: Message[]; tools: ToolSchema[] }

export type LlmReply = { content: string; toolCalls: ToolCall[] }

export interface Llm {
  call(request: LlmRequest): Promise<LlmReply>
}

/** Wire format of an OpenAI-compatible `/chat/completions` reply (only the fields used). */
type WireReply = {
  choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: unknown } }[] } }[]
}

/**
 * Any OpenAI-compatible chat completions server: Ollama, vLLM, LM Studio,
 * DeepSeek's API, ... The model sees exactly `request.tools` and the history.
 */
export class OpenAiCompatibleLlm implements Llm {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
  }

  async call(request: LlmRequest): Promise<LlmReply> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.apiKey === undefined ? {} : { authorization: `Bearer ${this.apiKey}` } },
      body: JSON.stringify(toWire(request)),
      signal: AbortSignal.timeout(300_000),
    })
    if (!response.ok) throw new Error(`model request failed (${response.status}): ${await response.text()}`)
    const message = ((await response.json()) as WireReply).choices[0]?.message
    if (message === undefined) throw new Error('model reply has no choices')
    return {
      content: message.content ?? '',
      toolCalls: (message.tool_calls ?? []).map(call => ({ id: call.id, name: call.function.name, args: parseArguments(call.function.arguments) })),
    }
  }
}

/** Translate the harness request into the OpenAI chat completions body. */
export function toWire(request: LlmRequest) {
  return {
    model: request.model,
    stream: false,
    messages: [
      ...request.system === '' ? [] : [{ role: 'system', content: request.system }],
      ...request.messages.map(message => {
        switch (message.role) {
          case 'user': return { role: 'user', content: message.content }
          case 'assistant': return {
            role: 'assistant',
            content: message.content,
            ...message.toolCalls.length === 0 ? {} : {
              tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })),
            },
          }
          case 'tool': return { role: 'tool', tool_call_id: message.toolCallId, content: message.isError ? `Error: ${message.content}` : message.content }
        }
      }),
    ],
    ...request.tools.length === 0 ? {} : { tools: request.tools.map(tool => ({ type: 'function', function: tool })) },
  }
}

/** Arguments arrive as a JSON string; unparseable text is passed on so the registry reports it to the model. */
function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
