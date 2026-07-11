import { getChapter } from '@/lib/book';
import { fetch as serverFetch, ProxyAgent } from 'undici';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

const summaryCache = new Map<string, Promise<string>>();
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

function summarizeChapter(bookId: string, chapterId: string) {
  const cacheKey = `${bookId}:${chapterId}`;
  const cached = summaryCache.get(cacheKey);
  if (cached) return cached;

  const request = generateSummary(bookId, chapterId).catch((error) => {
    summaryCache.delete(cacheKey);
    throw error;
  });
  summaryCache.set(cacheKey, request);
  return request;
}

async function generateSummary(bookId: string, chapterId: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  const configuredModel = process.env.GEMINI_VOCAB_MODEL;
  const chapter = getChapter(bookId, chapterId);

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

export async function POST(request: Request) {
  try {
    const body = await request.json() as { bookId?: unknown; chapterId?: unknown };
    if (typeof body.bookId !== 'string' || typeof body.chapterId !== 'string' || !/^\d+$/.test(body.chapterId)) {
      return Response.json({ error: '章节 ID 无效' }, { status: 400 });
    }
    const summary = await summarizeChapter(body.bookId, body.chapterId);
    return Response.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成总结失败';
    return Response.json({ error: message }, { status: 500 });
  }
}
