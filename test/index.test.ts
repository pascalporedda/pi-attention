import type {
	ExtensionAPI,
	ExtensionContext,
	ToolExecutionStartEvent,
} from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import attention from '../src/index.js';

type StartHandler = (event: ToolExecutionStartEvent, ctx: ExtensionContext) => Promise<void>;

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

beforeEach(() => {
	Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
	vi.stubEnv('TMUX', '/tmp/tmux-501/default,123,1');
	vi.stubEnv('TMUX_PANE', '%11');
	vi.stubEnv('PI_ATTENTION_TERMINAL_BUNDLE_ID', 'org.alacritty');
});

afterEach(() => {
	if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
	vi.unstubAllEnvs();
});

function eventSignal() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function setup({
	clients = '@3\t%12\tattached,focused',
	fail = '',
	focusEvents = 'on',
	frontmostApp = 'org.alacritty',
	sound = Promise.resolve(),
} = {}) {
	let handler: StartHandler | undefined;
	const notification = eventSignal();
	const fallback = eventSignal();
	const warning = eventSignal();
	const exec = vi.fn(async (command: string, args: string[]) => {
		if (command === '/usr/bin/afplay') await sound;
		if (command === 'terminal-notifier') notification.resolve();
		if (command === '/usr/bin/osascript' && args[0] === '-e') fallback.resolve();
		let stdout = '';
		if (args[0] === 'display-message') stdout = '@2\t1\t%11\t0';
		if (args[0] === 'list-clients') stdout = clients;
		if (args[0] === 'show-options') stdout = focusEvents;
		if (args[0] === '-S' && args[2] === 'display-message') stdout = '$1\t@2\t%11';
		if (command === '/usr/bin/which') stdout = '/opt/homebrew/bin/tmux';
		if (command === '/usr/bin/osascript' && args[0] === '-l') stdout = frontmostApp;
		const failed =
			command === fail || (fail === '/usr/bin/osascript' && command === 'terminal-notifier');
		return { stdout, stderr: failed ? 'failed' : '', code: failed ? 1 : 0, killed: false };
	});
	const api = {
		exec,
		on: vi.fn((_event: string, callback: StartHandler) => {
			handler = callback;
		}),
		registerCommand: vi.fn(),
	};
	const notify = vi.fn(() => warning.resolve());
	// Only the API and context members exercised by this extension exist in these test doubles.
	attention(api as unknown as ExtensionAPI);
	const ctx = { mode: 'tui', ui: { notify } } as unknown as ExtensionContext;
	if (!handler) throw new Error('Missing tool_execution_start handler');
	const start = handler;
	return {
		exec,
		notify,
		api,
		notificationSent: notification.promise,
		fallbackSent: fallback.promise,
		warningShown: warning.promise,
		fire: (toolName = 'ask_user_question', context = ctx) =>
			start(
				{
					type: 'tool_execution_start',
					toolName,
					toolCallId: 'question-1',
					args: { question: 'Continue?' },
				},
				context,
			),
		ctx,
	};
}

describe('Pi event integration', () => {
	it('notifies and plays sound for a question in a hidden window', async () => {
		const { fire, exec, notificationSent } = setup();
		await fire();
		await notificationSent;
		expect(exec).toHaveBeenCalledWith(
			'terminal-notifier',
			expect.arrayContaining(['Continue?', '-activate', 'org.alacritty', '-execute']),
			{ timeout: 3000 },
		);
		expect(exec).toHaveBeenCalledWith('/usr/bin/afplay', expect.any(Array), { timeout: 10000 });
	});

	it('opens the question without waiting for sound playback to finish', async () => {
		const sound = eventSignal();
		const { fire, notificationSent } = setup({ sound: sound.promise });
		try {
			await expect(fire()).resolves.toBeUndefined();
			await notificationSent;
		} finally {
			sound.resolve();
		}
	});

	it('does not notify for a visible window', async () => {
		const { fire, exec } = setup({ clients: '@2\t%2\tattached,focused' });
		await fire();
		expect(exec).toHaveBeenCalledTimes(4);
		expect(
			exec.mock.calls.some(
				([command]) => command === 'terminal-notifier' || command === '/usr/bin/afplay',
			),
		).toBe(false);
	});

	it('notifies after Alt-Tab even if the same tmux window remains focused', async () => {
		const { fire, exec, notificationSent } = setup({
			clients: '@2\t%2\tattached,focused',
			frontmostApp: 'com.apple.finder',
		});
		await fire();
		await notificationSent;
		expect(exec).toHaveBeenCalledWith('terminal-notifier', expect.any(Array), { timeout: 3000 });
	});

	it('falls back without cancelling the question when terminal-notifier fails', async () => {
		const { fire, exec, notify, fallbackSent } = setup({ fail: 'terminal-notifier' });
		await fire();
		await fallbackSent;
		expect(exec).toHaveBeenCalledWith('/usr/bin/osascript', expect.arrayContaining(['Continue?']), {
			timeout: 3000,
		});
		expect(notify).not.toHaveBeenCalled();
	});

	it('uses the configured terminal bundle ID', async () => {
		vi.stubEnv('PI_ATTENTION_TERMINAL_BUNDLE_ID', 'com.googlecode.iterm2');
		const { fire, exec } = setup({
			clients: '@2\t%2\tattached,focused',
			frontmostApp: 'com.googlecode.iterm2',
		});
		await fire();
		expect(exec).toHaveBeenCalledTimes(4);
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

	it.each(['tmux', '/usr/bin/osascript', '/usr/bin/afplay'])(
		'never cancels the question when %s fails',
		async (fail) => {
			const { fire, notify, warningShown } = setup({ fail });
			await expect(fire()).resolves.toBeUndefined();
			await warningShown;
			expect(notify).toHaveBeenCalledWith(expect.stringContaining('failed'), 'warning');
		},
	);

	it('warns once when focus-events is off', async () => {
		const { fire, notify } = setup({ clients: '@2\t%2\tattached', focusEvents: 'off' });
		await fire();
		await fire();
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it('does not register slash commands', () => {
		const { api } = setup();
		expect(api.registerCommand).not.toHaveBeenCalled();
	});
});
