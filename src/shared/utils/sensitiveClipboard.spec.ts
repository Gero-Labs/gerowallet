import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copySensitiveText, SENSITIVE_CLIPBOARD_CLEAR_MS } from './sensitiveClipboard';

let board: string;
const clipboard = {
  writeText: vi.fn(async (t: string) => { board = t; }),
  readText: vi.fn(async () => board),
};

beforeEach(() => {
  board = '';
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { clipboard });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('copySensitiveText', () => {
  it('clears the clipboard once the time is up', async () => {
    await copySensitiveText('code-1 code-2');
    expect(board).toBe('code-1 code-2');
    await vi.advanceTimersByTimeAsync(SENSITIVE_CLIPBOARD_CLEAR_MS - 1);
    expect(board).toBe('code-1 code-2');
    await vi.advanceTimersByTimeAsync(1);
    expect(board).toBe('');
  });

  it('leaves alone anything the user copied in the meantime', async () => {
    await copySensitiveText('code-1 code-2');
    board = 'something else';
    await vi.advanceTimersByTimeAsync(SENSITIVE_CLIPBOARD_CLEAR_MS);
    expect(board).toBe('something else');
  });

  it('skips the clear quietly when the clipboard cannot be read', async () => {
    clipboard.readText.mockRejectedValueOnce(new Error('Document is not focused'));
    await copySensitiveText('code-1');
    await vi.advanceTimersByTimeAsync(SENSITIVE_CLIPBOARD_CLEAR_MS);
    expect(board).toBe('code-1');
  });
});
