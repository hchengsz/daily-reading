import rawLibrary from '@/data/library.json';

export type Chapter = {
  id: string;
  section: string;
  title: string;
  content: string;
  startPage: number;
};

export type Book = {
  id: string;
  title: string;
  author: string;
  translator: string;
  sourceFile: string;
  pageCount: number;
  chapters: Chapter[];
};

export const books = rawLibrary.books as Book[];

export function getBook(id: string) {
  return books.find((book) => book.id === id);
}

export function getChapter(bookId: string, chapterId: string) {
  return getBook(bookId)?.chapters.find((chapter) => chapter.id === chapterId);
}
