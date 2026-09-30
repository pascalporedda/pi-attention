import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/** @typedef {{ socket: string, session: string, window: string, pane: string, tmux: string }} FocusTarget */
/** @typedef {(command: string, args: string[]) => Promise<string>} RunCommand */

/** @param {RunCommand} run @param {FocusTarget} target */
export async function focusAgent(run, target) {
	validateTarget(target);
	const address = `${target.session}:${target.window}.${target.pane}`;
	const tmux = async (/** @type {string[]} */ args) => run(target.tmux, ['-S', target.socket, ...args]);
	const state = (await tmux(['display-message', '-p', '-t', address,
		'#{session_id}|#{window_id}|#{pane_id}|#{window_zoomed_flag}'])).trim().split('|');
	if (state[0] !== target.session || state[1] !== target.window || state[2] !== target.pane
		|| (state[3] !== '0' && state[3] !== '1')) {
		throw new Error('The agent tmux target no longer exists');
	}
	const client = chooseClient(await tmux(['list-clients', '-F',
		'#{client_name}|#{session_id}|#{client_activity}|#{client_flags}']), target.session);
	if (!client) throw new Error('No interactive tmux client is attached');
	if (state[3] === '1') await tmux(['resize-pane', '-Z', '-t', address]);
	await tmux(['switch-client', '-c', client, '-t', address]);
	await tmux(['select-pane', '-t', address]);
}

/** @param {string} output @param {string} session */
export function chooseClient(output, session) {
	const clients = output.trim().split('\n').flatMap((line) => {
		if (!line.trim()) return [];
		const [name, attachedSession, activity, flagText] = line.split('|');
		if (!name || !attachedSession || !activity || flagText === undefined
			|| !/^\d+$/.test(activity) || !/^\$\d+$/.test(attachedSession)) {
			throw new Error('Unexpected tmux client format');
		}
		const flags = new Set(flagText.trim().split(','));
		if (flags.has('control-mode')) return [];
		return [{ name, session: attachedSession, activity: Number(activity) }];
	});
	clients.sort((left, right) => Number(right.session === session) - Number(left.session === session)
		|| right.activity - left.activity);
	return clients[0]?.name;
}

/** @param {FocusTarget} target */
function validateTarget(target) {
	if (!/^\$\d+$/.test(target.session) || !/^@\d+$/.test(target.window) || !/^%\d+$/.test(target.pane)
		|| !target.socket.startsWith('/') || !target.tmux.startsWith('/')) {
		throw new Error('Invalid tmux focus target');
	}
}

async function main() {
	const [socket, session, window, pane, tmux] = process.argv.slice(2);
	if (!socket || !session || !window || !pane || !tmux) {
		throw new Error('Expected socket, session, window, pane, and tmux executable');
	}
	const execute = promisify(execFile);
	/** @type {RunCommand} */
	const run = async (command, args) => (await execute(command, args, { timeout: 3000 })).stdout;
	await focusAgent(run, { socket, session, window, pane, tmux });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error('Pi attention focus failed:', error);
		process.exitCode = 1;
	});
}
