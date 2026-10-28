# Development

## Layout

`tiny-harness/` holds everything the app needs to run: `src/`, `plugins/` and its own `package.json` (with the version). Copy that folder anywhere and run `node src/cli.ts` in it. The rest of the repository is for development: `tests/`, `docs/`, `debian/` and `scripts/` for the packages, and the top-level `package.json` with the test and typecheck scripts.

## Requirements

- Node.js 22.18+ (runs the `.ts` files directly, no build step)
- [Ollama](https://ollama.com) with a model that supports tool calls, or any OpenAI-compatible API (see [Models](models.md))

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

Type a prompt at `>`, `/clear` to clear the screen, and `exit` to quit. Tools marked *(approval y/n)* in [Tools](tools.md) ask first (`y` to allow).

Try: `what files are in this folder?`, `read package.json`, `run ls -la`, `summarize https://example.com`.

Sessions are saved as `tiny-harness/sessions/<session-id>.jsonl`.

## Test

```sh
npm test         # offline; uses scripted model replies and a mock HTTP server
npm run typecheck
```

## Build the Ubuntu packages

```sh
scripts/build-deb.sh amd64    # or arm64; writes dist/tiny-harness_<version>_<arch>.deb
                              # and the plugin dist/tiny-harness-calendar_<version>_all.deb
```

The `release` workflow builds them for amd64 and arm64, installs them on clean Ubuntu 22.04 and 24.04 (`debian/test-install.sh`: the core alone first, checking no Python comes with it, then the plugin), and on a `v*` tag publishes them as a GitHub release. To release: bump `version` in `tiny-harness/package.json`, then `git tag v<version> && git push origin v<version>`.
