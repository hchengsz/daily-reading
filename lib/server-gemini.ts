import { createHash } from 'node:crypto';
import { fetch as serverFetch, ProxyAgent } from 'undici';

import { DEFAULT_GEMINI_MODEL, normalizeGeminiSettings } from './gemini-config';

export type GeminiCredentials = { apiKey: string; model: string; cacheScope: string };
export type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

export class GeminiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

export function getGeminiCredentials(request: Request, requirePersonalKey = false): GeminiCredentials {
  try {
    // An explicitly supplied key never silently falls back to the server's account.
    const settings = normalizeGeminiSettings({
      apiKey: request.headers.get('X-Gemini-Api-Key') ?? (requirePersonalKey ? '' : process.env.GEMINI_API_KEY || ''),
      model: request.headers.get('X-Gemini-Model') || process.env.GEMINI_VOCAB_MODEL || DEFAULT_GEMINI_MODEL,
    });
    return {
      ...settings,
      // Isolate concurrent work across credentials without retaining raw keys as cache keys.
      cacheScope: createHash('sha256').update(`${settings.apiKey}:${settings.model}`).digest('hex'),
    };
  } catch (error) {
    throw new GeminiError(error instanceof Error ? error.message : 'Gemini 配置无效');
  }
}

function upstreamError(status: number): GeminiError {
  // Never relay Google's raw error payload; it can include request/credential details.
  if (status === 400 || status === 401 || status === 403) return new GeminiError('Gemini 拒绝了请求，请检查 API Key、模型权限及地区限制', 400);
  if (status === 404) return new GeminiError('Gemini 模型不可用，请在设置中更换模型 ID', 400);
  if (status === 429) return new GeminiError('Gemini 配额不足或请求过于频繁，请检查额度后重试', 429);
  return new GeminiError('Gemini 暂时不可用，请稍后重试', 502);
}

export async function requestGemini(credentials: Pick<GeminiCredentials, 'apiKey' | 'model'>, body?: unknown) {
  try {
    const response = await serverFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(credentials.model)}${body === undefined ? '' : ':generateContent'}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': credentials.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher,
        signal: AbortSignal.timeout(body === undefined ? 30_000 : 180_000),
        redirect: 'error',
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw upstreamError(response.status);
    }
    return await response.json() as GeminiResponse & { supportedGenerationMethods?: string[] };
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    throw new GeminiError('无法连接 Gemini 或请求超时，请稍后重试', 502);
  }
}
