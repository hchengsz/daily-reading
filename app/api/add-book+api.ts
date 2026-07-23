import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createBookFromEpub, createBookFromPdf, sanitizeFileName, slugifyBookId, AddBookMode } from '@/lib/server-pdf-books';
import { readLibrary, upsertBook } from '@/lib/server-library';

const booksDir = path.join(process.cwd(), 'books');
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData() as unknown as { get(name: string): FormDataEntryValue | null };
    const file = form.get('file');
    const mode = form.get('mode');
    const title = form.get('title');
    const author = form.get('author');
    const translator = form.get('translator');

    if (!(file instanceof File)) {
      return Response.json({ error: '请选择 PDF 或 EPUB 文件' }, { status: 400 });
    }
    if (mode !== 'scg' && mode !== 'generic') {
      return Response.json({ error: '处理模式无效' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: '文件不能超过 80MB' }, { status: 400 });
    }

    const sourceFile = await uniqueSourceFile(sanitizeFileName(file.name || 'book.pdf'));
    const isEpub = sourceFile.toLowerCase().endsWith('.epub');
    const isPdf = sourceFile.toLowerCase().endsWith('.pdf');
    if (!isPdf && !isEpub) {
      return Response.json({ error: '只支持 PDF 或 EPUB 文件' }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) return Response.json({ error: '文件为空' }, { status: 400 });

    const bookTitle = stringValue(title) || sourceFile.replace(/\.(pdf|epub)$/i, '');
    const baseBookInput = {
      id: await uniqueBookId(slugifyBookId(bookTitle)),
      title: bookTitle,
      author: stringValue(author) || '未知作者',
      translator: stringValue(translator),
      sourceFile,
    };
    const book = isEpub
      ? createBookFromEpub({ ...baseBookInput, epubBytes: bytes })
      : await createBookFromPdf({ ...baseBookInput, pdfBytes: bytes, mode: mode as AddBookMode });

    if (!book.chapters.length) {
      return Response.json({ error: '没有从文件中提取到可用正文' }, { status: 422 });
    }

    await mkdir(booksDir, { recursive: true });
    await writeFile(path.join(booksDir, sourceFile), bytes);

    const library = await upsertBook(book);
    return Response.json({ book, library });
  } catch (error) {
    const message = error instanceof Error ? error.message : '添加图书失败';
    return Response.json({ error: message }, { status: 500 });
  }
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

async function uniqueSourceFile(fileName: string) {
  const library = await readLibrary();
  const existing = new Set(library.books.map((book) => book.sourceFile));
  if (!existing.has(fileName) && !(await fileExists(path.join(booksDir, fileName)))) return fileName;

  const extension = path.extname(fileName) || '.pdf';
  const stem = path.basename(fileName, extension);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!existing.has(candidate) && !(await fileExists(path.join(booksDir, candidate)))) return candidate;
  }
  return `${stem}-${Date.now()}${extension}`;
}

async function fileExists(fileName: string) {
  try {
    await access(fileName);
    return true;
  } catch {
    return false;
  }
}

async function uniqueBookId(id: string) {
  const library = await readLibrary();
  const existing = new Set(library.books.map((book) => book.id));
  if (!existing.has(id)) return id;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${id}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${id}-${Date.now()}`;
}
