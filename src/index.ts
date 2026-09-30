import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { RunCommand } from './attention.js';
import { errorMessage, inspectFocus, questionText, sendAttention, tmuxSocket } from './attention.js';

export default function attention(pi: ExtensionAPI) {
	const run: RunCommand = async (command, args) => {
		const timeout = command === '/usr/bin/afplay' ? 10000 : 3000;
		const result = await pi.exec(command, args, { timeout });
		if (result.killed || result.code !== 0) {
			throw new Error(`${command} failed: ${result.stderr.trim() || 'timeout or non-zero exit'}`);
		}
		return result.stdout;
	};
	let warnedAboutFocus = false;

	pi.on('tool_execution_start', async (event, ctx) => {
		if (event.toolName !== 'ask_user_question' || ctx.mode !== 'tui'
			|| process.platform !== 'darwin' || !process.env.TMUX || !process.env.TMUX_PANE) return;
		try {
			const focus = await inspectFocus(run, process.env.TMUX_PANE,
				process.env.PI_ATTENTION_TERMINAL_BUNDLE_ID || 'org.alacritty');
			if (!focus.tracksTerminalFocus && !warnedAboutFocus) {
				warnedAboutFocus = true;
				ctx.ui.notify('Pi attention: run tmux set -s focus-events on for tmux client focus tracking.', 'warning');
			}
			if (focus.visible) return;
			await sendAttention(run, questionText(event.args),
				`tmux window ${focus.window.index} (${focus.window.id}), pane ${focus.window.pane}`, {
					pane: process.env.TMUX_PANE,
					socket: tmuxSocket(process.env.TMUX),
					terminalBundleId: process.env.PI_ATTENTION_TERMINAL_BUNDLE_ID || 'org.alacritty',
				});
		} catch (error) {
			ctx.ui.notify(`Pi attention: ${errorMessage(error)}`, 'warning');
		}
	});

	pi.registerCommand('attention-test', {
		description: 'Play the attention sound and send a macOS notification, ignoring focus',
		handler: async (_args, ctx) => {
			if (ctx.mode !== 'tui' || process.platform !== 'darwin') {
				ctx.ui.notify('Pi attention requires interactive Pi on macOS.', 'warning');
				return;
			}
			try {
				const clickTarget = process.env.TMUX && process.env.TMUX_PANE ? {
					pane: process.env.TMUX_PANE,
					socket: tmuxSocket(process.env.TMUX),
					terminalBundleId: process.env.PI_ATTENTION_TERMINAL_BUNDLE_ID || 'org.alacritty',
				} : undefined;
				await sendAttention(run, 'Your agent is waiting for an answer.', 'Pi attention test', clickTarget);
				ctx.ui.notify('Attention test sent. Check macOS notification permissions if no banner appears.', 'info');
			} catch (error) {
				ctx.ui.notify(`Pi attention: ${errorMessage(error)}`, 'warning');
			}
		},
	});
}
