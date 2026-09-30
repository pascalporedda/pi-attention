import { describe, expect, it, vi } from 'vite-plus/test';
import type { RunCommand } from '../src/attention.js';
import { clickCommand, sendAttention, tmuxSocket } from '../src/attention.js';
import { chooseClient, focusAgent } from '../src/focus-cli.mjs';

const target = {
	socket: '/tmp/tmux-501/default',
	session: '$1',
	window: '@5',
	pane: '%11',
	tmux: '/opt/homebrew/bin/tmux',
	terminalBundleId: 'org.alacritty',
};

function mockRun(state = '$1|@5|%11|0', clients = '/dev/ttys000|$1|100|attached,focused') {
	return vi.fn<RunCommand>(async (_command, args) => {
		if (args.includes('display-message')) return state;
		if (args.includes('list-clients')) return clients;
		return '';
	});
}

describe('click-to-focus', () => {
	it('selects the exact socket, session, window and pane', async () => {
		const run = mockRun();
		await focusAgent(run, target);
		expect(run.mock.calls.slice(2)).toEqual([
			[
				target.tmux,
				['-S', target.socket, 'switch-client', '-c', '/dev/ttys000', '-t', '$1:@5.%11'],
			],
			[target.tmux, ['-S', target.socket, 'select-pane', '-t', '$1:@5.%11']],
		]);
	});

	it('uses ASCII field separators in callback tmux queries', async () => {
		const run = mockRun();
		await focusAgent(run, target);
		const formats = run.mock.calls
			.filter(([, args]) => args.includes('-p') || args.includes('-F'))
			.map(([, args]) => args.at(-1));
		expect(formats).toEqual([
			'#{session_id}|#{window_id}|#{pane_id}|#{window_zoomed_flag}',
			'#{client_name}|#{session_id}|#{client_activity}|#{client_flags}',
		]);
	});

	it('unzooms the window so a hidden agent pane becomes visible', async () => {
		const run = mockRun('$1|@5|%11|1');
		await focusAgent(run, target);
		expect(run.mock.calls[2]).toEqual([
			target.tmux,
			['-S', target.socket, 'resize-pane', '-Z', '-t', '$1:@5.%11'],
		]);
	});

	it('refuses a stale notification target without switching any client', async () => {
		const run = mockRun('$1|@5|%99|0');
		await expect(focusAgent(run, target)).rejects.toThrow('no longer exists');
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('does not open another terminal window when there are no clients', async () => {
		const run = mockRun(undefined, '');
		await expect(focusAgent(run, target)).rejects.toThrow('No interactive tmux client');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('rejects malformed target IDs before running commands', async () => {
		const run = mockRun();
		await expect(focusAgent(run, { ...target, pane: '%11; touch /tmp/injected' })).rejects.toThrow(
			'Invalid',
		);
		expect(run).not.toHaveBeenCalled();
	});

	it('prefers clients already attached to the agent session', () => {
		expect(chooseClient('/dev/ttys000|$2|200|attached\n/dev/ttys001|$1|100|attached', '$1')).toBe(
			'/dev/ttys001',
		);
	});

	it('chooses the most recently active client within the same session', () => {
		expect(chooseClient('/dev/ttys000|$1|100|attached\n/dev/ttys001|$1|200|attached', '$1')).toBe(
			'/dev/ttys001',
		);
	});

	it('switches the most recently active existing client when the session has none', () => {
		expect(chooseClient('/dev/ttys000|$2|100|attached\n/dev/ttys001|$3|200|attached', '$1')).toBe(
			'/dev/ttys001',
		);
	});

	it('excludes control-mode clients', () => {
		expect(
			chooseClient('/dev/ttys000|$1|200|attached,control-mode\n/dev/ttys001|$2|100|attached', '$1'),
		).toBe('/dev/ttys001');
	});

	it('rejects malformed client data', () => {
		expect(() => chooseClient('bad data', '$1')).toThrow('client format');
	});
});

describe('notification callback command', () => {
	const clickTarget = {
		socket: target.socket,
		pane: target.pane,
		terminalBundleId: target.terminalBundleId,
	};
	const run = vi.fn<RunCommand>(async (command) =>
		command === '/usr/bin/which' ? '/opt/homebrew/bin/tmux\n' : '$1\t@5\t%11',
	);

	it('uses absolute executable and helper paths with captured tmux IDs', async () => {
		const command = await clickCommand(run, clickTarget);
		expect(command).toContain('focus-cli.mjs');
		expect(command).toContain("'$1' '@5' '%11' '/opt/homebrew/bin/tmux'");
		expect(command.startsWith(`'${process.execPath}'`)).toBe(true);
	});

	it('quotes shell metacharacters in paths', async () => {
		const command = await clickCommand(run, {
			...clickTarget,
			socket: "/tmp/it's $(touch nope)/socket",
		});
		expect(command).toContain("'/tmp/it'\"'\"'s $(touch nope)/socket'");
	});

	it('adds a click callback without putting the question into shell source', async () => {
		const calls = vi.fn<RunCommand>(async (command, args) => {
			if (command === '/usr/bin/which') return target.tmux;
			if (args.includes('display-message')) return '$1\t@5\t%11';
			return '';
		});
		const question = 'Question? $(touch /tmp/injected)';
		await sendAttention(calls, question, 'test', clickTarget);
		const args = calls.mock.calls.find(([command]) => command === 'terminal-notifier')?.[1];
		expect(args).toContain(question);
		expect(args).toContain('-activate');
		expect(args?.[args.indexOf('-activate') + 1]).toBe('org.alacritty');
		expect(args).toContain('-execute');
		expect(args?.at(-1)).not.toContain(question);
	});

	it('falls back if the click target cannot be resolved', async () => {
		const calls = vi.fn<RunCommand>(async (command) => {
			if (command === 'tmux') throw new Error('pane removed');
			return '';
		});
		await expect(sendAttention(calls, 'Question?', 'test', clickTarget)).resolves.toBeUndefined();
		expect(calls).toHaveBeenCalledWith('/usr/bin/osascript', expect.arrayContaining(['Question?']));
	});

	it.each([
		['/tmp/tmux-501/default,123,1', '/tmp/tmux-501/default'],
		['/tmp/with,comma/socket,123,1', '/tmp/with,comma/socket'],
	])('extracts the socket from %s', (value, socket) => {
		expect(tmuxSocket(value)).toBe(socket);
	});

	it('rejects an invalid TMUX environment', () => {
		expect(() => tmuxSocket('bad')).toThrow('TMUX environment');
	});
});
