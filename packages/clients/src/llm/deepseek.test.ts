import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDeepseekClient } from './deepseek.js';

const originalFetch = globalThis.fetch;

function mockFetch(response: {
  ok: boolean;
  status: number;
  body: unknown;
}): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
    text: async () =>
      typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
  })) as unknown as typeof fetch;
}

function client() {
  return makeDeepseekClient({
    apiKey: 'deepseek-key',
    baseUrl: 'https://api.deepseek.test/v1',
    textModel: 'deepseek-v4-flash',
  });
}

describe('makeDeepseekClient.generateText', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns assistant content when DeepSeek sends normal content', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        choices: [
          {
            message: { content: ' Photons carry electromagnetic radiation. ' },
            finish_reason: 'stop',
          },
        ],
      },
    });

    const result = await client().generateText('One sentence on photons.');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('Photons carry electromagnetic radiation.');
    }
  });

  it('uses reasoning_content when content is empty but reasoning_content is present', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        choices: [
          {
            message: { content: '', reasoning_content: 'Reasoning fallback summary.' },
            finish_reason: 'stop',
          },
        ],
      },
    });

    const result = await client().generateText('Summarize this paper.');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('Reasoning fallback summary.');
    }
  });

  it('returns deepseek_truncated when both content fields are empty and finish_reason is length', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: {
        choices: [
          {
            message: { content: '', reasoning_content: '' },
            finish_reason: 'length',
          },
        ],
      },
    });

    const result = await client().generateText('Summarize this paper.');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('deepseek_truncated');
      expect(result.error.detail).toMatchObject({ finishReason: 'length' });
    }
  });

  it('returns a structured AppError with a truncated raw body for non-200 responses', async () => {
    const rawBody = `bad model ${'x'.repeat(700)}`;
    mockFetch({
      ok: false,
      status: 400,
      body: rawBody,
    });

    const result = await client().generateText('One sentence on photons.');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('deepseek_http_error');
      expect(result.error.detail).toMatchObject({ status: 400 });
      expect((result.error.detail as { body: string }).body).toHaveLength(500);
      expect((result.error.detail as { body: string }).body).toBe(rawBody.slice(0, 500));
    }
  });
});
