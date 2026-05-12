// lib/converters/pdf-vision.ts
// PDF Vision pipeline: pdftoppm → PNG @400dpi per page + pdftotext context → Gemini Vision → assembled Markdown
// Highest detail mode — AI sees full visual layout of every page and receives the PDF text layer when available

import fs from 'fs/promises';
import path from 'path';
import { describePageImage } from '@/lib/ai/gemini';

const CONCURRENT_PAGES = 2;
const DPI = 400;

export interface PdfVisionResult {
  textOnlyMdPath: string;
  slug: string;
  pageCount: number;
  imagesDir: string;
}

// ─── Render PDF pages to PNG using pdftoppm (poppler) ─────────────────────────

async function renderPdfToImages(
  pdfPath: string,
  outputDir: string,
  dpi: number = DPI
): Promise<string[]> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const prefix = path.join(outputDir, 'page');

  try {
    await execFileAsync('pdftoppm', [
      '-png',
      '-r', String(dpi),
      pdfPath,
      prefix,
    ], { maxBuffer: 200 * 1024 * 1024 });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      throw new Error(
        'pdftoppm chưa cài. Chạy: brew install poppler\nSau đó restart server.'
      );
    }
    throw err;
  }

  const files = await fs.readdir(outputDir);
  const pngs = files
    .filter(f => f.startsWith('page-') && f.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(f => path.join(outputDir, f));

  if (pngs.length === 0) {
    throw new Error('pdftoppm không tạo được ảnh nào. File PDF có thể bị hỏng.');
  }

  return pngs;
}

// ─── Extract text layer per page using pdftotext when available ───────────────

async function extractPdfTextPages(pdfPath: string): Promise<string[]> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('pdftotext', [
      '-layout',
      '-enc', 'UTF-8',
      pdfPath,
      '-',
    ], { maxBuffer: 200 * 1024 * 1024 });

    return stdout
      .split('\f')
      .map(page => page.trim())
      .filter((page, index, pages) => page.length > 0 || index < pages.length - 1);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      console.warn('[Vision] pdftotext chưa cài — bỏ qua text-layer context. Chạy: brew install poppler');
      return [];
    }
    console.warn('[Vision] Không extract được PDF text layer — tiếp tục bằng Vision-only:', e.message);
    return [];
  }
}

function pageImageReference(imagePath: string, outputDir: string): string {
  return path.relative(outputDir, imagePath).split(path.sep).join('/');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main Vision converter ──────────────────────────────────────────────────

export async function convertPdfVision(
  pdfPath: string,
  outputDir: string,
  slug: string,
  onProgress?: (text: string) => void
): Promise<PdfVisionResult> {
  onProgress?.(`Đang render PDF thành hình ảnh ${DPI}DPI...`);
  const imagesDir = path.join(outputDir, 'vision-pages');
  await fs.mkdir(imagesDir, { recursive: true });

  const [pagePngs, textPages] = await Promise.all([
    renderPdfToImages(pdfPath, imagesDir),
    extractPdfTextPages(pdfPath),
  ]);
  const pageCount = pagePngs.length;

  onProgress?.(`Rendered ${pageCount} trang. Bắt đầu phân tích Gemini 2.5 Pro...`);

  const parts: string[] = new Array(pageCount);

  for (let i = 0; i < pageCount; i += CONCURRENT_PAGES) {
    const chunkIndices = Array.from(
      { length: Math.min(CONCURRENT_PAGES, pageCount - i) },
      (_, k) => i + k
    );

    const first = chunkIndices[0] + 1;
    const last = chunkIndices[chunkIndices.length - 1] + 1;
    onProgress?.(`Đang phân tích trang ${first}–${last}/${pageCount}...`);

    const chunkResults = await Promise.allSettled(
      chunkIndices.map(async (pageIdx) => {
        return describePageImage(
          pagePngs[pageIdx],
          pageIdx + 1,
          pageCount,
          textPages[pageIdx]
        );
      })
    );

    for (let k = 0; k < chunkIndices.length; k++) {
      const r = chunkResults[k];
      const pageIdx = chunkIndices[k];
      const pageNum = pageIdx + 1;
      const imageRef = pageImageReference(pagePngs[pageIdx], outputDir);
      const referenceBlock = `![Page ${pageNum} visual reference](${imageRef})`;

      if (r.status === 'fulfilled') {
        parts[pageIdx] = `<!-- Page ${pageNum} -->\n\n${referenceBlock}\n\n${r.value}`;
      } else {
        parts[pageIdx] = `<!-- Page ${pageNum} -->\n\n${referenceBlock}\n\n> **[Lỗi phân tích trang ${pageNum}]:** ${r.reason}\n`;
      }
    }

    if (i + CONCURRENT_PAGES < pageCount) {
      await sleep(800);
    }
  }

  const markdown = parts.join('\n\n---\n\n');
  const textOnlyMdPath = path.join(outputDir, `${slug}-text-only.md`);
  await fs.writeFile(textOnlyMdPath, markdown, 'utf-8');

  // Keep page PNGs in outputs/[conversion]/vision-pages for auditability and visual references.
  return { textOnlyMdPath, slug, pageCount, imagesDir };
}
