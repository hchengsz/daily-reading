/* global __dirname */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash, timingSafeEqual } = require('node:crypto');
const { createRequestHandler } = require('expo-server/adapter/http');

const build = path.resolve(__dirname, '../dist/server');
const storageRoot = path.resolve(process.env.DAILY_READING_STORAGE_ROOT || path.join(__dirname, '..'));
const handler = createRequestHandler({ build });
const cloud = process.env.STORAGE_PROVIDER === 'supabase';
const accessToken = process.env.BACKEND_ACCESS_TOKEN;
if (cloud && (!accessToken || accessToken.length < 32)) {
  throw new Error('Cloud deployment requires a BACKEND_ACCESS_TOKEN of at least 32 characters.');
}
const tokenHash = (value) => createHash('sha256').update(value).digest();

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/healthz' && req.method === 'GET') {
    try {
      if (cloud) {
        // Tiny marker avoids repeatedly downloading the entire library for platform health checks.
        const storage = await import('../lib/server-storage.ts');
        const marker = await storage.readStoredFile(path.join(storageRoot, 'data/ready.txt'));
        if (marker.toString() !== 'daily-reading-ready-v1') throw new Error('Storage not initialized');
      } else {
        await fs.access(path.join(storageRoot, 'data/library.json'));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unavailable' }));
    }
    return;
  }
  // Never serve book files, source code, secrets or the exported web client.
  if (!pathname.startsWith('/api/')) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (accessToken && !timingSafeEqual(tokenHash(req.headers.authorization || ''), tokenHash(`Bearer ${accessToken}`))) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请先配置测试版访问凭据' }));
    return;
  }
  await handler(req, res, () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '服务暂时不可用' }));
    } else {
      res.end();
    }
  });
});

server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
  console.log('Daily Reading backend listening on port', server.address().port);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
