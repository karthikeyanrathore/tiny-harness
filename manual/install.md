# Install on Ubuntu

Download the `.deb` for your CPU (`amd64` for most PCs, `arm64` for ARM machines) from the [latest release](https://github.com/karthikeyanrathore/tiny-harness/releases/latest), then:

```sh
sudo apt install ./tiny-harness_*_amd64.deb   # Ubuntu 22.04 or later; brings its own Node.js, no Python
tiny-harness                                  # start it in any folder
```

Sessions are kept in `~/.local/share/tiny-harness/sessions`. Remove it with `sudo apt remove tiny-harness`.

## Optional: Google Calendar plugin

Only if you want the model to manage your calendar. It brings Python and the Google libraries, so it is a separate package (`_all` works on every CPU):

```sh
sudo apt install ./tiny-harness-calendar_*_all.deb
tiny-harness                                  # then type /install-gcal: a guided 5-minute setup, once
```

`/install-gcal` (or `tiny-harness calendar-setup` from the shell) installs the Google libraries for your user, walks you through creating your own free Google OAuth client, and signs you in. Its files are kept in `~/.local/share/tiny-harness/calendar` and `~/.config/tiny-harness/calendar`. Until setup is done the calendar tools stay hidden from the model. Remove it with `sudo apt remove tiny-harness-calendar`.

To run from a checkout instead, see [Development](development.md).
