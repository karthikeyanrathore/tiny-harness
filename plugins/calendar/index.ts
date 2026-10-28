/**
 * Google Calendar plugin: add, list and delete events through gcal_tool.py, which needs a Python with the
 * Google libraries. The tools are only offered once that Python exists, so a plugin that was never set up
 * adds nothing to what the model sees. /install-gcal runs the guided setup from the prompt.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from '../../src/plugins.ts'
import type { ToolDefinition } from '../../src/tools.ts'

/** How the tools run their script: the program, the script it runs, and the folder to run it in. */
export type CalendarCommand = { python: string; script: string; cwd: string }

/**
 * Installed: the per-user venv and config folder under the folders the launcher sets.
 * Checkout: the project's .venv, with credentials.json and token.json in the project folder.
 */
function defaultCommand(): CalendarCommand {
  const script = fileURLToPath(new URL('gcal_tool.py', import.meta.url))
  const data = process.env.TINY_HARNESS_DATA_DIR
  const config = process.env.TINY_HARNESS_CONFIG_DIR
  if (data !== undefined && config !== undefined) {
    return { python: join(data, 'calendar', 'venv', 'bin', 'python3'), script, cwd: join(config, 'calendar') }
  }
  const project = fileURLToPath(new URL('../..', import.meta.url))
  return { python: join(project, '.venv', 'bin', 'python3'), script, cwd: project }
}

export default function calendar(command: CalendarCommand = defaultCommand()): Plugin {
  return {
    tools: existsSync(command.python) ? calendarTools(command) : [],
    needsApproval: ['google_calendar_add_event', 'google_calendar_delete_event'],
    commands: { 'install-gcal': install },
    // The id alone says nothing, so the approval prompt also shows the event it stands for.
    describe: { google_calendar_delete_event: async ({ eventId }) => ({ eventId: `${eventId as string}  ${(await gcal(command, ['get', eventId as string])).trim()}` }) },
  }
}

/** Run the guided setup in the terminal; it asks questions, so it gets the terminal to itself. */
function install(): Promise<void> {
  const setup = fileURLToPath(new URL('calendar-setup', import.meta.url))
  return new Promise(done => {
    spawn('bash', [setup], { stdio: 'inherit' })
      .on('error', error => { console.error(`could not run ${setup}: ${error.message}`); done() })
      .on('close', () => done())
  })
}

export function calendarTools(command: CalendarCommand): ToolDefinition[] {
  return [
    {
      name: 'google_calendar_add_event',
      description: 'Add an event to the primary Google Calendar.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          startTime: { type: 'string', description: 'Start time in RFC 3339 format with the local UTC offset, e.g. 2026-05-19T14:00:00+02:00' },
          endTime: { type: 'string', description: 'End time in RFC 3339 format with the local UTC offset, e.g. 2026-05-19T16:00:00+02:00' },
          description: { type: 'string', description: 'Optional event description' },
        },
        required: ['summary', 'startTime', 'endTime'],
      },
      execute({ summary, startTime, endTime, description }) {
        return gcal(command, ['add', summary as string, startTime as string, endTime as string, (description as string | undefined) ?? ''])
      },
    },
    {
      name: 'google_calendar_list_events',
      description: 'List events in the primary Google Calendar between two times, with their ids. Use it to find the id of an event to delete.',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'Start of the range in RFC 3339 format with the local UTC offset, e.g. 2026-05-19T00:00:00+02:00' },
          timeMax: { type: 'string', description: 'End of the range in RFC 3339 format with the local UTC offset, e.g. 2026-05-20T00:00:00+02:00' },
          query: { type: 'string', description: 'Optional text to search for in the events' },
        },
        required: ['timeMin', 'timeMax'],
      },
      execute({ timeMin, timeMax, query }) {
        return gcal(command, ['list', timeMin as string, timeMax as string, (query as string | undefined) ?? ''])
      },
    },
    {
      name: 'google_calendar_delete_event',
      description: 'Delete (cancel) an event from the primary Google Calendar by its id, as shown by google_calendar_list_events.',
      parameters: { type: 'object', properties: { eventId: { type: 'string', description: 'Event id' } }, required: ['eventId'] },
      execute({ eventId }) {
        return gcal(command, ['delete', eventId as string])
      },
    },
  ]
}

/** Run the calendar script with the given subcommand and arguments; a failure becomes an error result. */
function gcal(command: CalendarCommand, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(command.python, [command.script, ...args], { cwd: command.cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      // ENOENT: the Python or the config folder is gone, so the setup is incomplete.
      if (error?.code === 'ENOENT') fail(new Error(`Google Calendar is not set up (${command.python} or ${command.cwd} not found). Run /install-gcal`))
      else if (error !== null) fail(new Error(`${stdout}${stderr}`.trim() || error.message))
      else done(stdout)
    })
  })
}
