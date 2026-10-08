import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the client storage/fetch boundary without requiring an iPhone Keychain.
function load(file, dependencies, dev = false) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__DEV__', compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, dev);
  return module.exports;
}

const config = load('lib/gemini-config.ts', {});
const key = 'test.personal-key+123/=!:@';

test('Gemini key persists in secure storage across module reload and can be removed', async () => {
  const values = new Map();
  let rejectWrite = false;
  const store = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
    getItemAsync: async (name) => values.get(name) ?? null,
    setItemAsync: async (name, value, options) => {
      assert.equal(options.keychainAccessible, 'device-only');
      if (rejectWrite) throw new Error('Mock Keychain failure');
      values.set(name, value);
    },
    deleteItemAsync: async (name) => values.delete(name),
  };
  const dependencies = { 'expo-secure-store': store, 'react-native': { Platform: { OS: 'ios' } }, './gemini-config': config };
  const storage = load('lib/gemini-settings.ts', dependencies);
  assert.equal(await storage.getGeminiSettings(), null);
  await storage.saveGeminiSettings({ apiKey: ` ${key} `, model: 'models/gemini-test' });
  const restarted = load('lib/gemini-settings.ts', dependencies);
  assert.deepEqual(await restarted.getGeminiSettings(), { apiKey: key, model: 'gemini-test' });
  rejectWrite = true;
  await assert.rejects(restarted.saveGeminiSettings({ apiKey: 'replacement-key-1234567890', model: '' }));
  assert.equal((await restarted.getGeminiSettings()).apiKey, key);
  rejectWrite = false;
  await restarted.saveGeminiSettings({ apiKey: 'replacement-key-1234567890', model: '' });
  await restarted.clearGeminiSettings();
  assert.equal(await load('lib/gemini-settings.ts', dependencies).getGeminiSettings(), null);
});

test('web settings accept nonempty keys without character or length restrictions', async () => {
  const dependencies = { 'expo-secure-store': {}, 'react-native': { Platform: { OS: 'web' } }, './gemini-config': config };
  const storage = load('lib/gemini-settings.ts', dependencies);
  await storage.saveGeminiSettings({ apiKey: key, model: '' });
  assert.equal((await storage.getGeminiSettings()).apiKey, key);
  assert.equal(await load('lib/gemini-settings.ts', dependencies).getGeminiSettings(), null);
  for (const apiKey of ['a', 'https://invalid', 'key.with-dashes+symbols/=!:@', 'x'.repeat(300)]) {
    await storage.saveGeminiSettings({ apiKey, model: '' });
    assert.equal((await storage.getGeminiSettings()).apiKey, apiKey);
  }
  await assert.rejects(storage.saveGeminiSettings({ apiKey: '   ', model: '' }));
  await assert.rejects(storage.saveGeminiSettings({ apiKey: key, model: '../../invalid' }));
});

test('only AI requests send personal credentials; missing key and insecure origin stop before fetch', async () => {
  const original = process.env.EXPO_PUBLIC_API_ORIGIN;
  process.env.EXPO_PUBLIC_API_ORIGIN = 'https://test.invalid';
  const calls = [];
  let settings = { apiKey: key, model: 'gemini-test' };
  const dependencies = {
    'expo-constants': { expoConfig: {} }, 'expo/fetch': { fetch: async (...args) => { calls.push(args); return new Response('{}'); } },
    'react-native': { Platform: { OS: 'ios' } }, './gemini-settings': { getGeminiSettings: async () => settings }, './gemini-config': config,
  };
  try {
    const client = load('lib/api-client.ts', dependencies);
    client.setBetaAccessToken('access-code');
    for (const route of ['chapter-summary', 'chapter-translation', 'chapter-content', 'gemini-check']) {
      await client.apiFetch(`/api/${route}`, { method: 'POST' });
      const [url, request] = calls.at(-1);
      assert.equal(url, `https://test.invalid/api/${route}`);
      assert.equal(request.headers.get('X-Gemini-Api-Key'), key);
      assert.equal(request.headers.get('X-Gemini-Model'), 'gemini-test');
      assert.equal(request.headers.get('Authorization'), 'Bearer access-code');
      assert.equal(request.redirect, 'error');
    }
    await client.apiFetch('/api/library');
    assert.equal(calls.at(-1)[1].headers.get('X-Gemini-Api-Key'), null);
    settings = null;
    const before = calls.length;
    await assert.rejects(client.apiFetch('/api/chapter-summary'), /Gemini 设置/);
    settings = { apiKey: key, model: '' };
    process.env.EXPO_PUBLIC_API_ORIGIN = 'http://test.invalid';
    await assert.rejects(client.apiFetch('/api/chapter-summary'), /HTTPS/);
    assert.equal(calls.length, before);
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_ORIGIN;
    else process.env.EXPO_PUBLIC_API_ORIGIN = original;
  }
});
