import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

test('personal Gemini key works for check, summary, translation and PDF OCR', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'daily-reading-gemini-test-'));
  await mkdir(path.join(root, 'data'));
  await mkdir(path.join(root, 'books'));
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await writeFile(path.join(root, 'books/test.pdf'), await pdf.save());
  await writeFile(path.join(root, 'data/library.json'), JSON.stringify({ books: [{
    id: 'test', sourceFile: 'test.pdf', pageCount: 1, processingMode: 'scg',
    chapters: [{ id: '1', startPage: 1, title: 'Test chapter', section: 'Test', content: 'Only test content.' }],
  }] }));
  const child = spawn(process.execPath, ['--import', new URL('./gemini-mock-preload.mjs', import.meta.url).href, 'scripts/serve-backend.cjs'], {
    windowsHide: true,
    env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', STORAGE_PROVIDER: 'local', DAILY_READING_STORAGE_ROOT: root,
      HOST: '127.0.0.1', PORT: '0', BACKEND_ACCESS_TOKEN: 'test-access', GEMINI_API_KEY: '', GEMINI_VOCAB_MODEL: 'gemini-test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('daily-reading-gemini-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 20_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Backend exited')); });
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/listening on port (\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const headers = { Authorization: 'Bearer test-access', 'Content-Type': 'application/json' };
  const personal = { ...headers, 'X-Gemini-Api-Key': 'test.personal-key+123/=!:@', 'X-Gemini-Model': 'gemini-test' };
  const body = { bookId: 'test', chapterId: '1', force: true };
  const post = (route, requestHeaders = personal, data) => fetch(`http://127.0.0.1:${port}/api/${route}`, {
    method: 'POST', headers: requestHeaders, body: data ? JSON.stringify(data) : undefined,
  });
  assert.equal((await post('gemini-check', {})).status, 401);
  assert.equal((await post('gemini-check', headers)).status, 400);
  assert.equal((await post('gemini-check', { ...personal, 'X-Gemini-Api-Key': 'invalid' })).status, 400);
  assert.equal((await post('gemini-check', { ...personal, 'X-Gemini-Model': 'https://evil.invalid' })).status, 400);
  const checked = await post('gemini-check');
  assert.equal(checked.status, 200);
  assert.deepEqual(await checked.json(), { ok: true, model: 'gemini-test' });
  const denied = await post('gemini-check', { ...personal, 'X-Gemini-Model': 'gemini-denied' });
  assert.equal(denied.status, 400);
  assert.ok(!(await denied.text()).includes('raw-secret'));
  assert.equal((await post('gemini-check', { ...personal, 'X-Gemini-Model': 'gemini-busy' })).status, 429);
  for (const [route, field, source] of [
    ['chapter-summary', 'summary', 'gemini'], ['chapter-translation', 'translation', 'gemini'], ['chapter-content', 'content', 'gemini-vision'],
  ]) {
    assert.equal((await post(route, headers, body)).status, 400, `${route} needs credentials`);
    const generated = await post(route, personal, body);
    const result = await generated.json();
    assert.equal(generated.status, 200, `${route}: ${JSON.stringify(result)}`);
    assert.equal(result.source, source);
    assert.ok(result[field]);
    // A different personal key cannot reuse another account's in-flight generation.
    const other = await post(route, { ...personal, 'X-Gemini-Api-Key': 'other-personal-key-1234567890' }, body);
    assert.equal(other.status, 502);
    // Persisted chapter content remains reusable by this private library without generation.
    const cached = await post(route, { ...personal, 'X-Gemini-Api-Key': 'other-personal-key-1234567890' }, { ...body, force: false });
    assert.equal((await cached.json()).source, 'cache');
  }
  assert.equal((await post('chapter-translation', personal, { ...body, provider: 'removed-provider' })).status, 400);
  assert.equal((await post('chapter-translation', personal, { ...body, provider: 'ai' })).status, 200);
});
