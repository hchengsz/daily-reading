import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

import type { Book, Chapter } from '@/lib/book';

type PdfJsDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: { str?: string; transform?: number[] }[] }>;
  }>;
  getOutline?(): Promise<({ title?: string; dest?: unknown }[] | null)>;
  getDestination?(dest: string): Promise<unknown[] | null>;
  getPageIndex?(ref: unknown): Promise<number>;
};

export type AddBookMode = 'scg' | 'generic';

type AddBookInput = {
  id: string;
  title: string;
  author: string;
  translator: string;
  sourceFile: string;
  pdfBytes: Uint8Array;
  mode: AddBookMode;
};

type AddEpubInput = {
  id: string;
  title: string;
  author: string;
  translator: string;
  sourceFile: string;
  epubBytes: Uint8Array;
};

const CHAPTER_RE = /第([一二三四五六七八九十百零〇○0-9]+)章/g;
const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  '○': 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export async function createBookFromPdf(input: AddBookInput): Promise<Book> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: input.pdfBytes,
    disableWorker: true,
    useSystemFonts: true,
  } as Parameters<typeof pdfjs.getDocument>[0] & { disableWorker: boolean });
  const document = await loadingTask.promise as PdfJsDocument;
  const pages = await readAllPages(document);
  const chapters = input.mode === 'scg'
    ? createScgStyleChapters(pages)
    : await createGenericChapters(document, pages);

  return {
    id: input.id,
    title: input.title,
    author: input.author,
    translator: input.translator,
    sourceFile: input.sourceFile,
    sourceType: 'pdf',
    pageCount: document.numPages,
    processingMode: input.mode,
    visionOcrPageCount: 0,
    chapters,
  };
}

export function createBookFromEpub(input: AddEpubInput): Book {
  const files = unzipSync(input.epubBytes);
  const textFiles = getEpubTextFiles(files);

  const chapters: Chapter[] = [];
  let section = 'EPUB';
  for (const fileName of textFiles) {
    if (/nav|toc|cover|titlepage|copyright|_tp_|_cop_/i.test(fileName)) continue;
    const text = htmlToText(strFromU8(files[fileName]));
    if (text.length < 80) continue;
    const title = firstReadableLine(text) || path.basename(fileName, path.extname(fileName));
    if (/^part\s+/i.test(title)) section = title;
    chapters.push({
      id: String(chapters.length + 1),
      section,
      title,
      content: text,
      startPage: chapters.length + 1,
    });
  }

  return {
    id: input.id,
    title: input.title,
    author: input.author,
    translator: input.translator,
    sourceFile: input.sourceFile,
    sourceType: 'epub',
    pageCount: chapters.length,
    processingMode: 'generic',
    visionOcrPageCount: 0,
    chapters,
  };
}

async function readAllPages(document: PdfJsDocument) {
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str || '')
      .join('\n');
    pages.push(cleanPage(text));
  }
  return pages;
}

function cleanPage(text: string) {
  const lines = text
    .replace(/\u3000/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[IVXLCDMivxlcdm0-9\-—–.·• ]{1,12}$/.test(line));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function reflowPage(text: string) {
  const compact = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('');

  if (!compact) return '';

  const paragraphs: string[] = [];
  let current = '';
  const sentences = compact.match(/.*?(?:[。！？!?]+(?:[」』”’])?|$)/g) || [compact];
  for (const sentence of sentences) {
    if (!sentence) continue;
    current += sentence;
    if (current.length >= 220) {
      paragraphs.push(current);
      current = '';
    }
  }
  if (current) paragraphs.push(current);

  if (paragraphs.length === 1 && paragraphs[0].length > 520) {
    const value = paragraphs[0];
    return Array.from({ length: Math.ceil(value.length / 260) }, (_, index) => value.slice(index * 260, index * 260 + 260)).join('\n\n');
  }

  return paragraphs.join('\n\n');
}

function createScgStyleChapters(pages: string[]) {
  const starts: { pageIndex: number; section: number; title: string; number: number }[] = [];
  let group = 1;
  let previous = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const head = pages[pageIndex].split(/\r?\n/).slice(0, 24).join('').replace(/\s/g, '');
    CHAPTER_RE.lastIndex = 0;
    const match = CHAPTER_RE.exec(head);
    if (!match) continue;

    const number = chineseNumber(match[1]);
    if (!number) continue;
    if (previous >= 30 && previous > number && number <= 5) {
      group += 1;
      previous = 0;
    }
    if (number <= previous) continue;
    if (previous && number - previous > 8) continue;

    starts.push({
      pageIndex,
      section: group,
      number,
      title: `${match[0]} · ${chapterTitle(pages[pageIndex], match[0])}`,
    });
    previous = number;
  }

  if (!starts.length) return createChunkedChapters(pages, [{ pageIndex: 0, section: '正文', title: '全文' }], 10);
  if (starts[0].pageIndex > 0) {
    starts.unshift({ pageIndex: 0, section: 0, title: '前言与导论', number: 0 });
  }

  return buildChapters(
    pages,
    starts.map((start) => ({
      pageIndex: start.pageIndex,
      section: start.section === 0 ? '前置内容' : `第${start.section}篇`,
      title: start.title,
    })),
  );
}

async function createGenericChapters(document: PdfJsDocument, pages: string[]) {
  const outlineStarts = await getOutlineStarts(document);
  if (outlineStarts.length > 1) return createChunkedChapters(pages, outlineStarts, 10);
  return createChunkedChapters(pages, [{ pageIndex: 0, section: '正文', title: '全文' }], 10);
}

async function getOutlineStarts(document: PdfJsDocument) {
  const outline = await document.getOutline?.();
  if (!outline?.length || !document.getDestination || !document.getPageIndex) return [];

  const starts: { pageIndex: number; section: string; title: string }[] = [];
  for (const item of outline) {
    if (!item.title || !item.dest) continue;
    try {
      const destination = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest;
      const ref = Array.isArray(destination) ? destination[0] : undefined;
      if (!ref) continue;
      const pageIndex = await document.getPageIndex(ref);
      starts.push({ pageIndex, section: item.title, title: item.title });
    } catch {
      // Some PDFs contain broken outlines. Ignore those entries and fall back to page chunks.
    }
  }

  return starts
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .filter((item, index, items) => index === 0 || item.pageIndex !== items[index - 1].pageIndex);
}

function createChunkedChapters(
  pages: string[],
  starts: { pageIndex: number; section: string; title: string }[],
  chunkSize: number,
) {
  const expanded: { pageIndex: number; section: string; title: string }[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1]?.pageIndex ?? pages.length;
    for (let pageIndex = start.pageIndex; pageIndex < end; pageIndex += chunkSize) {
      const part = Math.floor((pageIndex - start.pageIndex) / chunkSize) + 1;
      const multiPart = end - start.pageIndex > chunkSize;
      expanded.push({
        pageIndex,
        section: start.section,
        title: multiPart ? `${start.title} · 第${part}段` : start.title,
      });
    }
  }
  return buildChapters(pages, expanded);
}

function buildChapters(pages: string[], starts: { pageIndex: number; section: string; title: string }[]): Chapter[] {
  const chapters: Chapter[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1]?.pageIndex ?? pages.length;
    const content = pages
      .slice(start.pageIndex, end)
      .map(reflowPage)
      .filter(Boolean)
      .join('\n\n');
    if (!content) continue;
    chapters.push({
      id: String(chapters.length + 1),
      section: start.section,
      title: start.title,
      content,
      startPage: start.pageIndex + 1,
    });
  }
  return chapters;
}

function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes('百')) {
    const [left, right] = value.split('百', 2);
    return (CN_DIGITS[left] ?? 1) * 100 + (right ? chineseNumber(right) : 0);
  }
  if (value.includes('十')) {
    const [left, right] = value.split('十', 2);
    return (CN_DIGITS[left] ?? 1) * 10 + (right ? (CN_DIGITS[right] ?? chineseNumber(right)) : 0);
  }
  return CN_DIGITS[value] ?? 0;
}

function chapterTitle(text: string, label: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < Math.min(lines.length, 18); index += 1) {
    const line = lines[index];
    const position = line.indexOf(label);
    if (position < 0) continue;
    const tail = line.slice(position + label.length).trim().replace(/^[:：.。·•\-—]+/, '');
    if (tail.length >= 2) return tail.slice(0, 30);
    const next = lines[index + 1]?.trim().replace(/^[:：.。·•\-—]+/, '');
    if (next && !CHAPTER_RE.test(next)) return next.slice(0, 30);
  }
  return label;
}

export function sanitizeFileName(value: string) {
  const base = path.basename(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  if (/\.(pdf|epub)$/i.test(base)) return base;
  return `${base || 'book'}.pdf`;
}

export function slugifyBookId(value: string) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return slug || `book-${Date.now()}`;
}

function scoreEpubPath(fileName: string) {
  const match = fileName.match(/(?:^|[_-])(?:c|p)(\d{3,})/i) || fileName.match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function getEpubTextFiles(files: Record<string, Uint8Array>) {
  const spineFiles = getEpubSpineFiles(files);
  if (spineFiles.length) return spineFiles;

  return Object.keys(files)
    .filter((name) => /\.(xhtml|html|htm)$/i.test(name))
    .sort((left, right) => scoreEpubPath(left) - scoreEpubPath(right) || left.localeCompare(right));
}

function getEpubSpineFiles(files: Record<string, Uint8Array>) {
  const container = readZipText(files, 'META-INF/container.xml');
  const packagePath = container.match(/full-path=["']([^"']+)["']/i)?.[1];
  if (!packagePath) return [];

  const packageDocument = readZipText(files, packagePath);
  if (!packageDocument) return [];

  const packageDir = path.posix.dirname(packagePath);
  const manifest = new Map<string, string>();
  const itemPattern = /<item\b[^>]*>/gi;
  for (const [item] of packageDocument.matchAll(itemPattern)) {
    const id = xmlAttribute(item, 'id');
    const href = xmlAttribute(item, 'href');
    const mediaType = xmlAttribute(item, 'media-type');
    if (!id || !href || (mediaType && !/(xhtml|html)/i.test(mediaType))) continue;
    manifest.set(id, normalizeEpubPath(path.posix.join(packageDir, href)));
  }

  const spineFiles: string[] = [];
  const itemrefPattern = /<itemref\b[^>]*>/gi;
  for (const [itemref] of packageDocument.matchAll(itemrefPattern)) {
    const idref = xmlAttribute(itemref, 'idref');
    const fileName = idref ? manifest.get(idref) : undefined;
    if (fileName && files[fileName] && /\.(xhtml|html|htm)$/i.test(fileName)) spineFiles.push(fileName);
  }

  return spineFiles.filter((fileName, index, items) => items.indexOf(fileName) === index);
}

function readZipText(files: Record<string, Uint8Array>, fileName: string) {
  const direct = files[fileName];
  if (direct) return strFromU8(direct);

  const normalizedTarget = normalizeEpubPath(fileName).toLowerCase();
  const matchingName = Object.keys(files).find((name) => normalizeEpubPath(name).toLowerCase() === normalizedTarget);
  return matchingName ? strFromU8(files[matchingName]) : '';
}

function xmlAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function normalizeEpubPath(fileName: string) {
  try {
    return decodeURIComponent(fileName).replace(/\\/g, '/').replace(/^\/+/, '');
  } catch {
    return fileName.replace(/\\/g, '/').replace(/^\/+/, '');
  }
}

function htmlToText(markup: string) {
  const withoutNoise = markup
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|h[1-6]|li)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeHtml(withoutNoise)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function firstReadableLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 3 && line.length <= 120);
}
