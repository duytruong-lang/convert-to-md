// lib/prompt-presets.ts
// M3: Single source of truth cho prompt presets (EN + VI)
// Import file này trong cả lib/settings.ts (server) và components/SettingsForm.tsx (client)

export const PROMPT_PRESETS = {
  en: {
    image: `You are describing an image from an internal SOP (Standard Operating Procedure) document. Purpose: to help AI agents guide employees through procedures without seeing the original image.

Describe in detail using this structure:

1. IMAGE TYPE: Screenshot of software, process diagram, real photo, or table/chart.

2. MAIN CONTENT:
   - If software screenshot: app name, current screen, data fields, sample values, highlighted buttons or arrows.
   - If process diagram: list each step in order with arrow directions.
   - If real photo: describe objects, positions, conditions.
   - If table/chart: list column headers and sample rows.

3. TEXT IN IMAGE: Transcribe ALL visible text exactly as shown, especially labels, titles, values, button names.

4. ACTION REQUIRED: If the image illustrates a specific action, describe exactly what to click/type/select and where.

Do not add personal opinions. Do not guess information not visible in the image.`,

    pdf: `Convert this PDF document to clean Markdown. Preserve structure, tables, and lists.

IMPORTANT — Structure rules:
- Analyze the table of contents (if present) to determine correct heading hierarchy
- Main headings (chapters/sections): use # or ##
- Sub-headings: use ### or ####
- Preserve numbering exactly: 1, 1.1, 1.2, 2, 2.1...
- Repeated headers/footers on each page: SKIP, do not repeat in output
- Mark original page numbers with <!-- Page X --> for reference
- Keep hyperlinks if present

For each image in the document:
> **[Image]:** [detailed description including visible text, layout, and purpose]

Output: clean Markdown only. No preamble, no postscript.`,
  },

  vi: {
    image: `Bạn là trợ lý mô tả hình ảnh cho tài liệu SOP (quy trình nội bộ). Mô tả chi tiết hình ảnh này bằng tiếng Việt theo cấu trúc sau:

1. Một câu tóm tắt ngắn về nội dung tổng thể của hình.
2. Mô tả chi tiết các thành phần chính: tên màn hình/giao diện, các nút bấm, menu, bảng dữ liệu, trường nhập liệu.
3. Ghi rõ tất cả text/số liệu hiển thị trong hình (tên cột, giá trị, nhãn nút).
4. Mô tả trạng thái hiện tại và thao tác mà người dùng đang thực hiện hoặc cần thực hiện.

Nếu hình trắng hoặc không có nội dung rõ ràng, chỉ ghi: "[Hình không có nội dung]".`,

    pdf: `Convert tài liệu PDF này sang Markdown tiếng Việt. Giữ nguyên cấu trúc, bảng biểu, danh sách.

QUAN TRỌNG — Quy tắc cấu trúc:
- Phân tích mục lục (nếu có) để xác định heading hierarchy chính xác
- Heading chính (chương/phần): dùng # hoặc ##
- Heading phụ (mục con): dùng ### hoặc ####
- Giữ đúng số thứ tự mục: 1, 1.1, 1.2, 2, 2.1...
- Header/footer lặp lại mỗi trang: BỎ QUA, không lặp trong output
- Đánh dấu số trang gốc bằng <!-- Page X --> để tham chiếu
- Giữ nguyên hyperlink nếu có

Với mỗi hình ảnh trong tài liệu:
> **[Hình ảnh]:** [mô tả chi tiết bao gồm text hiển thị, bố cục, và mục đích]

Output: chỉ Markdown sạch. Không có phần mở đầu hay kết thúc thừa.`,
  },
  // Vision mode: page-level screenshots → AI describes everything visible
  vision: {
    en: `You are analyzing a high-resolution screenshot of a single page from a presentation or document. Your goal is to produce the MOST DETAILED Markdown possible — capturing every visual element and every readable text detail.

If a PDF text layer is provided in the prompt context, use it to improve transcription accuracy, but trust the screenshot for layout, hierarchy, visual grouping, charts, images, and branding.

Analyze and output in this exact structure:

## Page Overview
One sentence summarizing the page's purpose and key message.

## Layout & Composition
- Describe the visual layout: columns, grids, sections, whitespace usage
- Note any visual hierarchy or flow direction

## Text Content
Transcribe ALL visible text EXACTLY as shown. Preserve hierarchy:
- Main headings → use ## or ###
- Subheadings → use #### 
- Body text → paragraphs
- Bullet points → preserve as lists
- Captions → italicize

## Visual Elements
For EACH image, illustration, chart, diagram, or graphic:
- **Type**: photo / illustration / icon / chart / diagram / infographic
- **Description**: detailed visual description (colors, subjects, composition)
- **Purpose**: what it communicates in context
- If chart/table: recreate data as a Markdown table

## Design & Branding
- Color palette used (name specific colors)
- Typography style (serif/sans-serif, weights)
- Brand elements (logos, watermarks, style patterns)
- Visual effects (gradients, shadows, overlays)

## Key Takeaways
Bullet the 2-3 most important points from this page.

RULES:
- Do NOT skip any element — describe EVERYTHING visible
- Transcribe text EXACTLY, do not paraphrase
- For charts: extract actual data values, not just "a chart showing..."
- For images: describe content, not just "an image of..."
- If text is too small or uncertain, mark it as [unclear] instead of guessing
- Output clean Markdown only. No preamble.`,

    vi: `Bạn đang phân tích ảnh chụp màn hình high-resolution của MỘT trang từ bài thuyết trình hoặc tài liệu. Mục tiêu: tạo Markdown CHI TIẾT NHẤT có thể — ghi nhận mọi yếu tố visual và mọi text đọc được.

Nếu prompt context có PDF text layer, dùng nó để tăng độ chính xác khi phiên âm chữ, nhưng vẫn ưu tiên screenshot cho layout, hierarchy, nhóm nội dung, chart, hình ảnh và branding.

Phân tích và output theo cấu trúc chính xác:

## Tổng quan trang
Một câu tóm tắt mục đích và thông điệp chính của trang.

## Bố cục & Composition
- Mô tả layout visual: cột, grid, sections, khoảng trắng
- Ghi nhận visual hierarchy và hướng flow

## Nội dung text
Phiên âm TOÀN BỘ text hiển thị CHÍNH XÁC. Giữ hierarchy:
- Heading chính → dùng ## hoặc ###
- Heading phụ → dùng ####
- Nội dung → đoạn văn
- Bullet points → giữ dạng list
- Caption → in nghiêng

## Yếu tố hình ảnh
Với MỖI hình ảnh, minh họa, biểu đồ, sơ đồ:
- **Loại**: ảnh chụp / minh họa / icon / biểu đồ / sơ đồ / infographic
- **Mô tả**: mô tả visual chi tiết (màu sắc, chủ thể, bố cục)
- **Mục đích**: thông điệp trong context
- Nếu biểu đồ/bảng: tái tạo dữ liệu dạng Markdown table

## Thiết kế & Branding
- Bảng màu sử dụng (nêu tên màu cụ thể)
- Typography (serif/sans-serif, weights)
- Yếu tố thương hiệu (logo, watermark, style patterns)
- Hiệu ứng visual (gradient, shadow, overlay)

## Điểm chính
Bullet 2-3 điểm quan trọng nhất từ trang này.

QUY TẮC:
- KHÔNG bỏ qua bất kỳ element nào — mô tả TẤT CẢ
- Phiên âm text CHÍNH XÁC, không paraphrase
- Biểu đồ: trích xuất giá trị dữ liệu thực, không chỉ "biểu đồ thể hiện..."
- Hình ảnh: mô tả nội dung cụ thể, không chỉ "một hình ảnh..."
- Nếu chữ quá nhỏ/không chắc, ghi [không rõ] thay vì đoán
- Output Markdown sạch. Không phần mở đầu thừa.`,
  },
} as const;

export type PromptLang = keyof typeof PROMPT_PRESETS;
