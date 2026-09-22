import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createStorage } from '../lib/server-storage.ts';

const root = path.resolve(process.env.DAILY_READING_STORAGE_ROOT || process.cwd());
const libraryFile = path.join(root, 'data/library.json');
const library = JSON.parse(await readFile(libraryFile, 'utf8'));
const files = library.books.map((book) => path.join(root, 'books', book.sourceFile));
async function cachedFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await cachedFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.txt')) result.push(file);
  }
  return result;
}
files.push(...await cachedFiles(path.join(root, 'data/ai-cache')), libraryFile);
let total = 0;
for (const file of files) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe source path');
  const size = (await stat(file)).size;
  if (size > 50 * 1024 * 1024) throw new Error(`File exceeds free storage limit: ${relative}`);
  total += size;
}
console.log(`Migration plan: ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB. Existing cloud data will not be overwritten.`);
if (process.argv.includes('--apply')) {
  const storage = createStorage({ root, provider: 'supabase' });
  for (const file of files) {
    const bytes = await readFile(file);
    try {
      const existing = await storage.read(file);
      if (!existing.equals(bytes)) throw new Error('Cloud content differs. Migration stopped to preserve existing data.');
      console.log('Already migrated:', path.relative(root, file));
      continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await storage.write(file, bytes, false);
    console.log('Migrated:', path.relative(root, file));
  }
  await storage.write(path.join(root, 'data/ready.txt'), 'daily-reading-ready-v1');
  console.log('Migration completed; library and readiness marker were written last.');
} else {
  console.log('Dry run only. Set Supabase runtime credentials and pass --apply to migrate.');
}
