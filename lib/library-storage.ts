import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

const storageFile = new File(Paths.document, 'daily-reading-hidden-books.json');
const listeners = new Set<() => void>();

function readHiddenBooks(): string[] {
  try {
    if (!storageFile.exists) return [];
    const value = JSON.parse(storageFile.textSync());
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

let hiddenBooks = readHiddenBooks();

function save(next: string[]) {
  hiddenBooks = next;
  try {
    if (!storageFile.exists) storageFile.create();
    storageFile.write(JSON.stringify(next));
  } finally {
    listeners.forEach((listener) => listener());
  }
}

export function hideBook(bookId: string) {
  if (!hiddenBooks.includes(bookId)) save([...hiddenBooks, bookId]);
}

export function restoreAllBooks() {
  save([]);
}

export function useHiddenBooks() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => hiddenBooks,
    () => [],
  );
}
