import { describe, expect, it, vi } from 'vitest';
import type { RunCommand, TmuxWindow } from '../src/attention.js';
import { inspectFocus, isVisible, questionText, sendAttention } from '../src/attention.js';

const window: TmuxWindow = { id: '@2', index: '1', pane: '%11', zoomed: false };

describe('tmux visibility', () => {
	it.each([
		['same window and focused', '@2\t%11\tattached,focused,UTF-8', true, true],
		['another visible split', '@2\t%2\tattached,focused,UTF-8', true, true],
		['different window', '@3\t%12\tattached,focused,UTF-8', true, false],
		['unfocused terminal', '@2\t%11\tattached,UTF-8', true, false],
		['no attached clients', '', true, false],
		['control-mode client', '@2\t%11\tattached,focused,control-mode', true, false],
		['focus tracking disabled', '@2\t%11\tattached,UTF-8', false, true],
		['second client sees window', '@3\t%12\tattached,focused\n@2\t%2\tattached,focused', true, true],
	])('%s', (_name, clients, tracksFocus, visible) => {
		expect(isVisible(window, clients, tracksFocus)).toBe(visible);
	});

	it('notifies when a different pane is zoomed', () => {
		expect(isVisible({ ...window, zoomed: true }, '@2\t%2\tattached,focused', true)).toBe(false);
	});

	it('suppresses notifications when the agent pane is zoomed', () => {
		expect(isVisible({ ...window, zoomed: true }, '@2\t%11\tattached,focused', true)).toBe(true);
	});

	it('rejects malformed client output', () => {
		expect(() => isVisible(window, 'bad output', true)).toThrow('client format');
	});
});

describe('focus inspection', () => {
	function mockRun(target = '@2\t1\t%11\t0', focusEvents = 'on') {
		return vi.fn<RunCommand>(async (_command, args) => {
			if (args[0] === 'display-message') return target;
			if (args[0] === 'list-clients') return '@2\t%2\tattached,focused';
			return focusEvents;
		});
	}

	it('targets the agent pane rather than the active pane', async () => {
		const run = mockRun();
		await expect(inspectFocus(run, '%11')).resolves.toEqual({
			window, tracksTerminalFocus: true, visible: true,
		});
		expect(run.mock.calls[0]?.[1]).toContain('%11');
	});

	it('reports disabled focus tracking', async () => {
		await expect(inspectFocus(mockRun(undefined, 'off'), '%11')).resolves.toMatchObject({
			tracksTerminalFocus: false,
		});
	});

	it.each(['bad', '@2\t1\t%11\t', '@2\t1\t%99\t0'])('rejects invalid target %s', async (target) => {
		await expect(inspectFocus(mockRun(target), '%11')).rejects.toThrow();
	});

	it('propagates a tmux failure', async () => {
		const run = vi.fn<RunCommand>().mockRejectedValue(new Error('server unavailable'));
		await expect(inspectFocus(run, '%11')).rejects.toThrow('server unavailable');
	});
});

describe('macOS attention', () => {
	it('passes question text as argv, never as AppleScript source', async () => {
		const run = vi.fn<RunCommand>().mockResolvedValue('');
		const question = 'Choose "yes"; do shell script "touch /tmp/injected"';
		await sendAttention(run, question, 'tmux window 1');
		const notification = run.mock.calls.find(([command]) => command.endsWith('osascript'));
		expect(notification?.[1][1]).not.toContain(question);
		expect(notification?.[1].slice(-3)).toEqual(['--', question, 'tmux window 1']);
		expect(run).toHaveBeenCalledWith('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff']);
	});

	it('strips control characters and bounds notification length', async () => {
		const run = vi.fn<RunCommand>().mockResolvedValue('');
		await sendAttention(run, `\x1b\n${'x'.repeat(300)}`, 'test');
		expect(run.mock.calls[0]?.[1][3]).toBe('x'.repeat(180));
	});

	it.each(['/usr/bin/osascript', '/usr/bin/afplay'])('still attempts both channels if %s fails', async (failing) => {
		const run = vi.fn<RunCommand>(async (command) => {
			if (command === failing) throw new Error('permission denied');
			return '';
		});
		await expect(sendAttention(run, 'Question?', 'test')).rejects.toThrow('permission denied');
		expect(run).toHaveBeenCalledTimes(2);
	});
});

describe('question text', () => {
	it('uses the tool question', () => {
		expect(questionText({ question: 'Which option?' })).toBe('Which option?');
	});

	it.each([null, undefined, {}, { question: 123 }, { question: '  ' }])('handles missing question %j', (args) => {
		expect(questionText(args)).toBe('Your agent is waiting for an answer.');
	});
});
