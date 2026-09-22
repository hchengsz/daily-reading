import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

test('exported backend protects API data and accepts authenticated requests', async (context) => {
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, ['scripts/serve-backend.cjs'], {
    windowsHide: true,
    env: { ...process.env, STORAGE_PROVIDER: 'local', HOST: '127.0.0.1', PORT: '0', BACKEND_ACCESS_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Backend startup timed out')), 20_000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Backend exited: ${code}`)); });
    child.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/listening on port (\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/api/library`)).status, 401);
  assert.equal((await fetch(`${base}/api/library`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const library = await fetch(`${base}/api/library`, { headers });
  assert.equal(library.status, 200);
  assert.ok(Array.isArray((await library.json()).books));
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/books/test.pdf`)).status, 404);
  assert.equal((await fetch(`${base}/api/chapter-translation`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId: 'missing', chapterId: 'invalid', provider: 'ai' }),
  })).status, 400);
});
