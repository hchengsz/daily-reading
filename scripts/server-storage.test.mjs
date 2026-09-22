import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStorage } from '../lib/server-storage.ts';

test('local writes survive a new storage instance and reject paths outside the root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'daily-reading-storage-'));
  const first = createStorage({ root, provider: 'local' });
  const file = path.join(root, 'data', 'cache.txt');
  await first.write(file, '天主、圣神');
  const second = createStorage({ root, provider: 'local' });
  assert.equal((await second.read(file)).toString(), '天主、圣神');
  await assert.rejects(() => first.write(path.join(root, '..', 'escape.txt'), 'x'), /超出/);
  await assert.rejects(() => second.write(file, 'replacement', false), { code: 'EEXIST' });
  assert.equal((await second.read(file)).toString(), '天主、圣神');
});

test('cloud data survives new instances, preserves Chinese names and never writes locally', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'daily-reading-cloud-'));
  const objects = new Map();
  const transport = async (url, options) => {
    assert.equal(options.headers.apikey, 'test-key');
    assert.match(url, /^https:\/\/example.supabase.co\/storage\/v1\/object\/daily-reading\/files\/[a-f0-9]{64}$/);
    if (options.method === 'POST') {
      objects.set(url, options.body);
      return new Response('{}');
    }
    return objects.has(url) ? new Response(objects.get(url)) : Response.json({ code: 'NoSuchKey' }, { status: 404 });
  };
  const options = { root, provider: 'supabase', url: 'https://example.supabase.co', key: 'test-key', transport };
  const first = createStorage(options);
  const file = path.join(root, 'books', '天主之城.pdf');
  await first.write(file, 'pdf bytes');
  assert.equal((await createStorage(options).read(file)).toString(), 'pdf bytes');
  await assert.rejects(() => createStorage({ root, provider: 'local' }).read(file), { code: 'ENOENT' });
  await assert.rejects(() => first.read(path.join(root, 'absent')), { code: 'ENOENT' });
});

test('cloud authorization and missing bucket errors are not cache misses', async () => {
  for (const [status, code] of [[403, 'AccessDenied'], [404, 'NoSuchBucket'], [500, 'InternalError']]) {
    const store = createStorage({
      root: process.cwd(), provider: 'supabase', url: 'https://example.supabase.co', key: 'test-key',
      transport: async () => Response.json({ code }, { status }),
    });
    await assert.rejects(() => store.read(path.join(process.cwd(), 'cache')), (error) => error.code !== 'ENOENT');
  }
});

test('cloud configuration and file size fail before sending a request', async () => {
  assert.throws(() => createStorage({ provider: 'supabase', url: '', key: '' }), /配置/);
  assert.throws(() => createStorage({ provider: 'supabase', url: 'https://example.supabase.co', key: 'sb_publishable_test' }), /Secret key/);
  let calls = 0;
  const store = createStorage({
    root: process.cwd(), provider: 'supabase', url: 'https://example.supabase.co', key: 'test-key',
    transport: async () => { calls++; return new Response('{}'); },
  });
  await assert.rejects(() => store.write(path.join(process.cwd(), 'large'), new Uint8Array(50 * 1024 * 1024 + 1)), /50MB/);
  assert.equal(calls, 0);
});

test('new Supabase secret keys use apikey without a JWT Authorization header', async () => {
  const store = createStorage({
    provider: 'supabase', url: 'https://example.supabase.co', key: 'sb_secret_test',
    transport: async (_, options) => {
      assert.equal(options.headers.apikey, 'sb_secret_test');
      assert.equal(options.headers.Authorization, undefined);
      return new Response('ok');
    },
  });
  assert.equal((await store.read(path.join(process.cwd(), 'test'))).toString(), 'ok');
});
