import { GeminiError, getGeminiCredentials, requestGemini } from '@/lib/server-gemini';

export async function POST(request: Request) {
  try {
    const credentials = getGeminiCredentials(request, true);
    // Metadata only: checking connectivity does not generate content or spend generation tokens.
    const model = await requestGemini(credentials);
    if (!model.supportedGenerationMethods?.includes('generateContent')) {
      throw new GeminiError('此模型不支持文本生成，请更换 Gemini 模型 ID');
    }
    return Response.json({ ok: true, model: credentials.model }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof GeminiError ? error.message : '检查连接失败' }, {
      status: error instanceof GeminiError ? error.status : 500,
    });
  }
}
