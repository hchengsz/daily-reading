import { readStoredFile, writeStoredFile } from '@/lib/server-storage';

import type { Book, Library } from '@/lib/book';

import { libraryPath } from '@/lib/server-paths';

export async function readLibrary(): Promise<Library> {
  const text = (await readStoredFile(libraryPath)).toString('utf8');
  const library = JSON.parse(text) as Library;
  if (!Array.isArray(library.books)) throw new Error('书库格式无效');
  return library;
}

export async function writeLibrary(library: Library) {
  await writeStoredFile(libraryPath, JSON.stringify(library, null, 0));
}

export function getServerBook(library: Library, bookId: string) {
  return library.books.find((book) => book.id === bookId);
}

export function getServerChapter(library: Library, bookId: string, chapterId: string) {
  return getServerBook(library, bookId)?.chapters.find((chapter) => chapter.id === chapterId);
}

let writeQueue: Promise<unknown> = Promise.resolve();

export function upsertBook(book: Book): Promise<Library> {
  const result = writeQueue.then(() => updateBook(book));
  writeQueue = result.catch(() => undefined);
  return result;
}

async function updateBook(book: Book) {
  const library = await readLibrary();
  const books = library.books.filter((item) => item.id !== book.id && item.sourceFile !== book.sourceFile);
  books.push(book);
  books.sort((left, right) => left.sourceFile.localeCompare(right.sourceFile, 'zh-Hans-CN'));
  const nextLibrary = { books };
  await writeLibrary(nextLibrary);
  return nextLibrary;
}
