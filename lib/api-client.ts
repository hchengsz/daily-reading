import Constants from 'expo-constants';
import { Platform } from 'react-native';

// A private TestFlight access code stays in memory, never in the app bundle or source files.
let betaAccessToken = '';
export function setBetaAccessToken(token: string) { betaAccessToken = token.trim(); }
export function apiFetch(path: string, options: RequestInit = {}) {
  if (!path.startsWith('/api/')) throw new Error('无效的 API 路径');
  const headers = new Headers(options.headers);
  if (betaAccessToken) headers.set('Authorization', `Bearer ${betaAccessToken}`);
  return fetch(apiUrl(path), { ...options, headers });
}

export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (Platform.OS === 'web') return path;

  const configuredOrigin = process.env.EXPO_PUBLIC_API_ORIGIN || process.env.EXPO_PUBLIC_TRANSLATE_API_ORIGIN;
  if (configuredOrigin) return joinUrl(configuredOrigin, path);

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return joinUrl(`http://${hostUri}`, path);

  return path;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const fallback = text.trim() || `HTTP ${response.status}`;
    if (!response.ok && /^not found$/i.test(fallback)) {
      throw new Error('没有连到本地 API 服务。请确认 Expo dev server 正在运行，且手机能访问电脑上的服务地址。');
    }
    throw new Error(response.ok ? `服务端没有返回 JSON：${fallback}` : fallback);
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `请求失败（${response.status}）`;
    throw new Error(message);
  }

  return data as T;
}

function joinUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
