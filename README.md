# pi-attention

Play a sound and show a macOS notification when a Pi agent calls `ask_user_question` in an unfocused tmux window.

## Install

```sh
pi install git:github.com/pascalporedda/pi-attention
```

Run `/reload` in existing Pi sessions. The extension listens to your existing `ask_user_question` tool; it does not install or replace that tool.

Requires macOS, tmux, and interactive Pi. The frontmost-app check defaults to Alacritty's bundle ID, `org.alacritty`. For another terminal, set `PI_ATTENTION_TERMINAL_BUNDLE_ID` before starting Pi, for example `com.googlecode.iterm2` for iTerm2.

Install the preferred notification helper:

```sh
brew install terminal-notifier
```

If the helper is missing or its command fails, the extension falls back to macOS's built-in AppleScript notifications.

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

- The configured terminal must be macOS's frontmost app and a focused tmux client must show the agent's window to suppress the alert.
- A different selected window, another frontmost app, an unfocused terminal, or no attached client triggers the alert.
- `NSWorkspace` checks the frontmost app even when tmux's `focused` flag stays stale after Alt-Tab. This does not use Accessibility or System Events permissions.
- Another selected split in the same window suppresses the alert unless that split is zoomed and hides the agent.
- With `focus-events` off, macOS app focus and tmux window selection are still checked. Pi shows a warning once per extension load because tmux client focus is unavailable.

There is one alert per question start. Switching away after the question has already opened does not trigger another alert. JSON, RPC, print mode, non-macOS hosts, and sessions outside tmux do not send alerts. The extension checks the pane inherited by the Pi process, including agents launched in their own tmux panes.

`src/attention.ts` runs `/usr/bin/afplay` with `/System/Library/Sounds/Glass.aiff` and `terminal-notifier` without action buttons. When `terminal-notifier` is unavailable or returns an error, `/usr/bin/osascript` sends `display notification` instead. Sound playback is independent of notification delivery. The banner includes up to 180 characters of the question and the tmux window and pane IDs. Question text can appear on the lock screen according to your macOS notification settings.

macOS controls the sender label and popup appearance. The default sender is terminal-notifier, with no action buttons requested by this extension. The AppleScript fallback can appear as Script Editor or an AppleScript host and can include macOS's "Show" button. This extension does not use Alacritty notification escape sequences.

## Click to return to the agent

Click the body of a terminal-notifier notification to bring Alacritty forward and select the agent's tmux session, window, and pane. The `-activate` option lets terminal-notifier raise Alacritty directly through macOS `NSWorkspace` during the click response. The tmux callback does not launch a separate `open` process. The callback runs `src/focus-cli.mjs` through the same Node executable as Pi, with absolute helper and tmux paths. It captures the tmux socket and stable session, window, and pane IDs when the notification is sent. The helper parses ASCII-separated tmux output because macOS can launch it without a locale; tmux replaces tab separators with underscores in that environment. Question text is not included in the callback command.

The helper selects the most recently active interactive client already attached to the agent's session. If that session has no client, it switches the most recently active attached client to the session. It unzooms the target window so the agent pane becomes visible. A removed target or no attached client stops the callback without opening a new terminal window.

With multiple Alacritty windows, macOS decides which application window comes forward. The helper selects the exact tmux target in the chosen client, but it does not use Accessibility permissions to raise a specific Alacritty window. Keep one attached Alacritty client if you need an unambiguous application window.

The AppleScript fallback does not support click-to-focus. Clicking its notification can open the AppleScript host instead.

## Test the notification

Run this inside interactive Pi:

```text
/attention-test
```

The command ignores focus and sends one banner and sound. Inside tmux, the banner's click callback targets the pane running Pi. If the sound plays without a banner, run `terminal-notifier -diagnose` and check **System Settings > Notifications** for terminal-notifier or the AppleScript fallback host. Also check Focus / Do Not Disturb. A successful notification command does not prove macOS displayed a banner. The fallback handles command failures, not a banner suppressed by macOS.

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
