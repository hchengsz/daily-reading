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
  sourceType?: 'pdf' | 'epub';
  pageCount: number;
  processingMode?: 'scg' | 'generic';
  visionOcrPageCount?: number;
  chapters: Chapter[];
};

export const books = rawLibrary.books as Book[];

export type Library = {
  books: Book[];
};

export const fallbackLibrary = rawLibrary as Library;

export function getBookFrom(library: Library, id: string) {
  return library.books.find((book) => book.id === id);
}

export function getChapterFrom(library: Library, bookId: string, chapterId: string) {
  return getBookFrom(library, bookId)?.chapters.find((chapter) => chapter.id === chapterId);
}

export function getBook(id: string) {
  return getBookFrom(fallbackLibrary, id);
}

export function getChapter(bookId: string, chapterId: string) {
  return getChapterFrom(fallbackLibrary, bookId, chapterId);
}
