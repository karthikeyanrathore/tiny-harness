/** Tool registry: holds definitions, exposes model-facing schemas, runs calls. */
import type { JsonSchema, ToolCall, ToolSchema } from './llm.ts'

export type ToolResult = { content: string; isError: boolean }

export type ToolDefinition = ToolSchema & {
  execute(args: Record<string, unknown>): Promise<string>
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  /** Add a tool; returns a function that removes it again. */
  register(tool: ToolDefinition): () => void {
    if (this.tools.has(tool.name)) throw new Error(`tool "${tool.name}" is already registered`)
    this.tools.set(tool.name, tool)
    return () => { this.tools.delete(tool.name) }
  }

  /** Model-facing schemas, sorted by name. Only these three fields leave the registry. */
  schemas(): ToolSchema[] {
    return [...this.tools.values()]
      .map(({ name, description, parameters }) => ({ name, description, parameters }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Run one call. Never throws: every failure becomes an error result the model can read. */
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name)
    if (tool === undefined) {
      return failure(`unknown tool "${call.name}"; available: ${[...this.tools.keys()].sort().join(', ')}`)
    }
    const problem = validate(tool.parameters, call.args)
    if (problem !== undefined) return failure(problem)
    try {
      return { content: await tool.execute(call.args as Record<string, unknown>), isError: false }
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
  }
}

/** Minimal JSON Schema check: object root, required keys, known keys, scalar types. */
function validate(schema: JsonSchema, args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'arguments must be a JSON object'
  for (const key of schema.required ?? []) {
    if (!(key in args)) return `missing required argument "${key}"`
  }
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key]
    if (property === undefined) return `unknown argument "${key}"`
    if (typeof value !== property.type) return `argument "${key}" must be a ${property.type}`
  }
  return undefined
}

function failure(content: string): ToolResult {
  return { content, isError: true }
}
