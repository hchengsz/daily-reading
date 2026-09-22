import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

type StorageOptions = {
  root?: string;
  provider?: string;
  url?: string;
  key?: string;
  bucket?: string;
  transport?: typeof fetch;
};

// Both the API and migration script use the same keys, including for Chinese filenames.
export function createStorage(options: StorageOptions = {}) {
  const root = path.resolve(options.root || process.env.DAILY_READING_STORAGE_ROOT || process.cwd());
  const provider = options.provider || process.env.STORAGE_PROVIDER || 'local';
  const url = options.url ?? process.env.SUPABASE_URL;
  const key = options.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = options.bucket || process.env.SUPABASE_STORAGE_BUCKET || 'daily-reading';
  const transport = options.transport || fetch;
  if (!['local', 'supabase'].includes(provider)) throw new Error('未知存储方式');
  if (provider === 'supabase' && (!url || !key || new URL(url).protocol !== 'https:')) {
    throw new Error('请配置 Supabase HTTPS 地址和服务端密钥');
  }
  if (provider === 'supabase' && key?.startsWith('sb_publishable_')) {
    throw new Error('云存储需要服务端 Secret key，不能使用 publishable key');
  }

  function location(file: string) {
    const resolved = path.resolve(file);
    const relative = path.relative(root, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('存储路径超出允许范围');
    }
    const normalized = relative.split(path.sep).join('/');
    const objectKey = `files/${createHash('sha256').update(normalized).digest('hex')}`;
    return { resolved, objectUrl: `${url?.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey}` };
  }

  function missing() {
    return Object.assign(new Error('文件不存在'), { code: 'ENOENT' });
  }

  async function remote(file: string, method: 'GET' | 'POST', body?: Uint8Array, overwrite = true) {
    const response = await transport(location(file).objectUrl, {
      method,
      headers: {
        apikey: key!,
        ...(key!.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
        ...(method === 'POST' ? { 'Content-Type': 'application/octet-stream', 'x-upsert': String(overwrite) } : {}),
      },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { code?: string; error?: string; message?: string };
      // Bucket/auth/network failures must never be mistaken for a cache miss.
      if (error.code === 'NoSuchKey' || error.code === 'ObjectNotFound' ||
          (error.error === 'not_found' && error.message === 'Object not found')) throw missing();
      throw new Error(`云存储请求失败（${response.status}）；请检查存储桶、权限和额度`);
    }
    return response;
  }

  async function read(file: string): Promise<Buffer> {
    if (provider === 'local') return readFile(location(file).resolved);
    return Buffer.from(await (await remote(file, 'GET')).arrayBuffer());
  }

  async function write(file: string, data: string | Uint8Array, overwrite = true) {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    if (provider === 'supabase') {
      if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('免费云存储单个文件不能超过 50MB');
      await remote(file, 'POST', bytes, overwrite);
      return;
    }
    const { resolved } = location(file);
    await mkdir(path.dirname(resolved), { recursive: true });
    if (!overwrite) {
      await writeFile(resolved, bytes, { flag: 'wx' });
      return;
    }
    const temporary = `${resolved}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, resolved);
  }

  return { read, write, provider };
}

// Lazy initialization keeps backend credentials out of the build environment.
let storage: ReturnType<typeof createStorage> | undefined;
function currentStorage() { return storage ??= createStorage(); }
export function readStoredFile(file: string) { return currentStorage().read(file); }
export function writeStoredFile(file: string, data: string | Uint8Array) { return currentStorage().write(file, data); }
export async function readCachedText(file: string) {
  try { return (await readStoredFile(file)).toString('utf8').trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
export const writeCachedText = writeStoredFile;
