export type RunCommand = (command: string, args: string[]) => Promise<string>;

export interface TmuxWindow {
	id: string;
	index: string;
	pane: string;
	zoomed: boolean;
}

const NOTIFICATION_SCRIPT = `on run argv
	display notification (item 1 of argv) with title "Pi needs attention" subtitle (item 2 of argv)
end run`;

const FRONTMOST_APP_SCRIPT = 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js';

export async function inspectFocus(run: RunCommand, pane: string, terminalBundleId = 'org.alacritty') {
	const [target, clients, focusEvents, frontmostApp] = await Promise.all([
		run('tmux', ['display-message', '-p', '-t', pane,
			'#{window_id}\t#{window_index}\t#{pane_id}\t#{window_zoomed_flag}']),
		run('tmux', ['list-clients', '-F', '#{window_id}\t#{pane_id}\t#{client_flags}']),
		run('tmux', ['show-options', '-sv', 'focus-events']),
		run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRONTMOST_APP_SCRIPT]),
	]);
	const window = parseWindow(target);
	if (window.pane !== pane) {
		throw new Error('tmux returned a different pane');
	}
	const tracksTerminalFocus = focusEvents.trim() === 'on';
	return {
		window,
		tracksTerminalFocus,
		visible: frontmostApp.trim() === terminalBundleId
			&& isVisible(window, clients, tracksTerminalFocus),
	};
}

export async function sendAttention(run: RunCommand, question: string, subtitle: string) {
	const body = question.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim().slice(0, 180);
	const results = await Promise.allSettled([
		sendNotification(run, body, subtitle),
		run('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff']),
	]);
	const errors = results.flatMap((result, index) => result.status === 'rejected'
		? [`${index === 0 ? 'Notification' : 'Sound'} failed: ${errorMessage(result.reason)}`]
		: []);
	if (errors.length > 0) {
		throw new Error(errors.join('; '));
	}
}

export function questionText(args: unknown) {
	if (typeof args === 'object' && args !== null && 'question' in args
		&& typeof args.question === 'string' && args.question.trim()) {
		return args.question;
	}
	return 'Your agent is waiting for an answer.';
}

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function isVisible(window: TmuxWindow, clients: string, tracksTerminalFocus: boolean) {
	return clients.trim().split('\n').some((line) => {
		if (!line.trim()) return false;
		const [windowId, pane, flagText] = line.split('\t');
		if (!windowId || !pane || flagText === undefined) {
			throw new Error('Unexpected tmux client format');
		}
		const flags = new Set(flagText.trim().split(','));
		if (flags.has('control-mode')) return false;
		return windowId === window.id
			&& (!window.zoomed || pane === window.pane)
			&& (!tracksTerminalFocus || flags.has('focused'));
	});
}

async function sendNotification(run: RunCommand, body: string, subtitle: string) {
	try {
		await run('terminal-notifier', ['-title', 'Pi needs attention', '-subtitle', subtitle, '-message', body]);
	} catch {
		// AppleScript keeps notifications available when the optional helper is missing or fails.
		await run('/usr/bin/osascript', ['-e', NOTIFICATION_SCRIPT, '--', body, subtitle]);
	}
}

function parseWindow(output: string): TmuxWindow {
	const [id, index, pane, zoomed] = output.trim().split('\t');
	if (!id || !/^@\d+$/.test(id) || !index || !/^\d+$/.test(index)
		|| !pane || !/^%\d+$/.test(pane) || (zoomed !== '0' && zoomed !== '1')) {
		throw new Error('Unexpected tmux window format');
	}
	return { id, index, pane, zoomed: zoomed === '1' };
}
