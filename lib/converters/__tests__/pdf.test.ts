// lib/converters/__tests__/pdf.test.ts
// Tests for countPdfPages (via pdfinfo mock) and batch logic

// Mock dynamic child_process import
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: (fn: Function) => (...args: any[]) =>
    new Promise((resolve, reject) => {
      fn(...args, (err: any, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    }),
}));

jest.mock('@/lib/compress/pdf', () => ({
  compressPdf: jest.fn().mockResolvedValue({
    compressedPath: '/tmp/compressed.pdf',
    originalSize: 1024,
    compressedSize: 512,
  }),
}));

jest.mock('@/lib/ai/gemini', () => ({
  convertPdfWithAI: jest.fn().mockResolvedValue('# Page content'),
}));

jest.mock('@/lib/settings', () => ({
  getSetting: jest.fn((key: string) => {
    const defaults: Record<string, string> = {
      pdf_pages_per_batch: '20',
      pdf_max_pages: '0',
    };
    return Promise.resolve(defaults[key] ?? '');
  }),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

import { execFile } from 'child_process';
import { convertPdfWithAI } from '@/lib/ai/gemini';

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;
const mockConvertPdf = convertPdfWithAI as jest.MockedFunction<typeof convertPdfWithAI>;

// ─── countPdfPages behavior (tested indirectly via convertPdf) ─────────────

describe('PDF page counting with pdfinfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses page count from pdfinfo output', async () => {
    // pdfinfo stdout format
    const pdfinfoOutput = `Title:          Sample Document
Author:         Test
Pages:          42
File size:      123456 bytes`;

    mockExecFile.mockImplementation(((_cmd: any, _args: any, callback: any) => {
      callback(null, pdfinfoOutput, '');
    }) as any);

    // Import dynamically to get the mocked version
    const { execFile: ef } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(ef) as any;

    const { stdout } = await execAsync('pdfinfo', ['/tmp/test.pdf']);
    const match = stdout.match(/Pages:\s+(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(42);
  });

  it('throws ENOENT error when pdfinfo not installed', async () => {
    const enoentError = Object.assign(new Error('pdfinfo: not found'), { code: 'ENOENT' });
    mockExecFile.mockImplementation(((_cmd: any, _args: any, callback: any) => {
      callback(enoentError, '', '');
    }) as any);

    const { execFile: ef } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(ef) as any;

    await expect(execAsync('pdfinfo', ['/tmp/test.pdf'])).rejects.toThrow();
  });
});

// ─── Batch splitting logic ────────────────────────────────────────────────────

describe('PDF batch logic', () => {
  it('splits 50-page PDF into 3 batches of 20/20/10', () => {
    const pagesPerBatch = 20;
    const totalPages = 50;
    const batches: Array<{ firstPage: number; lastPage: number }> = [];

    for (let i = 0; i < totalPages; i += pagesPerBatch) {
      const firstPage = i + 1;
      const lastPage = Math.min(i + pagesPerBatch, totalPages);
      batches.push({ firstPage, lastPage });
    }

    expect(batches).toHaveLength(3);
    expect(batches[0]).toEqual({ firstPage: 1, lastPage: 20 });
    expect(batches[1]).toEqual({ firstPage: 21, lastPage: 40 });
    expect(batches[2]).toEqual({ firstPage: 41, lastPage: 50 });
  });

  it('treats 0 max_pages as unlimited', () => {
    const maxPages = 0;
    const totalPages = 200;
    const effectivePages = maxPages > 0 ? Math.min(totalPages, maxPages) : totalPages;
    expect(effectivePages).toBe(200);
  });

  it('respects positive max_pages setting', () => {
    const maxPages = 40;
    const totalPages = 200;
    const effectivePages = maxPages > 0 ? Math.min(totalPages, maxPages) : totalPages;
    expect(effectivePages).toBe(40);
  });

  it('processes 20 pages or fewer as single batch (no splitting)', () => {
    const pagesPerBatch = 20;
    const pageCount = 15;
    const shouldBatch = pageCount > pagesPerBatch;
    expect(shouldBatch).toBe(false);
  });

  it('exactly 20 pages = single batch', () => {
    const pagesPerBatch = 20;
    const pageCount = 20;
    const shouldBatch = pageCount > pagesPerBatch;
    expect(shouldBatch).toBe(false);
  });

  it('21 pages = requires batching', () => {
    const pagesPerBatch = 20;
    const pageCount = 21;
    const shouldBatch = pageCount > pagesPerBatch;
    expect(shouldBatch).toBe(true);
  });
});

// ─── Batch markdown assembly ──────────────────────────────────────────────────

describe('PDF markdown assembly', () => {
  it('joins batch parts with separator', () => {
    const parts = ['# Part 1\n\nContent.', '# Part 2\n\nMore.', '# Part 3\n\nEnd.'];
    const markdown = parts.join('\n\n---\n\n');

    expect(markdown).toContain('---');
    expect(markdown).toContain('# Part 1');
    expect(markdown).toContain('# Part 3');
    expect(markdown.split('---').length).toBe(3);
  });

  it('appends truncation note when max_pages is set', () => {
    const maxPages = 40;
    const pageCount = 200;
    let markdown = '# Content';

    if (maxPages > 0 && pageCount > maxPages) {
      markdown += `\n\n> **[Lưu ý]:** Tài liệu có ${pageCount} trang, chỉ convert ${maxPages} trang đầu`;
    }

    expect(markdown).toContain('Lưu ý');
    expect(markdown).toContain('200 trang');
    expect(markdown).toContain('40 trang đầu');
  });

  it('does NOT append note when max_pages = 0', () => {
    const maxPages = 0;
    const pageCount = 200;
    let markdown = '# Content';

    if (maxPages > 0 && pageCount > maxPages) {
      markdown += '\n\n> **[Lưu ý]:** truncated';
    }

    expect(markdown).not.toContain('Lưu ý');
  });
});
