// lib/__tests__/upload.test.ts
// Tests for validateFile() and normalizeFilename()

import { validateFile, normalizeFilename, parseCompressLevel } from '../upload';
import path from 'path';

// ─── validateFile ─────────────────────────────────────────────────────────────

describe('validateFile', () => {
  function makeFile(name: string, size: number, type: string): File {
    const blob = new Blob(['x'.repeat(Math.min(size, 100))], { type });
    return new File([blob], name, { type });
  }

  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PDF_MIME = 'application/pdf';

  it('accepts valid .docx', () => {
    const file = makeFile('report.docx', 1024, DOCX_MIME);
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.fileType).toBe('docx');
  });

  it('accepts valid .pdf', () => {
    const file = makeFile('report.pdf', 2048, PDF_MIME);
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.fileType).toBe('pdf');
  });

  it('accepts valid .txt', () => {
    const file = makeFile('notes.txt', 512, 'text/plain');
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.fileType).toBe('txt');
  });

  it('rejects .docm (macro-enabled Word)', () => {
    const file = makeFile('evil.docm', 512, DOCX_MIME);
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/docm/i);
  });

  it('rejects file over 300MB', () => {
    const oversized = 301 * 1024 * 1024;
    const file = makeFile('big.pdf', oversized, PDF_MIME);
    // File constructor won't allocate 300MB, mock size instead
    Object.defineProperty(file, 'size', { value: oversized });
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/300MB/);
  });

  it('rejects wrong MIME type for extension', () => {
    const file = makeFile('fake.docx', 512, 'text/plain');
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/MIME/i);
  });

  it('accepts file with no MIME type (browser quirk)', () => {
    const file = makeFile('noMime.pdf', 512, '');
    const result = validateFile(file);
    // Empty MIME → should pass (we skip MIME check if type is empty)
    expect(result.valid).toBe(true);
  });

  it('accepts Vietnamese filename', () => {
    const file = makeFile('tài-liệu-SOP.docx', 1024, DOCX_MIME);
    const result = validateFile(file);
    expect(result.valid).toBe(true);
  });
});

// ─── normalizeFilename ────────────────────────────────────────────────────────

describe('normalizeFilename', () => {
  it('strips directory traversal ../../', () => {
    const name = normalizeFilename('../../etc/passwd');
    expect(name).toBe('passwd');
    expect(name).not.toContain('..');
  });

  it('strips absolute path /etc/passwd', () => {
    const name = normalizeFilename('/etc/passwd');
    expect(name).toBe('passwd');
  });

  it('normalizes NFD → NFC for Vietnamese', () => {
    // NFD: 'a' + combining accent
    const nfd = 'ta\u0300i-lie\u0323u.docx'; // NFD form
    const nfc = normalizeFilename(nfd);
    expect(nfc).toBe(nfc.normalize('NFC'));
  });

  it('preserves simple filename', () => {
    expect(normalizeFilename('report.docx')).toBe('report.docx');
  });

  it('preserves filename with spaces', () => {
    expect(normalizeFilename('my report.pdf')).toBe('my report.pdf');
  });

  it('strips nested path attack', () => {
    const result = normalizeFilename('subdir/../../../evil.pdf');
    expect(result).toBe('evil.pdf');
  });
});

// ─── parseCompressLevel ───────────────────────────────────────────────────────

describe('parseCompressLevel', () => {
  it('accepts valid levels', () => {
    expect(parseCompressLevel('screen')).toBe('screen');
    expect(parseCompressLevel('ebook')).toBe('ebook');
    expect(parseCompressLevel('printer')).toBe('printer');
    expect(parseCompressLevel('prepress')).toBe('prepress');
  });

  it('defaults to ebook for invalid value', () => {
    expect(parseCompressLevel('invalid')).toBe('ebook');
    expect(parseCompressLevel(null)).toBe('ebook');
    expect(parseCompressLevel('')).toBe('ebook');
  });
});
