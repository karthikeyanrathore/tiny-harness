# Allow and deny rules

Put rules in `~/.config/tiny-harness/rules.json` to skip the approval prompt for safe commands and block dangerous ones:

```json
{ "allow": ["ls", "git status", "npm test"], "deny": ["rm -rf", "sudo"] }
```

## Bash commands

- **deny** blocks the command without asking; the model is told which rule blocked it. It matches the rule's words anywhere in the command, and wins over allow.
- **allow** runs the command without asking, but only if every part of it (split at `&&`, `;`, `|` and so on) starts with an allowed rule, and it has no `$`, backticks, redirects or brackets. `ls && rm x` still asks.

Rules match whole words, so `ls` does not allow `lsof`. They guard against mistakes; they are not a sandbox.

## Other tools

For any tool other than `bash`, a rule is the tool's name: `"allow": ["google_calendar_add_event"]` adds calendar events without asking, and a tool name under `deny` blocks that tool.

Rules are only checked for tools that ask for approval, so a deny rule for `read_file`, `list_dir` or `google_calendar_list_events` has no effect yet. An allow rule never skips the question a file tool asks before it reaches outside the project (see [Tools](tools.md)).
