import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getServerChapter, readLibrary } from '@/lib/server-library';
import { fetch as serverFetch, ProxyAgent } from 'undici';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

const summaryCache = new Map<string, Promise<GeneratedSummary>>();
const aiCacheRoot = path.join(process.cwd(), 'data', 'ai-cache');
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

type GeneratedSummary = {
  summary: string;
  source: 'cache' | 'gemini';
};

function summarizeChapter(bookId: string, chapterId: string, force = false) {
  const cacheKey = `${bookId}:${chapterId}`;
  if (force) summaryCache.delete(cacheKey);
  const cached = summaryCache.get(cacheKey);
  if (cached) return cached;

  const request = getOrGenerateSummary(bookId, chapterId, force).catch((error) => {
    summaryCache.delete(cacheKey);
    throw error;
  });
  summaryCache.set(cacheKey, request);
  return request;
}

async function getOrGenerateSummary(bookId: string, chapterId: string, force: boolean): Promise<GeneratedSummary> {
  const cacheFile = getCacheFile('summaries', bookId, chapterId);
  if (!force) {
    const cached = await readCachedText(cacheFile);
    if (cached) return { summary: cached, source: 'cache' };
  }

  const summary = await generateSummary(bookId, chapterId);
  await writeCachedText(cacheFile, summary);
  return { summary, source: 'gemini' };
}

async function generateSummary(bookId: string, chapterId: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  const configuredModel = process.env.GEMINI_VOCAB_MODEL;
  const library = await readLibrary();
  const chapter = getServerChapter(library, bookId, chapterId);

  if (!apiKey) throw new Error('服务端缺少 GEMINI_API_KEY');
  if (!configuredModel) throw new Error('服务端缺少 GEMINI_VOCAB_MODEL');
  if (!chapter) throw new Error('没有找到这一章');

  const model = configuredModel.replace(/^models\//, '');
  const response = await serverFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
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
      }),
      dispatcher: proxyAgent,
    },
  );

  const data = await response.json() as GeminiResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini 请求失败（${response.status}）`);
  }

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
    const result = await summarizeChapter(body.bookId, body.chapterId, body.force === true);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成总结失败';
    return Response.json({ error: message }, { status: 500 });
  }
}
