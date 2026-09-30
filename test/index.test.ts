import type { ExtensionAPI, ExtensionContext, ToolExecutionStartEvent } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import attention from '../src/index.js';

type StartHandler = (event: ToolExecutionStartEvent, ctx: ExtensionContext) => Promise<void>;

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

beforeEach(() => {
	Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
	vi.stubEnv('TMUX', '/tmp/tmux-501/default,123,1');
	vi.stubEnv('TMUX_PANE', '%11');
});

afterEach(() => {
	if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
	vi.unstubAllEnvs();
});

function setup({ clients = '@3\t%12\tattached,focused', fail = '', focusEvents = 'on' } = {}) {
	let handler: StartHandler | undefined;
	const exec = vi.fn(async (command: string, args: string[]) => {
		let stdout = '';
		if (args[0] === 'display-message') stdout = '@2\t1\t%11\t0';
		if (args[0] === 'list-clients') stdout = clients;
		if (args[0] === 'show-options') stdout = focusEvents;
		return { stdout, stderr: command === fail ? 'failed' : '', code: command === fail ? 1 : 0, killed: false };
	});
	const api = {
		exec,
		on: vi.fn((_event: string, callback: StartHandler) => { handler = callback; }),
		registerCommand: vi.fn(),
	};
	const notify = vi.fn();
	// Only the API and context members exercised by this extension exist in these test doubles.
	attention(api as unknown as ExtensionAPI);
	const ctx = { mode: 'tui', ui: { notify } } as unknown as ExtensionContext;
	if (!handler) throw new Error('Missing tool_execution_start handler');
	const start = handler;
	return {
		exec,
		notify,
		api,
		fire: (toolName = 'ask_user_question', context = ctx) => start({
			type: 'tool_execution_start', toolName, toolCallId: 'question-1', args: { question: 'Continue?' },
		}, context),
		ctx,
	};
}

describe('Pi event integration', () => {
	it('notifies and plays sound for a question in a hidden window', async () => {
		const { fire, exec } = setup();
		await fire();
		expect(exec).toHaveBeenCalledWith('/usr/bin/osascript', expect.arrayContaining(['Continue?']), { timeout: 3000 });
		expect(exec).toHaveBeenCalledWith('/usr/bin/afplay', expect.any(Array), { timeout: 10000 });
	});

	it('does not notify for a visible window', async () => {
		const { fire, exec } = setup({ clients: '@2\t%2\tattached,focused' });
		await fire();
		expect(exec).toHaveBeenCalledTimes(3);
		expect(exec.mock.calls.every(([command]) => command === 'tmux')).toBe(true);
	});

	it('ignores other tools', async () => {
		const { fire, exec } = setup();
		await fire('bash');
		expect(exec).not.toHaveBeenCalled();
	});

	it.each(['rpc', 'json', 'print'])('ignores %s mode', async (mode) => {
		const { fire, exec, ctx } = setup();
		await fire('ask_user_question', { ...ctx, mode } as ExtensionContext);
		expect(exec).not.toHaveBeenCalled();
	});

	it('ignores non-macOS hosts', async () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const { fire, exec } = setup();
		await fire();
		expect(exec).not.toHaveBeenCalled();
	});

	it('ignores sessions outside tmux', async () => {
		vi.stubEnv('TMUX', '');
		const { fire, exec } = setup();
		await fire();
		expect(exec).not.toHaveBeenCalled();
	});

	it.each(['tmux', '/usr/bin/osascript', '/usr/bin/afplay'])('never cancels the question when %s fails', async (fail) => {
		const { fire, notify } = setup({ fail });
		await expect(fire()).resolves.toBeUndefined();
		expect(notify).toHaveBeenCalledWith(expect.stringContaining('failed'), 'warning');
	});

	it('warns once when focus-events is off', async () => {
		const { fire, notify } = setup({ clients: '@2\t%2\tattached', focusEvents: 'off' });
		await fire();
		await fire();
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it('registers an explicit notification test command', () => {
		const { api } = setup();
		expect(api.registerCommand).toHaveBeenCalledWith('attention-test', expect.objectContaining({
			handler: expect.any(Function),
		}));
	});
});
