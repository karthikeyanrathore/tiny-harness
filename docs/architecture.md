# How it works

## Startup and prompt loop

`tiny-harness/src/cli.ts` sets everything up once, then calls `runTurn` for each prompt. Dotted arrows are reads and writes to the session log.

```mermaid
flowchart TD
    A(["npm start → node tiny-harness/src/cli.ts"]) --> B["Read --resume id, pick session file"]
    B --> C["new Session(path) — log.ts<br/>load .jsonl, close any interrupted turn"]
    C --> D["builtinTools(root, session) → tools.register()<br/>list_dir · read_file · write_file · fetch_url · bash<br/>+ tools from plugins/ (loadPlugins)"]
    D --> E["Register built-in plugins on hooks — plugins.ts<br/>outsideProject · approval + rules · truncate · stats"]
    E --> F[/"readLine('> ')"/]

    F -->|"exit / end of input"| Z(["process.exit"])
    F -->|"prompt"| RT[["runTurn(agent, input) — loop.ts<br/>see the sequence diagram below"]]
    RT -->|"returns the answer"| P["print answer"] --> F
    RT -->|"throws on a model error"| CRASH(["CLI crashes — see roadmap.md"])

    LOG[("tiny-harness/sessions/SESSION_ID.jsonl<br/>append-only log")]
    C -.->|read| LOG
    RT -.->|"read + append"| LOG
```

## One turn: `runTurn`

A turn handles one prompt. Each step is one model call plus the tool calls the reply asks for. The model sees earlier tool results because every step rebuilds the messages from the log with `deriveMessages()`.

```mermaid
sequenceDiagram
    participant CLI as cli.ts
    participant Turn as runTurn (loop.ts)
    participant Log as Session (log.ts)
    participant Hooks as Hooks + plugins
    participant LLM as llm.ts → Ollama
    participant Tools as ToolRegistry (tools.ts)

    CLI->>Turn: runTurn(agent, input)
    Turn->>Log: append turn_start, user

    loop each step, while steps < maxSteps
        opt current directory changed since the model was last told
            Turn->>Log: append context "Current directory: …"
        end
        Turn->>Log: deriveMessages()
        Log-->>Turn: messages, including earlier tool results
        Turn->>Hooks: run "request" with model, system, messages, tool schemas
        Hooks-->>Turn: request
        Turn->>LLM: llm.call(request) → POST /chat/completions
        LLM-->>Turn: reply: content + toolCalls
        Turn->>Log: append assistant
        break the reply has no tool calls
            Note over Turn: reason = completed, answer = reply text
        end
        loop each tool call in the reply
            Turn->>Hooks: run "pre-execute" with call, allow = true
            Note over Hooks: outsideProject asks before a file tool leaves the project<br/>approval applies rules.json, then asks y/N for the tools marked (approval y/n)
            Hooks-->>Turn: decision
            alt allowed
                Turn->>Tools: execute(call)
                opt bash ended in a new folder inside the project
                    Tools->>Log: append cwd
                end
                Tools-->>Turn: result
            else denied
                Note over Turn: result = "denied: reason"
            end
            Turn->>Hooks: run "post-execute" with call, result
            Note over Hooks: truncate cuts output over 2000 characters
            Hooks-->>Turn: result
            Turn->>Log: append tool_result
        end
    end

    Note over Turn: if the steps ran out: reason = step_limit
    Note over Turn,LLM: if llm.call throws: closeOpenCalls(), reason = error, then rethrow after turn_end
    Turn->>Log: append turn_end with turn, reason
    Turn->>Hooks: run "turn-end"
    Note over Hooks: stats prints [turn N: reason, steps, tool calls]
    Turn-->>CLI: answer
```
