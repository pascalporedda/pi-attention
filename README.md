# pi-attention

Play a sound and show a macOS notification when a Pi agent calls `ask_user_question` in an unfocused tmux window.

## Install

```sh
pi install git:github.com/pascalporedda/pi-attention
```

Run `/reload` in existing Pi sessions. The extension listens to your existing `ask_user_question` tool; it does not install or replace that tool.

Requires macOS, tmux, and interactive Pi. Alacritty works with tmux focus reporting. Other terminals that report focus also work.

Add this line to `~/.tmux.conf`:

```tmux
set -s focus-events on
```

Enable it for the current tmux server:

```sh
tmux set -s focus-events on
```

Switch away from the terminal and back once so tmux receives a fresh focus event.

## What triggers an alert?

`src/index.ts` listens to `tool_execution_start` for `ask_user_question`. Each call checks the window containing the agent's `TMUX_PANE`:

- A focused tmux client showing that window suppresses the alert.
- A different selected window, an unfocused terminal, or no attached client triggers the alert.
- Another selected split in the same window suppresses the alert unless that split is zoomed and hides the agent.
- With `focus-events` off, only tmux window selection is checked. Pi shows a warning once per extension load.

There is one alert per question start. Switching away after the question has already opened does not trigger another alert. JSON, RPC, print mode, non-macOS hosts, and sessions outside tmux do not send alerts. The extension checks the pane inherited by the Pi process, including agents launched in their own tmux panes.

`src/attention.ts` runs `/usr/bin/afplay` with `/System/Library/Sounds/Glass.aiff` and `/usr/bin/osascript` with `display notification`. Neither requires a Homebrew package. The banner includes up to 180 characters of the question and the tmux window and pane IDs. Question text can appear on the lock screen according to your macOS notification settings.

macOS controls the sender label. Built-in AppleScript notifications can appear as Script Editor or an AppleScript host, **not Alacritty**. This extension does not use Alacritty notification escape sequences or activate the terminal.

## Test the notification

Run this inside interactive Pi:

```text
/attention-test
```

The command ignores focus and sends one banner and sound. If the sound plays without a banner, check **System Settings > Notifications** for the AppleScript notification host and disable Focus / Do Not Disturb. Successful `osascript` execution does not prove macOS displayed a banner.

Command failures produce a Pi warning without cancelling the question. tmux and notification commands have a three-second timeout. Sound playback has a ten-second timeout to allow audio-device startup. No timers, polling, or background watchers are installed.

## Develop

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pi -e ./src/index.ts
```

For a personal install from your working copy:

```sh
pi install /absolute/path/to/pi-attention
```
