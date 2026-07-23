import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getServerChapter, readLibrary } from '@/lib/server-library';
import { fetch as serverFetch, ProxyAgent } from 'undici';

type TranslationProvider = 'google' | 'ai';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

type GoogleTranslateResponse = {
  data?: { translations?: { translatedText?: string }[] };
  error?: { message?: string };
};

type GeneratedTranslation = {
  translation: string;
  source: 'cache' | 'gemini' | 'google';
};

const translationCache = new Map<string, Promise<GeneratedTranslation>>();
const aiCacheRoot = path.join(process.cwd(), 'data', 'ai-cache');
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

function translateChapter(bookId: string, chapterId: string, provider: TranslationProvider, force = false) {
  if (provider === 'google') return translateWithGoogle(bookId, chapterId);

  const cacheKey = `${bookId}:${chapterId}`;
  if (force) translationCache.delete(cacheKey);
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;

  const request = getOrGenerateAiTranslation(bookId, chapterId, force).catch((error) => {
    translationCache.delete(cacheKey);
    throw error;
  });
  translationCache.set(cacheKey, request);
  return request;
}

async function getOrGenerateAiTranslation(bookId: string, chapterId: string, force: boolean): Promise<GeneratedTranslation> {
  const cacheFile = getCacheFile('translations', bookId, chapterId);
  if (!force) {
    const cached = await readCachedText(cacheFile);
    if (cached) return { translation: cached, source: 'cache' };
  }

  const translation = await translateWithGemini(bookId, chapterId);
  await writeCachedText(cacheFile, translation);
  return { translation, source: 'gemini' };
}

async function translateWithGoogle(bookId: string, chapterId: string): Promise<GeneratedTranslation> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  const baseUrl = process.env.GOOGLE_TRANSLATE_BASE_URL || 'https://translation.googleapis.com/language/translate/v2';
  const target = process.env.GOOGLE_TRANSLATE_TARGET_LANGUAGE || 'zh-CN';
  const library = await readLibrary();
  const chapter = getServerChapter(library, bookId, chapterId);

  if (!apiKey) throw new Error('服务端缺少 GOOGLE_TRANSLATE_API_KEY');
  if (!chapter) throw new Error('没有找到这一章');

  const chunks = chunkText(chapter.content, 4200);
  if (!chunks.length) throw new Error('这一章没有可翻译正文');

  const url = new URL(baseUrl);
  url.searchParams.set('key', apiKey);

  const response = await serverFetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: chunks,
      source: 'en',
      target,
      format: 'text',
    }),
    dispatcher: proxyAgent,
  });

  const data = await response.json() as GoogleTranslateResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || `Google 翻译请求失败（${response.status}）`);
  }

  const translations = data.data?.translations?.map((item) => decodeHtml(item.translatedText || '').trim()).filter(Boolean) || [];
  if (!translations.length) throw new Error('Google 翻译没有返回正文');
  return { translation: translations.join('\n\n'), source: 'google' };
}

async function translateWithGemini(bookId: string, chapterId: string) {
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
            text: '你是一位严谨、流畅的英文经典文本译者。把英文原文完整翻译为自然、准确的简体中文。保持原文段落结构；不要总结、删减、扩写或添加Markdown符号。遇到神学、哲学术语时优先使用稳定译名；不确定时选择直译并保持上下文可读。',
          }],
        },
        contents: [{
          role: 'user',
          parts: [{
            text: `请完整翻译下面这一章。\n\n章节：${chapter.title}\n所属部分：${chapter.section}\n\n英文原文：\n${chapter.content}`,
          }],
        }],
        generationConfig: {
          maxOutputTokens: 16384,
        },
      }),
      dispatcher: proxyAgent,
    },
  );

  const data = await response.json() as GeminiResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini 翻译请求失败（${response.status}）`);
  }

  const translation = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!translation) throw new Error('Gemini 没有返回翻译正文');
  return translation;
}

function chunkText(text: string, maxLength: number) {
  const paragraphs = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let index = 0; index < paragraph.length; index += maxLength) {
        chunks.push(paragraph.slice(index, index + maxLength));
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function getCacheFile(kind: 'translations', bookId: string, chapterId: string) {
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

export async function POST(request: Request) {
  try {
    const body = await request.json() as { bookId?: unknown; chapterId?: unknown; provider?: unknown; force?: unknown };
    if (typeof body.bookId !== 'string' || typeof body.chapterId !== 'string' || !/^\d+$/.test(body.chapterId)) {
      return Response.json({ error: '章节 ID 无效' }, { status: 400 });
    }
    if (body.provider !== 'google' && body.provider !== 'ai') {
      return Response.json({ error: '翻译方式无效' }, { status: 400 });
    }

    const library = await readLibrary();
    if (!getServerChapter(library, body.bookId, body.chapterId)) {
      return Response.json({ error: '没有找到这一章' }, { status: 404 });
    }

    const result = await translateChapter(body.bookId, body.chapterId, body.provider, body.force === true);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '翻译失败';
    return Response.json({ error: message }, { status: 500 });
  }
}
