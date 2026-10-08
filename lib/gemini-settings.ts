import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { type GeminiSettings, normalizeGeminiSettings } from './gemini-config';

const STORAGE_KEY = 'daily-reading.gemini.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// Browsers have no Keychain: deliberately do not persist credentials in localStorage.
let webSettings: GeminiSettings | null = null;

export async function getGeminiSettings(): Promise<GeminiSettings | null> {
  if (Platform.OS === 'web') return webSettings;
  const value = await SecureStore.getItemAsync(STORAGE_KEY, options);
  if (!value) return null;
  try {
    return normalizeGeminiSettings(JSON.parse(value));
  } catch {
    throw new Error('保存的 Gemini 配置无法读取，请重新填写并保存');
  }
}

export async function saveGeminiSettings(settings: GeminiSettings) {
  const normalized = normalizeGeminiSettings(settings);
  if (Platform.OS === 'web') webSettings = normalized;
  else await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalized), options);
}

export async function clearGeminiSettings() {
  if (Platform.OS === 'web') webSettings = null;
  else await SecureStore.deleteItemAsync(STORAGE_KEY, options);
}
