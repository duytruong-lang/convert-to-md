// lib/ai/gemini.ts
// Gemini AI wrapper: vision cho hình ảnh (DOCX flow) + PDF → markdown
// Interface AIVisionProvider đặt sẵn để sau thêm OpenAI/Anthropic

import fs from 'fs/promises';
import { getSetting } from '@/lib/settings';

// ─── Provider interface (extensible) ─────────────────────────────────────────

export interface AIVisionProvider {
  describeImage(imagePath: string, prompt: string): Promise<{ description: string; shortAlt: string }>;
  convertPdf(pdfPath: string, prompt: string): Promise<string>; // trả markdown
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 60_000;
const DELAY_MS = 200;
const RATE_LIMIT_DELAY_MS = 2_000;
const RATE_LIMIT_PAUSE_MS = 30_000;
const MAX_RETRIES = 3;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// M6: Sanitize error messages trước khi log — xóa API key nếu xuất hiện trong error
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/key=[A-Za-z0-9_-]+/gi, 'key=***')
    .replace(/AIza[A-Za-z0-9_-]{35,}/g, 'AIza***')
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer ***');
}

async function getApiKey(): Promise<string> {
  // DB trước → .env fallback
  const dbKey = await getSetting('ai_api_key');
  if (dbKey) return dbKey;

  const envKey = process.env.GEMINI_API_KEY;
  if (envKey) return envKey;

  throw new Error('Chưa cấu hình API key. Vào /settings để nhập.');
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('[Timeout]')), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (e) {
    clearTimeout(timer!);
    throw e;
  }
}

// ─── Gemini implementation ────────────────────────────────────────────────────


// ─── OpenAI/9router API Caller ────────────────────────────────────────────────
async function callOpenAICompatibleAPI(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: any[]
): Promise<string> {
  const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API Error [${res.status}]: ${txt}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('Đầu ra không hợp lệ từ API');
  }
  return text.trim();
}

class GeminiProvider implements AIVisionProvider {
  async describeImage(
    imagePath: string,
    prompt: string
  ): Promise<{ description: string; shortAlt: string }> {
    const provider = await getSetting('ai_provider');
    if (provider === '9router') {
      const apiKey = await getApiKey();
      const model = await getSetting('ai_model') || 'fast-and-cheap-stack';
      const endpoint = await getSetting('ai_endpoint') || 'https://9router.congdongnguoidien.com/v1';

      const imageBuffer = await fs.readFile(imagePath);
      const base64 = imageBuffer.toString('base64');
      const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`
              }
            }
          ]
        }
      ];

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const text = await withTimeout(
            callOpenAICompatibleAPI(endpoint, apiKey, model, messages),
            TIMEOUT_MS
          );
          const lines = text.split('\n').filter(l => l.trim());
          const shortAlt = lines[0]?.slice(0, 100) ?? 'Hình minh họa';
          await sleep(DELAY_MS);
          return { description: text, shortAlt };
        } catch (err) {
          console.error(`[9router] describeImage fail attempt ${attempt}:`, sanitizeError(err));
          if (attempt >= 1) break;
          await sleep(DELAY_MS);
        }
      }
      return { description: '[Không thể mô tả hình này]', shortAlt: 'Hình minh họa' };
    }
    const apiKey = await getApiKey();
    const model = await getSetting('ai_model');

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model: model || 'gemini-2.5-pro' });

    const imageBuffer = await fs.readFile(imagePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    let consecutiveFails = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await withTimeout(
          geminiModel.generateContent([
            { inlineData: { data: base64, mimeType } },
            prompt,
          ]),
          TIMEOUT_MS
        );

        const text = result.response.text().trim();
        const lines = text.split('\n').filter(l => l.trim());
        const shortAlt = lines[0]?.slice(0, 100) ?? 'Hình minh họa';

        await sleep(DELAY_MS);
        return { description: text, shortAlt };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
        const isTimeout = msg.includes('[Timeout]');

        if (isRateLimit) {
          consecutiveFails++;
          if (consecutiveFails >= 3) {
            console.warn('[Gemini] Rate limit liên tiếp 3 lần — pause 30s');
            await sleep(RATE_LIMIT_PAUSE_MS);
            consecutiveFails = 0;
          } else {
            await sleep(RATE_LIMIT_DELAY_MS);
          }
          continue;
        }

        if (isTimeout && attempt === 0) {
          console.warn('[Gemini] Timeout — retry 1 lần');
          continue;
        }

        // Lỗi khác hoặc đã retry đủ lần
        console.error(`[Gemini] describeImage fail attempt ${attempt}:`, sanitizeError(err));
        if (attempt >= 1) break;
      }
    }

    return { description: '[Không thể mô tả hình này]', shortAlt: 'Hình minh họa' };
  }

  async convertPdf(pdfPath: string, prompt: string): Promise<string> {
    const provider = await getSetting('ai_provider');
    if (provider === '9router') {
      const apiKey = await getApiKey();
      const model = await getSetting('ai_model') || 'reasoning-stack';
      const endpoint = await getSetting('ai_endpoint') || 'https://9router.congdongnguoidien.com/v1';

      let extractedText = '';
      try {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('pdftotext', [
          '-layout',
          '-enc', 'UTF-8',
          pdfPath,
          '-',
        ], { maxBuffer: 200 * 1024 * 1024 });
        extractedText = stdout;
      } catch (err) {
        console.warn('[9router] pdftotext failed or missing, PDF direct text extraction skipped:', err);
        throw new Error(
          'Không thể trích xuất văn bản từ PDF. Vui lòng cài pdftotext (brew install poppler) hoặc sử dụng chế độ Vision Mode.'
        );
      }

      const messages = [
        {
          role: 'user',
          content: `${prompt}\n\n[PDF Text Content extracted from file:]\n\n${extractedText}`
        }
      ];

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const timeoutMs = TIMEOUT_MS * (attempt + 1);
        try {
          const text = await withTimeout(
            callOpenAICompatibleAPI(endpoint, apiKey, model, messages),
            timeoutMs
          );
          await sleep(DELAY_MS);
          return text;
        } catch (err) {
          console.error(`[9router] convertPdf fail attempt ${attempt}:`, sanitizeError(err));
          if (attempt >= MAX_RETRIES) throw err;
          await sleep(DELAY_MS);
        }
      }
      throw new Error('9router không thể convert PDF.');
    }
    const apiKey = await getApiKey();
    const model = await getSetting('ai_model');

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model: model || 'gemini-2.5-pro' });

    const pdfBuffer = await fs.readFile(pdfPath);
    const base64 = pdfBuffer.toString('base64');

    let consecutiveFails = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Progressive timeout: 60s → 120s → 180s — PDF trang dày cần thêm thời gian
      const timeoutMs = TIMEOUT_MS * (attempt + 1);

      try {
        const result = await withTimeout(
          geminiModel.generateContent([
            { inlineData: { data: base64, mimeType: 'application/pdf' } },
            prompt,
          ]),
          timeoutMs
        );

        await sleep(DELAY_MS);
        return result.response.text().trim();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
        const isTimeout = msg.includes('[Timeout]');

        if (isRateLimit) {
          consecutiveFails++;
          if (consecutiveFails >= 3) {
            await sleep(RATE_LIMIT_PAUSE_MS);
            consecutiveFails = 0;
          } else {
            await sleep(RATE_LIMIT_DELAY_MS);
          }
          continue;
        }

        if (isTimeout && attempt < MAX_RETRIES) {
          console.warn(`[Gemini] convertPdf timeout sau ${timeoutMs / 1000}s — retry với ${TIMEOUT_MS * (attempt + 2) / 1000}s`);
          continue;
        }

        console.error(`[Gemini] convertPdf fail attempt ${attempt}:`, sanitizeError(err));
        if (attempt >= MAX_RETRIES) throw err;
      }
    }

    throw new Error('Gemini không thể convert PDF sau nhiều lần thử.');
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────────

export const aiProvider: AIVisionProvider = new GeminiProvider();

// ─── Convenience exports ───────────────────────────────────────────────────────

export async function describeImage(
  imagePath: string
): Promise<{ description: string; shortAlt: string }> {
  const prompt = await getSetting('ai_image_prompt');
  return aiProvider.describeImage(imagePath, prompt);
}

// ─── Parallel batch describe ───────────────────────────────────────────────────
// Gọi song song tối đa `concurrency` request cùng lúc, delay 300ms giữa các chunk.
// Nếu 1 hình fail → trả fallback, không fail toàn batch. Kết quả theo đúng thứ tự input.

export async function describeImages(
  imagePaths: string[],
  concurrency = 5,
  onChunkDone?: (done: number, total: number) => void,
): Promise<Array<{ description: string; shortAlt: string }>> {
  const total = imagePaths.length;
  const results: Array<{ description: string; shortAlt: string }> = [];
  const prompt = await getSetting('ai_image_prompt');

  for (let i = 0; i < total; i += concurrency) {
    const chunk = imagePaths.slice(i, i + concurrency);

    const chunkResults = await Promise.allSettled(
      chunk.map(imagePath => aiProvider.describeImage(imagePath, prompt))
    );

    for (const r of chunkResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        console.error('[Gemini] describeImages item failed:', r.reason);
        results.push({ description: '[Không thể mô tả hình này]', shortAlt: 'Hình minh họa' });
      }
    }

    const done = Math.min(i + concurrency, total);
    onChunkDone?.(done, total);

    // Delay giữa các chunk (trừ chunk cuối) để tránh rate limit
    if (i + concurrency < total) {
      await sleep(300);
    }
  }

  return results;
}

export async function convertPdfWithAI(
  pdfPath: string
): Promise<string> {
  // X4: PDF conversion chỉ hỗ trợ Gemini — throw lỗi rõ ràng cho provider khác
  const provider = await getSetting('ai_provider');
  if (provider !== 'gemini' && provider !== '9router') {
    throw new Error(
      `PDF conversion với "${provider}" chưa được hỗ trợ. ` +
      'Vui lòng chuyển về Gemini hoặc 9router trong /settings để convert PDF.'
    );
  }

  const prompt = await getSetting('ai_pdf_prompt');
  return aiProvider.convertPdf(pdfPath, prompt);
}

// ─── Vision mode: full-page screenshot → detailed markdown ─────────────────────
// Dùng cho artwork-heavy presentations: AI nhìn toàn bộ page (text + images + layout)

export async function describePageImage(
  imagePath: string,
  pageNumber: number,
  totalPages: number,
  extractedText?: string,
): Promise<string> {
  const provider = await getSetting('ai_provider');
  if (provider === '9router') {
    const basePrompt = await getSetting('ai_vision_prompt');
    const textLayerContext = extractedText?.trim()
      ? `\n\n[PDF text layer extracted from this page — use this to improve transcription accuracy, but trust the image for layout and visuals:]\n\n${extractedText.trim()}`
      : '';
    const contextPrompt = `${basePrompt}\n\n[Context: This is page ${pageNumber} of ${totalPages}]${textLayerContext}`;

    const apiKey = await getApiKey();
    const model = await getSetting('ai_model') || 'fast-and-cheap-stack';
    const endpoint = await getSetting('ai_endpoint') || 'https://9router.congdongnguoidien.com/v1';

    const imageBuffer = await fs.readFile(imagePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = 'image/png';

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: contextPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`
            }
          }
        ]
      }
    ];

    const VISION_TIMEOUT_MS = 90_000;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const timeoutMs = VISION_TIMEOUT_MS * (attempt + 1);
      try {
        const text = await withTimeout(
          callOpenAICompatibleAPI(endpoint, apiKey, model, messages),
          timeoutMs
        );
        await sleep(DELAY_MS);
        return text;
      } catch (err) {
        console.error(`[9router] Page ${pageNumber} fail attempt ${attempt}:`, sanitizeError(err));
        if (attempt >= MAX_RETRIES) break;
        await sleep(DELAY_MS);
      }
    }
    return `> **[Không thể phân tích trang ${pageNumber}]** — vui lòng thử lại hoặc dùng model mạnh hơn.`;
  }

  if (provider !== 'gemini') {
    throw new Error('Vision mode yêu cầu Gemini. Chuyển provider trong /settings.');
  }

  const basePrompt = await getSetting('ai_vision_prompt');
  const textLayerContext = extractedText?.trim()
    ? `\n\n[PDF text layer extracted from this page — use this to improve transcription accuracy, but trust the image for layout and visuals:]\n\n${extractedText.trim()}`
    : '';
  const contextPrompt = `${basePrompt}\n\n[Context: This is page ${pageNumber} of ${totalPages}]${textLayerContext}`;

  const apiKey = await getApiKey();
  const model = await getSetting('ai_model');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model: model || 'gemini-2.5-pro' });

  const imageBuffer = await fs.readFile(imagePath);
  const base64 = imageBuffer.toString('base64');

  const VISION_TIMEOUT_MS = 90_000; // 90s — high-res images take longer
  let consecutiveFails = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const timeoutMs = VISION_TIMEOUT_MS * (attempt + 1);

    try {
      const result = await withTimeout(
        geminiModel.generateContent([
          { inlineData: { data: base64, mimeType: 'image/png' } },
          contextPrompt,
        ]),
        timeoutMs
      );

      await sleep(DELAY_MS);
      return result.response.text().trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      const isTimeout = msg.includes('[Timeout]');

      if (isRateLimit) {
        consecutiveFails++;
        if (consecutiveFails >= 3) {
          console.warn(`[Vision] Rate limit 3x — pause 30s (page ${pageNumber})`);
          await sleep(RATE_LIMIT_PAUSE_MS);
          consecutiveFails = 0;
        } else {
          await sleep(RATE_LIMIT_DELAY_MS);
        }
        continue;
      }

      if (isTimeout && attempt < MAX_RETRIES) {
        console.warn(`[Vision] Timeout page ${pageNumber} after ${timeoutMs / 1000}s — retry`);
        continue;
      }

      console.error(`[Vision] Page ${pageNumber} fail attempt ${attempt}:`, sanitizeError(err));
      if (attempt >= MAX_RETRIES) break;
    }
  }

  return `> **[Không thể phân tích trang ${pageNumber}]** — vui lòng thử lại hoặc dùng model mạnh hơn.`;
}

