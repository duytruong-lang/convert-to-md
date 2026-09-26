// lib/ai/__tests__/nine-router.test.ts
// Tests for callOpenAICompatibleAPI (9Router integration)

// Mock @/lib/settings so it doesn't load prisma or DB
jest.mock('@/lib/settings', () => ({
  getSetting: jest.fn((key: string) => {
    const defaults: Record<string, string> = {
      ai_api_key: 'test-key',
      ai_model: 'fast-and-cheap-stack',
      ai_provider: '9router',
      ai_endpoint: 'https://9router.congdongnguoidien.com/v1',
    };
    return Promise.resolve(defaults[key] ?? '');
  }),
}));

import { callOpenAICompatibleAPI } from '../gemini';

// Mock global fetch
const originalFetch = global.fetch;

describe('callOpenAICompatibleAPI (9Router)', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('omits max_tokens from payload when options.maxTokens is undefined', async () => {
    let capturedBody: any = null;

    global.fetch = jest.fn().mockImplementation((url, init) => {
      capturedBody = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: 'Generated markdown content without limit' } }],
        })),
      });
    });

    const result = await callOpenAICompatibleAPI(
      'https://9router.congdongnguoidien.com/v1',
      'test-key',
      'fast-and-cheap-stack',
      [{ role: 'user', content: 'Convert this' }]
    );

    expect(result).toBe('Generated markdown content without limit');
    expect(capturedBody).toBeDefined();
    expect(capturedBody.model).toBe('fast-and-cheap-stack');
    expect(capturedBody.max_tokens).toBeUndefined(); // Crucial: verified not hardcoded
  });

  it('includes max_tokens in payload when options.maxTokens is provided', async () => {
    let capturedBody: any = null;

    global.fetch = jest.fn().mockImplementation((url, init) => {
      capturedBody = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: 'Pong' } }],
        })),
      });
    });

    const result = await callOpenAICompatibleAPI(
      'https://9router.congdongnguoidien.com/v1',
      'test-key',
      'fast-and-cheap-stack',
      [{ role: 'user', content: 'Ping' }],
      { maxTokens: 16 }
    );

    expect(result).toBe('Pong');
    expect(capturedBody.max_tokens).toBe(16);
  });

  it('retries on HTTP 429 / 503 and succeeds on next attempt', async () => {
    let attempts = 0;

    global.fetch = jest.fn().mockImplementation(() => {
      attempts++;
      if (attempts === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: new Headers(),
          text: () => Promise.resolve('Rate limit exceeded'),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({
          choices: [{ message: { content: 'Success after retry' } }],
        })),
      });
    });

    const result = await callOpenAICompatibleAPI(
      'https://9router.congdongnguoidien.com/v1',
      'test-key',
      'fast-and-cheap-stack',
      [{ role: 'user', content: 'Hello' }]
    );

    expect(attempts).toBe(2);
    expect(result).toBe('Success after retry');
  });

  it('throws error when non-retryable 401 error occurs', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.resolve('Invalid API key'),
      });
    });

    await expect(
      callOpenAICompatibleAPI(
        'https://9router.congdongnguoidien.com/v1',
        'invalid-key',
        'fast-and-cheap-stack',
        [{ role: 'user', content: 'Hello' }]
      )
    ).rejects.toThrow('API Error [401]: Invalid API key');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('parses server-sent event responses with delta content', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      text: () => Promise.resolve([
        'data: {"choices":[{"delta":{"content":"Converted "}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"document"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')),
    });

    const result = await callOpenAICompatibleAPI(
      'https://9router.congdongnguoidien.com/v1',
      'test-key',
      'fast-and-cheap-stack',
      [{ role: 'user', content: 'Convert this' }]
    );

    expect(result).toBe('Converted document');
  });
});
