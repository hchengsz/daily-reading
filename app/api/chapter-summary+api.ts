import { readCachedText, writeCachedText } from '@/lib/server-storage';
import path from 'node:path';

import { getServerChapter, readLibrary } from '@/lib/server-library';
import { GeminiError, getGeminiCredentials, requestGemini, type GeminiCredentials } from '@/lib/server-gemini';
import { aiCacheRoot } from '@/lib/server-paths';

const summaryCache = new Map<string, Promise<GeneratedSummary>>();

type GeneratedSummary = {
  summary: string;
  source: 'cache' | 'gemini';
};

function summarizeChapter(bookId: string, chapterId: string, credentials: GeminiCredentials, force = false) {
  const cacheKey = `${credentials.cacheScope}:${bookId}:${chapterId}`;
  if (force) summaryCache.delete(cacheKey);
  const cached = summaryCache.get(cacheKey);
  if (cached) return cached;

  const request = getOrGenerateSummary(bookId, chapterId, credentials, force).catch((error) => {
    summaryCache.delete(cacheKey);
    throw error;
  });
  summaryCache.set(cacheKey, request);
  return request;
}

async function getOrGenerateSummary(bookId: string, chapterId: string, credentials: GeminiCredentials, force: boolean): Promise<GeneratedSummary> {
  const cacheFile = getCacheFile('summaries', bookId, chapterId);
  if (!force) {
    const cached = await readCachedText(cacheFile);
    if (cached) return { summary: cached, source: 'cache' };
  }

  const summary = await generateSummary(bookId, chapterId, credentials);
  await writeCachedText(cacheFile, summary);
  return { summary, source: 'gemini' };
}

async function generateSummary(bookId: string, chapterId: string, credentials: GeminiCredentials) {
  const library = await readLibrary();
  const chapter = getServerChapter(library, bookId, chapterId);

  if (!chapter) throw new Error('没有找到这一章');

  const data = await requestGemini(credentials, {
        systemInstruction: {
          parts: [{
            text: '你是一位严谨的经典哲学导读编辑。只能依据提供的章节正文总结，不得补写正文没有表达的观点。原文来自旧书OCR，遇到明显错字时结合上下文谨慎理解；无法确定时明确说明。使用简体中文和纯文本，不使用Markdown符号。',
          }],
        },
        contents: [{
          role: 'user',
          parts: [{
            text: `请为读者详细总结下面这一章，帮助读者带着问题阅读原文。\n\n依次写出：\n一、本章主旨（完整说明本章试图解决的问题和结论）\n二、论证脉络（按推理顺序分点解释）\n三、关键概念（解释本章的重要术语及其关系）\n四、阅读提示（指出容易误解、值得留意或受OCR影响之处）\n五、一句话提要\n\n章节：${chapter.title}\n所属部分：${chapter.section}\n\n正文：\n${chapter.content}`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: 8192,
        },
  });

  const summary = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!summary) throw new Error('Gemini 没有返回总结内容');
  return summary;
}

function getCacheFile(kind: 'summaries', bookId: string, chapterId: string) {
  return path.join(aiCacheRoot, kind, safePathPart(bookId), `${safePathPart(chapterId)}.txt`);
}

function safePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { bookId?: unknown; chapterId?: unknown; force?: unknown };
    if (typeof body.bookId !== 'string' || typeof body.chapterId !== 'string' || !/^\d+$/.test(body.chapterId)) {
      return Response.json({ error: '章节 ID 无效' }, { status: 400 });
    }
    const library = await readLibrary();
    if (!getServerChapter(library, body.bookId, body.chapterId)) {
      return Response.json({ error: '没有找到这一章' }, { status: 404 });
    }
    const result = await summarizeChapter(body.bookId, body.chapterId, getGeminiCredentials(request), body.force === true);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成总结失败';
    return Response.json({ error: message }, { status: error instanceof GeminiError ? error.status : 500 });
  }
}
