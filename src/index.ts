import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { RunCommand } from './attention.js';
import { errorMessage, inspectFocus, questionText, sendAttention } from './attention.js';

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
			const focus = await inspectFocus(run, process.env.TMUX_PANE);
			if (!focus.tracksTerminalFocus && !warnedAboutFocus) {
				warnedAboutFocus = true;
				ctx.ui.notify('Pi attention: run tmux set -s focus-events on to detect terminal app focus.', 'warning');
			}
			if (focus.visible) return;
			await sendAttention(run, questionText(event.args),
				`tmux window ${focus.window.index} (${focus.window.id}), pane ${focus.window.pane}`);
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
				await sendAttention(run, 'Your agent is waiting for an answer.', 'Pi attention test');
				ctx.ui.notify('Attention test sent. Check macOS notification permissions if no banner appears.', 'info');
			} catch (error) {
				ctx.ui.notify(`Pi attention: ${errorMessage(error)}`, 'warning');
			}
		},
	});
}
