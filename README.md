# tiny-harness

A minimal coding-agent harness: a model chooses tools, the harness runs them, and every step is recorded in an append-only session log.

## Quick start

On Ubuntu, install the `.deb` from the [latest release](https://github.com/karthikeyanrathore/tiny-harness/releases/latest):

```sh
sudo apt install ./tiny-harness_*_amd64.deb
tiny-harness
```

From source (Node.js 22.18+ and [Ollama](https://ollama.com)):

```sh
npm install && ollama signin
npm start
```

Type a prompt at `>`, `/help` for commands, and `exit` to quit.

## The tiny-harness manual

- [Install](manual/install.md) — Ubuntu packages and the optional Google Calendar plugin
- [Development](manual/development.md) — run from source, test, build the packages, release
- [Tools](manual/tools.md) — built-in tools, approvals, and plugins
- [Rules](manual/rules.md) — allow and deny rules for skipping or blocking approvals
- [Models](manual/models.md) — use a local model or another OpenAI-compatible API
- [How it works](manual/architecture.md) — startup, the prompt loop, and one turn
- [Roadmap](manual/roadmap.md) — what is planned next, phase by phase
