// app/api/settings/test/__tests__/route.test.ts
// Tests for POST /api/settings/test

jest.mock('@/lib/settings', () => ({
  getSetting: jest.fn(),
}));

import { POST } from '../route';
import { getSetting } from '@/lib/settings';

const mockGetSetting = getSetting as jest.MockedFunction<any>;

// Mock global fetch
const originalFetch = global.fetch;

describe('POST /api/settings/test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns 400 if api_key is missing', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'ai_provider') return '9router';
      if (key === 'ai_api_key') return '';
      return '';
    });

    const res = await POST();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/Chưa nhập API key/);
  });

  it('tests 9router connection successfully', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'ai_provider') return '9router';
      if (key === 'ai_api_key') return 'test-9router-key';
      if (key === 'ai_model') return 'reasoning-stack';
      if (key === 'ai_endpoint') return 'https://9router.congdongnguoidien.com/v1';
      return '';
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'reasoning-stack' }] }),
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('9router');
    expect(body.message).toContain('reasoning-stack');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://9router.congdongnguoidien.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-9router-key',
        }),
      })
    );
  });

  it('falls back to chat completions only when /models is unsupported', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'ai_provider') return '9router';
      if (key === 'ai_api_key') return 'test-9router-key';
      if (key === 'ai_model') return 'reasoning-stack';
      if (key === 'ai_endpoint') return 'https://9router.congdongnguoidien.com/v1';
      return '';
    });

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://9router.congdongnguoidien.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('does not fall back to a paid request for a 5xx /models error', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'ai_provider') return '9router';
      if (key === 'ai_api_key') return 'test-9router-key';
      if (key === 'ai_model') return 'reasoning-stack';
      if (key === 'ai_endpoint') return 'https://9router.congdongnguoidien.com/v1';
      return '';
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Temporarily unavailable',
    });

    const res = await POST();
    expect(res.status).toBe(400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles 9router connection error properly', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'ai_provider') return '9router';
      if (key === 'ai_api_key') return 'invalid-key';
      if (key === 'ai_model') return 'fast-and-cheap-stack';
      if (key === 'ai_endpoint') return 'https://9router.congdongnguoidien.com/v1';
      return '';
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
    });

    const res = await POST();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('401');
    expect(body.message).toContain('Invalid API key');
  });

  it('returns 400 for unknown provider', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'ai_provider') return 'unknown_provider';
      if (key === 'ai_api_key') return 'some-key';
      return '';
    });

    const res = await POST();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('chưa được hỗ trợ kiểm tra');
  });
});
