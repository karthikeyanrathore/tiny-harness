/**
 * Optional add-ons. Each folder in addons/ (next to src/) with an index.ts is one add-on; its default
 * export says what the add-on offers right now. Without an addons/ folder, as in the core package, the
 * harness runs with its built-in tools only.
 */
import { existsSync, readdirSync } from 'node:fs'
import type { ToolDefinition } from './tools.ts'

export type Addon = {
  /** Empty until the add-on is set up, so the model only sees tools that can work. */
  tools: ToolDefinition[]
  /** Tool names that ask the user before running. */
  needsApproval: string[]
  /** Slash commands typed at the prompt, by name without the slash, e.g. 'install-gcal'. */
  commands: Record<string, () => Promise<void>>
}

/** Load every add-on. Call it again after a command to pick up what that command set up. */
export async function loadAddons(dir: URL = new URL('../addons/', import.meta.url)): Promise<Addon[]> {
  if (!existsSync(dir)) return []
  const addons: Addon[] = []
  for (const name of readdirSync(dir).sort()) {
    const index = new URL(`${name}/index.ts`, dir)
    if (!existsSync(index)) continue
    const module = await import(index.href) as { default: () => Addon }
    addons.push(module.default())
  }
  return addons
}
