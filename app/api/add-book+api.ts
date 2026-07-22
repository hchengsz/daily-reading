import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createBookFromPdf, sanitizeFileName, slugifyBookId, AddBookMode } from '@/lib/server-pdf-books';
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
      return Response.json({ error: '请选择 PDF 文件' }, { status: 400 });
    }
    if (mode !== 'scg' && mode !== 'generic') {
      return Response.json({ error: '处理模式无效' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: 'PDF 不能超过 80MB' }, { status: 400 });
    }

    const sourceFile = await uniqueSourceFile(sanitizeFileName(file.name || 'book.pdf'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) return Response.json({ error: 'PDF 文件为空' }, { status: 400 });

    await mkdir(booksDir, { recursive: true });
    await writeFile(path.join(booksDir, sourceFile), bytes);

    const bookTitle = stringValue(title) || sourceFile.replace(/\.pdf$/i, '');
    const book = await createBookFromPdf({
      id: await uniqueBookId(slugifyBookId(bookTitle)),
      title: bookTitle,
      author: stringValue(author) || '未知作者',
      translator: stringValue(translator),
      sourceFile,
      pdfBytes: bytes,
      mode: mode as AddBookMode,
    });

    if (!book.chapters.length) {
      return Response.json({ error: '没有从 PDF 中提取到可用正文' }, { status: 422 });
    }

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
  if (!existing.has(fileName)) return fileName;

  const extension = path.extname(fileName) || '.pdf';
  const stem = path.basename(fileName, extension);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${extension}`;
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
