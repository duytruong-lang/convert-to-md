// app/api/settings/route.ts
// GET /api/settings → trả tất cả settings (api_key masked)
// PUT /api/settings → update 1 hoặc nhiều settings

import { getAllSettings, setSettings } from '@/lib/settings';
import { maskApiKey } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = await getAllSettings();
    // Mask API key trước khi trả về client (S04)
    const masked = { ...settings };
    if (masked.ai_api_key) {
      masked.ai_api_key = maskApiKey(masked.ai_api_key);
    }
    return Response.json(masked);
  } catch (error) {
    console.error('[GET /api/settings]', error);
    return Response.json({ error: 'Không thể đọc settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as Record<string, string>;

    const allowedKeys = new Set([
      'ai_provider',
      'ai_api_key',
      'ai_model',
      'ai_image_prompt',
      'ai_pdf_prompt',
      'ai_vision_prompt',
      'pdf_pages_per_batch',
      'pdf_max_pages',
      'ai_endpoint',
      'pdf_vision_dpi',
    ]);

    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowedKeys.has(key) && typeof value === 'string') {
        if (key === 'pdf_vision_dpi' && !['150', '200', '300', '400'].includes(value)) {
          return Response.json({ error: 'Vision DPI phải là 150, 200, 300 hoặc 400.' }, { status: 400 });
        }
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'Không có field hợp lệ để update' }, { status: 400 });
    }

    await setSettings(updates);
    return Response.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/settings]', error);
    return Response.json({ error: 'Không thể lưu settings' }, { status: 500 });
  }
}
