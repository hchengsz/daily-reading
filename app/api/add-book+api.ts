import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createBookFromEpub, createBookFromPdf, sanitizeFileName, slugifyBookId, AddBookMode } from '@/lib/server-pdf-books';
import { upsertBook } from '@/lib/server-library';

import { booksDir } from '@/lib/server-paths';
import { writeStoredFile } from '@/lib/server-storage';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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
      return Response.json({ error: '文件不能超过 50MB' }, { status: 400 });
    }

    const sourceFile = `${randomUUID()}-${sanitizeFileName(file.name || 'book.pdf')}`;
    const isEpub = sourceFile.toLowerCase().endsWith('.epub');
    const isPdf = sourceFile.toLowerCase().endsWith('.pdf');
    if (!isPdf && !isEpub) {
      return Response.json({ error: '只支持 PDF 或 EPUB 文件' }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) return Response.json({ error: '文件为空' }, { status: 400 });

    const bookTitle = stringValue(title) || sourceFile.replace(/\.(pdf|epub)$/i, '');
    const baseBookInput = {
      id: `${slugifyBookId(bookTitle)}-${randomUUID()}`,
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

    await writeStoredFile(path.join(booksDir, sourceFile), bytes);

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
