import path from 'node:path';

// In production, point this at a persistent volume containing data/ and books/.
export const storageRoot = path.resolve(process.env.DAILY_READING_STORAGE_ROOT || process.cwd());
export const libraryPath = path.join(storageRoot, 'data', 'library.json');
export const booksDir = path.join(storageRoot, 'books');
export const aiCacheRoot = path.join(storageRoot, 'data', 'ai-cache');
