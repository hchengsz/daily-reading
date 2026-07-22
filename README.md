# Daily Reading

Daily Reading is a personal reading app for turning local PDF books into a comfortable mobile reading experience. It is built with Expo, React Native, and Expo Router, with extra tooling for older scanned books whose OCR text is often messy.

The app started as a reader for theological and philosophical classics, especially long Chinese-language PDFs such as *Summa Contra Gentiles*, *The City of God*, and church history texts. It now supports importing new PDFs directly from the app, choosing how they should be processed, and using Gemini to generate reading aids when needed.

## What the app does

Daily Reading is designed around a simple workflow:

1. Store PDF books locally.
2. Extract their text into readable sections.
3. Present those sections in a clean mobile reader.
4. Let the reader ask AI for summaries or OCR correction only when they want it.
5. Cache AI output locally so the same chapter does not have to be regenerated again and again.

It is not a cloud bookshelf or a multi-user library system. Everything is local to the project folder: PDFs, extracted text, generated summaries, and OCR corrections.

## Main features

### Local bookshelf

The home screen shows the current library as a set of book cards. Each card includes the book title, author, number of reading sections, and total PDF page count.

Books can be hidden from the shelf without deleting the underlying PDF or extracted data. Hidden books can be restored later.

### Mobile-first reading

The reader screen is built for long-form reading on a phone:

- readable chapter layout
- previous and next section navigation
- adjustable font size
- PDF start-page metadata
- paragraph-based text rendering for long chapters

The paragraph rendering matters. React Native on iOS can become unstable when a very large chapter is rendered as one giant `<Text>` node. Daily Reading splits text into smaller blocks so long chapters remain readable.

### AI chapter summaries

Each reading section can have an AI-generated summary.

AI summaries are intentionally manual. Opening a chapter does not call Gemini automatically. The reader chooses when to generate a summary, which prevents accidental token usage.

Generated summaries are saved here:

```text
data/ai-cache/summaries/<bookId>/<chapterId>.txt
```

If a cached summary exists, the app reuses it. If the reader wants a better result, they can regenerate it.

### AI vision OCR correction

Some scanned books have poor embedded OCR. For those books, the app can send the relevant PDF pages to Gemini and ask it to transcribe the page images more carefully.

This feature is also manual. The reader has to press the correction button; the app does not run vision OCR automatically.

Corrected text is saved here:

```text
data/ai-cache/ocr/<bookId>/<chapterId>.txt
```

If correction fails, the original extracted OCR text remains available.

### Add books from the app

The app includes an Add Book screen. A user can pick a PDF, enter basic metadata, and choose a processing mode.

The imported PDF is copied into:

```text
books/
```

The extracted book record is written into:

```text
data/library.json
```

The bookshelf reads the latest library through a local API route, so newly imported books can appear without manually editing code.

## PDF processing modes

When adding a book, the user chooses one of two modes.

### Summa Contra Gentiles mode

Use this for older scanned books with noisy OCR and chapter-like headings.

This mode tries to detect numbered chapter headings near the top of pages. It also enables manual AI vision OCR correction for the imported book.

This mode is best for books that resemble the existing *Summa Contra Gentiles* PDFs: long, old, scanned, and not always cleanly structured.

### Generic PDF mode

Use this for ordinary PDFs.

This mode first looks for a PDF outline or bookmark structure. If one exists, the book is split around those outline entries. If the PDF has no useful outline, the app falls back to stable page-based chunks.

This mode does not enable AI vision OCR correction by default.

## Built-in books

The current project includes several PDFs in `books/`, including:

- *Summa Contra Gentiles* volume 1
- *Summa Contra Gentiles* volume 2
- *Summa Contra Gentiles* volume 3
- *Summa Contra Gentiles* volume 4
- *2,000 Years of Christ’s Power: The Middle Ages*
- *The City of God*
- *Catechumen Guide*
- *On the Incarnation*

The active library is defined by `data/library.json`, not just by the files present in `books/`.

## Tech stack

- Expo SDK 54
- Expo Router
- React Native
- TypeScript
- `expo-document-picker` for choosing PDF files
- `pdfjs-dist` for extracting PDF text in API routes
- `pdf-lib` for slicing page ranges before AI vision OCR
- `undici` for server-side Gemini requests and proxy support
- Python scripts for batch extraction and OCR workflows

## Project layout

```text
app/
  index.tsx
  add-book.tsx
  book/[id].tsx
  reader/[bookId]/[chapterId].tsx
  api/
    add-book+api.ts
    library+api.ts
    chapter-summary+api.ts
    chapter-content+api.ts

components/
  chapter-summary.tsx
  live-chapter-text.tsx

lib/
  book.ts
  use-library.ts
  server-library.ts
  server-pdf-books.ts
  library-storage.ts

scripts/
  extract-book.py
  vision-ocr.py

books/
data/
  library.json
  ai-cache/
```

## Important files

### `data/library.json`

This is the extracted library. It contains book metadata, chapter metadata, extracted text, and page information.

### `books/`

This folder stores the source PDFs. User-imported PDFs are copied here.

### `data/ai-cache/`

This folder stores generated AI text.

```text
data/ai-cache/summaries/
data/ai-cache/ocr/
```

The cache directory is ignored by Git except for `.gitkeep`.

### `scripts/extract-book.py`

This script rebuilds `data/library.json` from PDFs in `books/`. It is useful when maintaining the built-in library manually.

### `scripts/vision-ocr.py`

This script is for batch OCR workflows and experiments. The app itself uses API routes for on-demand AI correction.

## Environment variables

Gemini-powered features require a `.env` file.

Example:

```env
GEMINI_API_KEY=your-api-key
GEMINI_VOCAB_MODEL=gemini-...
HTTP_PROXY=http://127.0.0.1:xxxx
HTTPS_PROXY=http://127.0.0.1:xxxx
```

`HTTP_PROXY` and `HTTPS_PROXY` are optional. They are useful if Gemini requests need to go through a local proxy.

Do not expose Gemini keys through `EXPO_PUBLIC_` variables. The current API routes read server-side environment variables.

## Getting started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run start:proxy
```

This runs:

```bash
expo start --clear
```

Other useful commands:

```bash
npm run ios
npm run android
npm run web
```

## Working with books

### Add a book through the app

1. Start the development server.
2. Open the app.
3. Go to the bookshelf.
4. Press Add Book.
5. Pick a PDF.
6. Enter title, author, and optional translator.
7. Choose a processing mode.
8. Add the book to the library.

### Rebuild the built-in library manually

```bash
npm run books:rebuild
```

This regenerates:

```text
data/library.json
```

from the PDFs in:

```text
books/
```

### Run a small OCR test

```bash
npm run ocr:pilot
```

### Run the full OCR workflow

```bash
npm run ocr:all
```

## Development checks

TypeScript:

```bash
npx tsc --noEmit
```

Lint:

```bash
npm run lint
```

Web export:

```bash
npx expo export --platform web
```

## Troubleshooting

### Port 8081 is already in use

An old Expo development server is still running. Stop the old Node process or close the terminal that started it, then run the dev server again.

### `EnvHttpProxyAgent is experimental`

This warning comes from `undici` when proxy environment variables are enabled. It is usually harmless.

### AI summaries fail

Check that:

- `GEMINI_API_KEY` is set
- `GEMINI_VOCAB_MODEL` is set
- your proxy configuration works, if a proxy is required
- the dev server was restarted after editing `.env`

### AI OCR refuses a chapter because it is too long

The OCR endpoint limits how many pages can be sent in one request. This protects against very large Gemini requests. Use OCR on shorter sections, or split the book more finely.

### A newly added book does not appear

Return to the bookshelf and reopen it, or restart the development server. The app tries to load the latest library from `/api/library` and falls back to the bundled JSON if the API is unavailable.

## Notes

This project favors transparency over automation. Generated files are plain JSON or text files, PDFs remain in the local filesystem, and AI output is cached in readable `.txt` files. That makes it easy to inspect, edit, back up, or delete any part of the reading library.
