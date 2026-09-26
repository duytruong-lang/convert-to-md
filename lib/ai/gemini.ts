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

  const provider = await getSetting('ai_provider');
  if (provider === '9router') {
    const env9RouterKey = process.env.NINE_ROUTER_API_KEY;
    if (env9RouterKey) return env9RouterKey;
  }

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


// ─── OpenAI/9router API Caller with Exponential Backoff ───────────────────────
export interface OpenAICompatibleOptions {
  maxTokens?: number;
}

const RETRY_STATUS_CODES = new Set([429, 502, 503, 504]);

class OpenAICompatibleApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'OpenAICompatibleApiError';
  }
}

function contentToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map(part => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : '')
    .join('');
}

function parseCompletionBody(body: string, contentType: string): string {
  const trimmed = body.trim();
  const isSse = contentType.includes('text/event-stream') || trimmed.startsWith('data:');

  if (isSse) {
    const chunks: string[] = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        throw new OpenAICompatibleApiError('Phản hồi SSE từ API không phải JSON hợp lệ.');
      }
      if (event.error) {
        const message = typeof event.error === 'string' ? event.error : event.error.message;
        throw new OpenAICompatibleApiError(`API Error: ${message || 'Lỗi không xác định từ API.'}`);
      }
      const choice = event.choices?.[0];
      const text = contentToText(choice?.delta?.content ?? choice?.message?.content);
      if (text) chunks.push(text);
    }
    const result = chunks.join('').trim();
    if (!result) throw new OpenAICompatibleApiError('Phản hồi SSE không có nội dung văn bản.');
    return result;
  }

  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new OpenAICompatibleApiError('Phản hồi từ API không phải JSON hợp lệ.');
  }
  if (data.error) {
    const message = typeof data.error === 'string' ? data.error : data.error.message;
    throw new OpenAICompatibleApiError(`API Error: ${message || 'Lỗi không xác định từ API.'}`);
  }
  const text = contentToText(data.choices?.[0]?.message?.content);
  if (!text) throw new OpenAICompatibleApiError('Đầu ra không hợp lệ từ API (thiếu message.content)');
  return text.trim();
}

export async function callOpenAICompatibleAPI(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: any[],
  options?: OpenAICompatibleOptions
): Promise<string> {
  const url = endpoint.endsWith('/chat/completions')
    ? endpoint
    : `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  const payload: Record<string, any> = {
    model: model,
    messages: messages,
  };

  // Chỉ thêm max_tokens nếu được chỉ định tường minh (vd: ping test hoặc giới hạn cụ thể).
  // Nếu không truyền, để undefined để Policy Gateway không ép trần và model upstream sinh full output.
  if (options?.maxTokens !== undefined) {
    payload.max_tokens = options.maxTokens;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new OpenAICompatibleApiError(`Không thể kết nối đến API: ${sanitizeError(err)}`);
      }
      const backoffMs = 1500 * Math.pow(2, attempt);
      console.warn(`[9router] Network error attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${sanitizeError(err)}. Retry sau ${backoffMs}ms...`);
      await sleep(backoffMs);
      continue;
    }

    if (!res.ok) {
      const status = res.status;
      const errText = await res.text().catch(() => '');
      if (!RETRY_STATUS_CODES.has(status) || attempt === MAX_RETRIES) {
        throw new OpenAICompatibleApiError(`API Error [${status}]: ${errText}`, status);
      }
      const retryAfterHeader = res.headers.get('retry-after');
      let backoffMs = 1500 * Math.pow(2, attempt);
      if (retryAfterHeader) {
        const parsedSeconds = Number.parseInt(retryAfterHeader, 10);
        if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
          backoffMs = Math.min(parsedSeconds * 1000, 10000);
        }
      }
      console.warn(
        `[9router] HTTP ${status}. Retry sau ${backoffMs}ms (lần thử ${attempt + 1}/${MAX_RETRIES + 1}). Error: ${sanitizeError(errText)}`
      );
      await sleep(backoffMs);
      continue;
    }

    const body = await res.text();
    return parseCompletionBody(body, res.headers.get('content-type') || '');
  }
  throw new OpenAICompatibleApiError('Không thể kết nối đến 9Router API sau nhiều lần thử.');
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
          if (err instanceof OpenAICompatibleApiError) break;
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
          if (err instanceof OpenAICompatibleApiError) throw err;
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
        if (err instanceof OpenAICompatibleApiError) break;
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
