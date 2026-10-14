# TODO

Things to fix in tiny-harness, then features to add to get closer to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). Roughly in order of priority.

## 1. Fix first (known problems)

- [x] **`cd` is forgotten between bash calls.** Each call started a new shell in the project root, so the model thought it had moved when it hadn't. Fixed: the current folder is stored in the log, shared by all tools, and sent to the model when it changes.
- [ ] **The CLI crashes on a model error.** A wrong model name or a network failure throws out of `runTurn` and kills the REPL with a stack trace. Catch it in `cli.ts`, print the error, keep the session open.
- [ ] **No retries.** A single failed model request ends the turn. Retry a few times with backoff for network errors and 5xx. *(dsh: `agent/request-error` hook, `llm/llm-retry`)*
- [ ] **Tool output is cut at 2,000 characters.** Long files and web pages lose most of their content. Raise the limit, or save big outputs to a file and give the model a pointer. *(dsh: `spill`)*
- [ ] **The system prompt is not in the log.** Everything else the model sees is logged, but the system prompt is not, so a session cannot be replayed exactly. Log it like any other message. *(dsh rule: "model-visible means logged")*
- [ ] **File tools can reach outside the project.** `cd` is limited to the project, but `read_file` / `write_file` accept `../` and absolute paths. Apply the same check to them.
- [ ] **The approval prompt doesn't say where a command runs.** Show the current folder: `Allow bash in src/: rm -rf build?`
- [ ] **The stats line prints before the answer.** The `turn-end` hook fires before `runTurn` returns. Print the answer first.

## 2. The agent loop

- [ ] **Streaming.** Show the model's reply as it is generated instead of waiting for all of it. *(dsh: `agent/assistant-stream`, `core/agent-loop/src/assistant-stream.ts`)*
- [ ] **Cancellation.** Ctrl-C should stop the current model call or tool and return to the prompt, not kill the process. Pass an `AbortSignal` through the loop, model and tools. *(dsh: every step has an abort signal)*
- [ ] **Parallel tool calls.** Run read-only tools (`read_file`, `list_dir`, `fetch_url`) at the same time when the model asks for several; keep others one at a time. *(dsh: `isConcurrencySafe`, `core/agent-loop/src/tool-calls.ts`)*
- [ ] **More hooks.** A `pre-step` hook to rewrite or reject the user's input before the model sees it. *(dsh: `agent/pre-step`)*
- [ ] **Code mode.** Give the model one `run_code` tool and let it write a script that calls the other tools, so multi-step work takes fewer model calls. *(dsh: PTC mode, `tools.mode: ptc`)*

## 3. Long sessions

- [ ] **Compaction.** When the history gets close to the model's context limit, summarize old turns. *(dsh: `compaction`)*
- [ ] **Token counting.** Track tokens per request so you know when to compact and what a session costs. *(dsh: `llm/token-meter`)*
- [ ] **Session list and search.** Commands to list, search and export past sessions. *(dsh: `session-query`)*
- [ ] **Fork a session.** Start a new session from any earlier turn of an old one.
- [ ] **Log format version.** Put a version in each log so the format can change later without breaking old sessions. *(dsh: session format migrations)*

## 4. Tools

- [ ] **Edit files without rewriting them.** A find-and-replace `edit_file` tool; `write_file` replaces the whole file. *(dsh: `fs`)*
- [ ] **Web search.** `fetch_url` only opens a link you already have. *(dsh: `web`)*
- [ ] **Long-running commands.** Background processes and terminals that stay open across calls. *(dsh: `terminal`, `jobs`)*
- [ ] **MCP servers.** Connect external tool servers. *(dsh: `mcp`)*
- [ ] **Task list.** A `todo_write` tool the model uses to plan and track its own steps. *(dsh: `todo`, `plan`)*
- [ ] **Skills.** Load instruction files the model can follow for specific tasks. *(dsh: `skill`)*
- [ ] **Language server.** Go-to-definition and type errors for code. *(dsh: `lsp`)*

## 5. Safety

- [ ] **Sandbox.** bash runs as you with full access; the approval prompt is the only protection. Run commands in a restricted environment (macOS `sandbox-exec`, a container). *(dsh: `sandbox`)*
- [ ] **Policy rules.** Allow or deny tools by rule (e.g. always allow `ls`, never allow `rm -rf`) instead of asking every time. *(dsh: `guard`, `ToolGuard`)*
- [ ] **API key storage.** Keys come from environment variables only. *(dsh: `credentials`)*

## 6. Multiple agents

- [ ] **Subagent tool.** Let the model start a child agent with fewer tools for a sub-task, and get its answer back. *(dsh: `subagent`, `tools.restrict()`)*
- [ ] **Agent presets.** Named sets of tools and prompts, e.g. "reviewer" or "researcher". *(dsh: `preset`)*

## 7. Platform

- [ ] **Plugins from config.** Choose which tools and plugins load from a config file instead of editing `cli.ts`. *(dsh: Cordis plugins, profiles and bundles)*
- [ ] **Other front ends.** A web UI, or an SDK so other programs can drive the agent. *(dsh: `web`, `sdk`, `acp`)*
- [ ] **More model providers.** Anthropic-style APIs and providers that don't speak the OpenAI format. *(dsh: `llm/llm-pi-ai`)*
- [ ] **Images and attachments.** Let the user send images or files with a prompt. *(dsh: `attachment`)*
