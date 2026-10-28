# Tools

Tools marked *(approval y/n)* ask first (`y` to allow). [Rules](rules.md) can skip or block that question.

- [x] **`list_dir`** — list a folder's entries; folders end with `/`.
- [x] **`read_file`** — read a UTF-8 text file.
- [x] **`write_file`** *(approval y/n)* — create or overwrite a UTF-8 text file.
- [x] **`fetch_url`** *(approval y/n)* — fetch an http(s) page and return its text without HTML tags.
- [x] **`bash`** *(approval y/n)* — run a shell command; a `cd` carries over to later calls and the other tools, but only inside the project.

The file tools work silently inside the project. A path that leads outside it (`../`, an absolute path, or a symlink) asks first and shows the real file it points to, even for `read_file` and `list_dir`; allow rules do not skip this.

## Approval prompts

Each prompt lists the call's arguments, one per line:

```
┌ Approve bash?
│ command:  ls -la
└ [y/N]
```

Long values show their first 20 lines. Control characters (escape codes, carriage returns, backspaces) and characters that reverse text direction are shown as visible escapes such as `\x1b` or `\u{202e}`, so an argument cannot erase or rewrite what you read before you answer.

## Plugins

Optional tools live in `plugins/<name>/`. The harness loads each `plugins/<name>/index.ts` at startup; a plugin that is not set up offers no tools. Plugins can bring commands, typed at the prompt with a leading `/` (`/help` lists them); after a command the plugins are loaded again, so a finished setup works at once. The core package ships without `plugins/`.

### Calendar

`plugins/calendar/`, set up with **`/install-gcal`** (see [Install](install.md#optional-google-calendar-plugin)):

- [x] **`google_calendar_add_event`** *(approval y/n)* — add an event to your primary Google Calendar.
- [x] **`google_calendar_list_events`** — list events between two times, with their ids.
- [x] **`google_calendar_delete_event`** *(approval y/n)* — delete an event by id; the approval prompt shows its title and time.

From source, `/install-gcal` works the same way but uses the project's `.venv`, with `credentials.json` and `token.json` in the project folder. By hand:

```sh
python3 -m venv .venv
.venv/bin/python3 -m pip install --only-binary=cryptography -r plugins/calendar/requirements.txt
# put the OAuth "Desktop app" client from Google Cloud Console in credentials.json, then:
plugins/calendar/gcal login   # opens the browser once, saves token.json
```

`credentials.json` and `token.json` are git-ignored.
