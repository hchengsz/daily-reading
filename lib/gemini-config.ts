export type GeminiSettings = { apiKey: string; model: string };

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export function normalizeGeminiSettings(settings: GeminiSettings): GeminiSettings {
  const apiKey = settings.apiKey.trim();
  const model = settings.model.trim().replace(/^models\//, '');
  if (!apiKey) throw new Error('请先在书架的 Gemini 设置中填写 API Key');
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)) {
    throw new Error('API Key 格式不正确，请粘贴完整密钥，不要填写网址');
  }
  if (model && !/^gemini-[A-Za-z0-9._-]{1,100}$/.test(model)) {
    throw new Error('模型名称格式不正确，请填写 Gemini 模型 ID');
  }
  return { apiKey, model };
}
