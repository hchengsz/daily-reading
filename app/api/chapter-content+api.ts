import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getServerBook, getServerChapter, readLibrary } from '@/lib/server-library';
import { PDFDocument } from 'pdf-lib';
import { fetch as serverFetch, ProxyAgent } from 'undici';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

type GeminiPage = {
  page: number;
  text: string;
};

const SCG_BOOK_IDS = new Set(['scg-truth', 'scg-creation', 'scg-providence', 'scg-mysteries', 'city-of-god']);
const MAX_CHAPTER_PAGES = 40;
const BATCH_SIZE = 4;

const contentCache = new Map<string, Promise<GeneratedContent>>();
const aiCacheRoot = path.join(process.cwd(), 'data', 'ai-cache');
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

type GeneratedContent = {
  content: string;
  source: 'cache' | 'gemini-vision';
};

function getChapterPagesFromLibrary(library: Awaited<ReturnType<typeof readLibrary>>, bookId: string, chapterId: string) {
  const book = getServerBook(library, bookId);
  const chapter = getServerChapter(library, bookId, chapterId);
  if (!book || !chapter) throw new Error('没有找到这一章');

  const index = book.chapters.findIndex((item) => item.id === chapterId);
  const nextChapter = book.chapters[index + 1];
  const startPage = chapter.startPage;
  const endPage = (nextChapter?.startPage ?? book.pageCount + 1) - 1;
  const pageCount = endPage - startPage + 1;

  if (pageCount <= 0) throw new Error('章节页码无效');
  if (pageCount > MAX_CHAPTER_PAGES) {
    throw new Error(`这一章跨 ${pageCount} 页，暂不进行实时校正`);
  }

  return { book, chapter, startPage, endPage };
}

function getCorrectedContent(bookId: string, chapterId: string, force = false) {
  const cacheKey = `${bookId}:${chapterId}`;
  if (force) contentCache.delete(cacheKey);
  const cached = contentCache.get(cacheKey);
  if (cached) return cached;

  const request = getOrGenerateCorrectedContent(bookId, chapterId, force).catch((error) => {
    contentCache.delete(cacheKey);
    throw error;
  });
  contentCache.set(cacheKey, request);
  return request;
}

async function getOrGenerateCorrectedContent(bookId: string, chapterId: string, force: boolean): Promise<GeneratedContent> {
  const cacheFile = getCacheFile('ocr', bookId, chapterId);
  if (!force) {
    const cached = await readCachedText(cacheFile);
    if (cached) return { content: cached, source: 'cache' };
  }

  const content = await generateCorrectedContent(bookId, chapterId);
  await writeCachedText(cacheFile, content);
  return { content, source: 'gemini-vision' };
}

async function generateCorrectedContent(bookId: string, chapterId: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  const configuredModel = process.env.GEMINI_VOCAB_MODEL;
  if (!apiKey) throw new Error('服务端缺少 GEMINI_API_KEY');
  if (!configuredModel) throw new Error('服务端缺少 GEMINI_VOCAB_MODEL');

  const library = await readLibrary();
  const bookRecord = getServerBook(library, bookId);
  if (!bookRecord || !isAiOcrEnabled(bookRecord)) throw new Error('这本书不需要实时校正文');

  const { book, chapter, startPage, endPage } = getChapterPagesFromLibrary(library, bookId, chapterId);
  const pdfPath = path.join(process.cwd(), 'books', book.sourceFile);
  const sourceBytes = await readFile(pdfPath);
  const sourceDocument = await PDFDocument.load(sourceBytes);

  const pages: GeminiPage[] = [];
  for (let page = startPage; page <= endPage; page += BATCH_SIZE) {
    const batchStart = page;
    const batchEnd = Math.min(endPage, page + BATCH_SIZE - 1);
    const batchBytes = await extractPdfPages(sourceDocument, batchStart, batchEnd);
    pages.push(...await transcribePdfBatch({
      apiKey,
      model: configuredModel.replace(/^models\//, ''),
      title: chapter.title,
      startPage: batchStart,
      endPage: batchEnd,
      pdfBytes: batchBytes,
    }));
  }

  const pageText = pages
    .sort((left, right) => left.page - right.page)
    .map((page) => page.text.trim())
    .filter(Boolean)
    .join('\n\n');

  if (!pageText) throw new Error('Gemini 没有返回可用正文');
  return pageText;
}

function getCacheFile(kind: 'ocr', bookId: string, chapterId: string) {
  return path.join(aiCacheRoot, kind, safePathPart(bookId), `${safePathPart(chapterId)}.txt`);
}

function safePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function readCachedText(filePath: string) {
  try {
    const text = await readFile(filePath, 'utf-8');
    return text.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function writeCachedText(filePath: string, text: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf-8');
}

async function extractPdfPages(sourceDocument: PDFDocument, startPage: number, endPage: number) {
  const batchDocument = await PDFDocument.create();
  const pageIndexes = Array.from(
    { length: endPage - startPage + 1 },
    (_, index) => startPage - 1 + index,
  );
  const copiedPages = await batchDocument.copyPages(sourceDocument, pageIndexes);
  for (const page of copiedPages) batchDocument.addPage(page);
  return batchDocument.save({ useObjectStreams: true });
}

async function transcribePdfBatch(input: {
  apiKey: string;
  model: string;
  title: string;
  startPage: number;
  endPage: number;
  pdfBytes: Uint8Array;
}) {
  const pageNumbers = Array.from(
    { length: input.endPage - input.startPage + 1 },
    (_, index) => input.startPage + index,
  );

  const body = {
    systemInstruction: {
      parts: [{
        text: '你是旧版繁体中文哲学神学书的校勘式OCR助手。只转写图片/PDF中实际存在的正文，不总结、不改写、不补充。保留原文语义，明显OCR错字可按版面和上下文校正；无法确定的字用□表示。删除页眉、页脚、页码和扫描噪声。',
      }],
    },
    contents: [{
      role: 'user',
      parts: [
        {
          text: `请逐页转写《${input.title}》的正文。PDF包含原书第 ${input.startPage} 到 ${input.endPage} 页。返回JSON，pages数组中每项包含page和text；page优先使用原书页码，如果无法判断页码就使用PDF内第1页、第2页这样的顺序页码。`,
        },
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: Buffer.from(input.pdfBytes).toString('base64'),
          },
        },
      ],
    }],
    generationConfig: {
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          pages: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                page: { type: 'NUMBER' },
                text: { type: 'STRING' },
              },
              required: ['page', 'text'],
            },
          },
        },
        required: ['pages'],
      },
    },
  };

  const data = await requestGemini(input.apiKey, input.model, body);
  const rawText = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!rawText) throw new Error('Gemini 没有返回正文');

  const parsed = JSON.parse(rawText) as { pages?: GeminiPage[] };
  const pages = normalizeGeminiPages(parsed.pages || [], pageNumbers);
  if (!pages.length) throw new Error('Gemini 返回的页码无效');
  return pages;
}

function normalizeGeminiPages(pages: GeminiPage[], pageNumbers: number[]) {
  return pages
    .map((page, index) => {
      if (typeof page.text !== 'string' || !page.text.trim()) return null;

      let pageNumber = page.page;
      if (!pageNumbers.includes(pageNumber)) {
        const batchPageNumber = Math.trunc(page.page);
        if (batchPageNumber >= 1 && batchPageNumber <= pageNumbers.length) {
          pageNumber = pageNumbers[batchPageNumber - 1];
        } else if (index < pageNumbers.length) {
          pageNumber = pageNumbers[index];
        }
      }

      return { page: pageNumber, text: page.text.trim() };
    })
    .filter((page): page is GeminiPage => page !== null && pageNumbers.includes(page.page));
}

async function requestGemini(apiKey: string, model: string, body: unknown) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const waits = [0, 5000, 15000];

  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt]) await sleep(waits[attempt]);

    const response = await serverFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      dispatcher: proxyAgent,
    });
    const data = await response.json() as GeminiResponse;
    if (response.ok) return data;
    if (response.status !== 429 || attempt === waits.length - 1) {
      throw new Error(data.error?.message || `Gemini 请求失败（${response.status}）`);
    }
  }

  throw new Error('Gemini 请求失败');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { bookId?: unknown; chapterId?: unknown; force?: unknown };
    if (typeof body.bookId !== 'string' || typeof body.chapterId !== 'string' || !/^\d+$/.test(body.chapterId)) {
      return Response.json({ error: '章节 ID 无效' }, { status: 400 });
    }
    const library = await readLibrary();
    const book = getServerBook(library, body.bookId);
    if (!book || !isAiOcrEnabled(book)) {
      return Response.json({ error: '这本书不需要实时校正文' }, { status: 400 });
    }
    if (!getServerChapter(library, body.bookId, body.chapterId)) {
      return Response.json({ error: '没有找到这一章' }, { status: 404 });
    }

    const result = await getCorrectedContent(body.bookId, body.chapterId, body.force === true);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '实时校正文失败';
    return Response.json({ error: message }, { status: 500 });
  }
}

function isAiOcrEnabled(book: { id: string; processingMode?: string }) {
  return book.processingMode === 'scg' || SCG_BOOK_IDS.has(book.id);
}
