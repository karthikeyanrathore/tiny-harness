/**
 * The agent loop. A turn handles one user input; each step inside it is one
 * model call plus the tool calls that reply asks for. The turn ends when the
 * model replies without tool calls, or when `maxSteps` is reached.
 */
import type { Hooks } from './hooks.ts'
import type { Llm } from './llm.ts'
import type { Session, TurnEndReason } from './log.ts'
import type { ToolRegistry } from './tools.ts'

export type Agent = {
  llm: Llm
  model: string
  system: string[]
  tools: ToolRegistry
  hooks: Hooks
  session: Session
  maxSteps: number
  /** Runtime facts for the model; a new message is logged only when the text changes. */
  context?: () => string
}

/** Run one turn and return the model's final text. */
export async function runTurn(agent: Agent, input: string): Promise<string> {
  const { llm, tools, hooks, session } = agent
  const turn = session.turns + 1
  session.append({ type: 'turn_start', turn })
  session.append({ type: 'user', content: input })

  let reason: TurnEndReason = 'step_limit'
  let answer = `(stopped after ${agent.maxSteps} steps without a final answer)`
  let steps = 0
  let toolCalls = 0
  try {
    while (steps < agent.maxSteps) {
      steps++
      const context = agent.context?.()
      if (context !== undefined && context !== session.context) session.append({ type: 'context', content: context })
      const request = await hooks.run('request', {
        model: agent.model,
        system: agent.system.join('\n\n'),
        messages: session.deriveMessages(),
        tools: tools.schemas(),
      })
      const reply = await llm.call(request)
      session.append({ type: 'assistant', content: reply.content, toolCalls: reply.toolCalls })
      if (reply.toolCalls.length === 0) {
        reason = 'completed'
        answer = reply.content
        break
      }
      for (const call of reply.toolCalls) {
        toolCalls++
        const decision = await hooks.run('pre-execute', { call, allow: true })
        const raw = decision.allow
          ? await tools.execute(call)
          : { content: `denied: ${decision.reason ?? 'blocked by policy'}`, isError: true }
        const { result } = await hooks.run('post-execute', { call, result: raw })
        session.append({ type: 'tool_result', toolCallId: call.id, name: call.name, ...result })
      }
    }
  } catch (error) {
    reason = 'error'
    session.closeOpenCalls('the step failed before this call finished')
    throw error
  } finally {
    session.append({ type: 'turn_end', turn, reason })
    await hooks.run('turn-end', { turn, reason, steps, toolCalls })
  }
  return answer
}
