# tiny-harness

A minimal coding-agent harness: a model chooses tools, the harness runs them, and every step is recorded in an append-only session log.

## Requirements

- Node.js 22.18+ (runs the `.ts` files directly, no build step)
- [Ollama](https://ollama.com) with a model that supports tool calls, or any OpenAI-compatible API

## Setup

```sh
npm install      # only TypeScript and type definitions, for `npm run typecheck`
ollama signin    # the default model runs on Ollama's cloud (free plan)
```

## Run

```sh
npm start                              # gemma4:31b-cloud through local Ollama
npm start -- --resume <session-id>     # continue a saved session
```

Type a prompt at `>`, and `exit` to quit. Calls to `bash`, `write_file` and `fetch_url` ask for approval first (`y` to allow).

Try: `what files are in this folder?`, `read package.json`, `run ls -la`, `summarize https://example.com`.

Sessions are saved as `sessions/<session-id>.jsonl`.

## How it works

Solid arrows show the order the code runs in; dotted arrows are reads and writes to the session log. After tool results are logged, the next step rebuilds the request from the log, which is how the model sees them.

```mermaid
flowchart TD
    %% ── Startup (src/cli.ts, runs once) ──
    A(["npm start → node src/cli.ts"]) --> B["Read --resume id, pick session file"]
    B --> C["new Session(path) — log.ts<br/>load .jsonl, close any interrupted turn"]
    C --> D["builtinTools(root, session) → tools.register()<br/>list_dir · read_file · write_file · fetch_url · bash"]
    D --> E["Register plugins on hooks — plugins.ts<br/>approval · truncate · stats"]
    E --> F[/"readLine('> ')"/]

    F -->|"exit / end of input"| Z(["process.exit"])
    F -->|"prompt"| T0

    %% ── One turn (src/loop.ts runTurn) ──
    subgraph TURN["runTurn(agent, input) — loop.ts"]
        T0["append turn_start + user"] --> S0{"steps < maxSteps?"}
        S0 -->|no| LIM["reason = step_limit"]
        S0 -->|yes| CX{"Current directory<br/>changed since last told?"}
        CX -->|yes| CXA["append context message"] --> RQ
        CX -->|no| RQ["Build request<br/>system + session.deriveMessages() + tools.schemas()"]
        RQ --> H1["hook: request — hooks.ts"]
        H1 --> LLM["llm.call() — llm.ts<br/>POST /chat/completions to Ollama"]
        LLM -->|"HTTP / network error"| ERR["closeOpenCalls()<br/>reason = error"]
        LLM --> AS["append assistant message"]
        AS --> TC{"Tool calls<br/>in the reply?"}
        TC -->|no| DONE["reason = completed<br/>answer = reply text"]
        TC -->|yes| PRE["hook: pre-execute<br/>approval asks y/N for bash · write_file · fetch_url"]
        PRE --> AL{"Allowed?"}
        AL -->|no| DEN["result = denied"]
        AL -->|yes| EX["tools.execute() — tools.ts<br/>validate args, run tool"]
        EX -.->|"bash ended in a new folder"| CWD["append cwd entry — builtin.ts"]
        EX --> POST
        DEN --> POST["hook: post-execute<br/>truncate long output"]
        POST --> TR["append tool_result"]
        TR -->|"more calls"| PRE
        TR -->|"all calls done → next step"| S0
        LIM --> END
        DONE --> END
        ERR --> END["append turn_end<br/>hook: turn-end → stats prints line"]
    end

    END -->|"completed / step_limit"| P["print answer"] --> F
    END -->|"error"| CRASH(["CLI crashes — see ROADMAP.md"])

    %% ── Session log ──
    LOG[("sessions/SESSION_ID.jsonl<br/>append-only log")]
    C -.->|read| LOG
    T0 -.-> LOG
    CXA -.-> LOG
    AS -.-> LOG
    TR -.-> LOG
    CWD -.-> LOG
    RQ -.->|"deriveMessages()"| LOG
```

## Use another model

Point it at any OpenAI-compatible `/chat/completions` endpoint:

```sh
LLM_MODEL=qwen3.5:0.8b npm start                     # a local model; nothing leaves your machine

LLM_BASE_URL=https://api.deepseek.com/v1 \
LLM_MODEL=deepseek-chat \
LLM_API_KEY=sk-... npm start                         # a hosted API
```

| Variable | Default |
|---|---|
| `LLM_BASE_URL` | `http://127.0.0.1:11434/v1` |
| `LLM_MODEL` | `gemma4:31b-cloud` |
| `LLM_API_KEY` | none |

`-cloud` models run on Ollama's servers: your prompts and any file contents the tools read are sent there. Very small local models such as `qwen3.5:0.8b` handle single-tool questions but get lost on multi-step tasks.

## Test

```sh
npm test         # offline; uses scripted model replies and a mock HTTP server
npm run typecheck
```
