// lib/converters/txt.ts
// TXT converter: đọc plain text → chuyển thành markdown sạch
// Heuristic: detect headings, lists, URLs, block quotes, code blocks

import fs from 'fs/promises';
import path from 'path';

export interface TxtConvertResult {
  textOnlyMdPath: string;
  slug: string;
}

// ─── Slug từ tên file ─────────────────────────────────────────────────────────
function slugify(filename: string): string {
  const name = path.basename(filename, path.extname(filename)).normalize('NFC');
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Heuristic TXT → Markdown ─────────────────────────────────────────────────

function convertTextToMarkdown(rawText: string): string {
  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 1. Detect ALL-CAPS lines as headings (≥ 3 chars, no leading whitespace)
    //    followed by a blank line or at start = ## heading
    if (/^[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ\s.,!?:;\-–—()]{3,}$/.test(line.trim()) && line.trim().length > 0) {
      // Check if it looks like a heading (not a sentence with punctuation ending)
      const trimmed = line.trim();
      if (!trimmed.endsWith('.') && !trimmed.endsWith(',')) {
        output.push(`## ${trimmed}`);
        output.push('');
        continue;
      }
    }

    // 2. Detect underline-style headings: ===== or ----- on next line
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (/^={3,}\s*$/.test(nextLine) && line.trim().length > 0) {
        output.push(`# ${line.trim()}`);
        output.push('');
        i++; // skip the === line
        continue;
      }
      if (/^-{3,}\s*$/.test(nextLine) && line.trim().length > 0) {
        output.push(`## ${line.trim()}`);
        output.push('');
        i++; // skip the --- line
        continue;
      }
    }

    // 3. Lines that are just dashes/equals/underscores → horizontal rule
    if (/^[-=_*]{3,}\s*$/.test(line.trim()) && line.trim().length >= 3) {
      output.push('---');
      output.push('');
      continue;
    }

    // 4. Detect numbered lists (e.g., "1. ", "2) ", "a. ", "a) ")
    if (/^\s*\d+[.)]\s+/.test(line)) {
      // Already valid markdown numbered list
      output.push(line);
      continue;
    }

    // 5. Detect bullet-style lists with -, *, •
    if (/^\s*[-*•]\s+/.test(line)) {
      // Normalize • to -
      output.push(line.replace(/•/, '-'));
      continue;
    }

    // 6. Auto-link bare URLs
    line = line.replace(
      /(?<!\[.*?\]\()(?<!")(https?:\/\/[^\s<>)\]]+)/g,
      '<$1>'
    );

    // 7. Detect indented blocks (4+ spaces or tab) as code (only if not a list)
    if (/^(?:    |\t)/.test(line) && !/^\s*[-*•]\s/.test(line) && !/^\s*\d+[.)]\s/.test(line)) {
      output.push(line);
      continue;
    }

    // 8. Default: pass through
    output.push(line);
  }

  // Clean up: collapse 3+ consecutive blank lines into 2
  let result = output.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim() + '\n';
}

// ─── Convert TXT → text-only.md ───────────────────────────────────────────────

export async function convertTxt(
  filePath: string,
  outputDir: string,
  originalFilename: string
): Promise<TxtConvertResult> {
  const slug = slugify(originalFilename);

  await fs.mkdir(outputDir, { recursive: true });

  // Đọc file txt — detect encoding: UTF-16 BOM, UTF-8, fallback latin1
  let rawText: string;
  const buffer = await fs.readFile(filePath);

  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    // UTF-16LE BOM
    rawText = new TextDecoder('utf-16le').decode(buffer);
  } else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    // UTF-16BE BOM
    rawText = new TextDecoder('utf-16be').decode(buffer);
  } else if (buffer.length >= 4 && buffer[1] === 0x00 && buffer[3] === 0x00) {
    // Heuristic: UTF-16LE without BOM (ASCII chars have 0x00 as second byte)
    rawText = new TextDecoder('utf-16le').decode(buffer);
  } else {
    // UTF-8 (with or without BOM) → fallback latin1 if invalid
    try {
      rawText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      rawText = buffer.toString('latin1');
    }
  }

  // Strip BOM character if present
  if (rawText.charCodeAt(0) === 0xFEFF) {
    rawText = rawText.slice(1);
  }

  // Convert qua markdown
  const markdown = convertTextToMarkdown(rawText);

  // Ghi file output
  const textOnlyMdPath = path.join(outputDir, `${slug}-text-only.md`);
  await fs.writeFile(textOnlyMdPath, markdown, 'utf-8');

  return { textOnlyMdPath, slug };
}
