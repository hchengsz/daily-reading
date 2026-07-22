import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Book, Library, getBookFrom, getChapterFrom } from '@/lib/book';

const libraryPath = path.join(process.cwd(), 'data', 'library.json');

export async function readLibrary(): Promise<Library> {
  const text = await readFile(libraryPath, 'utf-8');
  const library = JSON.parse(text) as Library;
  if (!Array.isArray(library.books)) throw new Error('书库格式无效');
  return library;
}

export async function writeLibrary(library: Library) {
  await writeFile(libraryPath, JSON.stringify(library, null, 0), 'utf-8');
}

export function getServerBook(library: Library, bookId: string) {
  return getBookFrom(library, bookId);
}

export function getServerChapter(library: Library, bookId: string, chapterId: string) {
  return getChapterFrom(library, bookId, chapterId);
}

export async function upsertBook(book: Book) {
  const library = await readLibrary();
  const books = library.books.filter((item) => item.id !== book.id && item.sourceFile !== book.sourceFile);
  books.push(book);
  books.sort((left, right) => left.sourceFile.localeCompare(right.sourceFile, 'zh-Hans-CN'));
  const nextLibrary = { books };
  await writeLibrary(nextLibrary);
  return nextLibrary;
}
