import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'daily-reading:hidden-books';
const listeners = new Set<() => void>();

function readHiddenBooks(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

let hiddenBooks = readHiddenBooks();

function save(next: string[]) {
  hiddenBooks = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
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
