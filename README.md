# Daily Reading

Daily Reading is a local reading app built with Expo and React Native. Its purpose is simple: take PDF books from the local `books/` folder, extract their text into mobile-friendly reading sections, and optionally provide AI-generated chapter summaries and AI vision OCR correction for difficult scanned books.

The project is especially optimized for older Chinese theological, philosophical, and church-history PDFs whose OCR quality can be uneven, such as *Summa Contra Gentiles* in Chinese translation.

## Features

### 1. Local Library

- The home screen displays all books in the current library.
- Each book card shows the title, author, section count, and PDF page count.
- Users can hide books from the shelf and restore hidden books later.
- Library data is stored in `data/library.json`.
- At runtime, the app can also fetch the latest library through the local API route.

### 2. Chapter-Based Reading

- PDF text is extracted and converted into mobile-friendly reading sections.
- The reader screen supports:
  - Chapter or section title
  - Current book section
  - Original PDF start page
  - Previous / next navigation
  - Font size controls
  - Paragraph-based text rendering to avoid iOS issues with extremely long `<Text>` blocks

### 3. AI Chapter Summaries

Each chapter has an AI summary panel at the top.

- AI summaries do not run automatically, which prevents accidental token usage.
- The user must click the summary button manually.
- Generated summaries are saved locally:

```text
data/ai-cache/summaries/<bookId>/<chapterId>.txt
```

- If the user is not satisfied, they can regenerate the summary.
- Regeneration calls Gemini again and updates the local cache.

### 4. AI Vision OCR Correction

Some books have poor built-in OCR and support manual AI vision correction.

Currently supported:

- The four *Summa Contra Gentiles* volumes
- *The City of God*
- User-added books that are imported with “Summa Contra Gentiles mode”

Behavior:

- AI OCR does not run automatically.
- The user must manually click the AI correction button.
- If a cached correction exists, the app uses the cached text first.
- Corrected OCR text is saved to:

```text
data/ai-cache/ocr/<bookId>/<chapterId>.txt
```

- If AI correction fails, the app keeps showing the original OCR text.

### 5. User-Added Books

The library home screen includes an “Add Book” entry.

Users can:

1. Pick a PDF from the device or computer.
2. Enter title, author, and translator.
3. Choose a processing mode:
   - “Summa Contra Gentiles mode”
   - “Generic PDF mode”
4. Save the PDF into `books/`.
5. Write the new book record into `data/library.json`.

#### Summa Contra Gentiles Mode

This mode is intended for older scanned books, especially when:

- OCR has frequent errors
- Chapters are marked with regular numbered chapter headings
- The book may benefit from AI vision OCR correction

Processing behavior:

- The importer tries to detect chapter headings near the beginning of each page.
- It generates chapter-like reading nodes.
- It enables manual AI OCR correction for the imported book.

#### Generic PDF Mode

This mode is intended for regular PDFs or books with a cleaner structure.

Processing behavior:

- The importer first tries to use the PDF outline / bookmarks.
- If no outline exists, it splits the PDF into stable page-based reading chunks.
- AI vision OCR correction is disabled by default.

## Current Built-In Books

The current `books/` folder includes:

- *Summa Contra Gentiles: On the Truth of the Catholic Faith* volume 1
- *Summa Contra Gentiles* volume 2
- *Summa Contra Gentiles* volume 3
- *Summa Contra Gentiles* volume 4
- *2,000 Years of Christ’s Power: The Middle Ages*
- *The City of God*
- *Catechumen Guide*
- *On the Incarnation*

The actual active library is defined by `data/library.json`.

## Tech Stack

- Expo SDK 54
- Expo Router
- React Native
- TypeScript
- `expo-document-picker` for selecting PDF files
- `pdfjs-dist` for server-side PDF text extraction in API routes
- `pdf-lib` for extracting page ranges before sending them to Gemini vision OCR
- `undici` for server-side Gemini API requests with optional proxy support
- Python scripts for batch extraction and offline OCR workflows

## Project Structure

```text
app/
  index.tsx                       Library home screen
  add-book.tsx                    Add-book screen
  book/[id].tsx                   Book table of contents
  reader/[bookId]/[chapterId].tsx Reader screen
  api/
    library+api.ts                Reads the latest library
    add-book+api.ts               Uploads PDF and updates the library
    chapter-summary+api.ts        AI chapter summary endpoint
    chapter-content+api.ts        AI vision OCR correction endpoint

components/
  chapter-summary.tsx             AI summary component
  live-chapter-text.tsx           Reading text and AI OCR correction component

lib/
  book.ts                         Book types and static fallback library
  use-library.ts                  Client hook for loading the latest library
  server-library.ts               Server-side library read/write helpers
  server-pdf-books.ts             Server-side PDF extraction and splitting
  library-storage.ts              Local hide/restore shelf storage

scripts/
  extract-book.py                 Batch-extracts PDFs from books/ into data/library.json
  vision-ocr.py                   Batch AI vision OCR helper script

books/                            Source PDF files
data/
  library.json                    Book and chapter data
  ai-cache/                       Local AI summary/OCR cache
```

## Environment Variables

AI features depend on Gemini configuration in `.env`.

Common variables:

```env
GEMINI_API_KEY=your Gemini API key
GEMINI_VOCAB_MODEL=gemini-...
HTTP_PROXY=http://127.0.0.1:xxxx
HTTPS_PROXY=http://127.0.0.1:xxxx
```

Notes:

- `GEMINI_API_KEY` is used for AI summaries and AI vision OCR.
- `GEMINI_VOCAB_MODEL` is the Gemini model name.
- `HTTP_PROXY` and `HTTPS_PROXY` are optional and useful when the local network requires a proxy.
- AI-generated text is stored under `data/ai-cache/` to avoid repeated token usage.

## Installation and Running

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run start:proxy
```

Equivalent Expo command:

```bash
npx expo start --clear
```

Platform helpers:

```bash
npm run ios
npm run android
npm run web
```

## Common Scripts

### Rebuild the Library

```bash
npm run books:rebuild
```

Equivalent:

```bash
python scripts/extract-book.py
```

This reads PDFs from `books/` and regenerates `data/library.json`.

### Batch OCR

```bash
npm run ocr:pilot
```

Runs a small bounded OCR test.

```bash
npm run ocr:all
```

Runs the full OCR workflow and rebuilds the library.

## Recommended Way to Add New Books

The recommended flow is to add books directly in the app:

1. Start the project.
2. Open the library home screen.
3. Click “Add Book”.
4. Pick a PDF.
5. Enter title and author.
6. Choose a processing mode.
7. Click “Add to Library”.

Choose “Summa Contra Gentiles mode” for older scanned books with noisy OCR and regular numbered chapter headings.

Choose “Generic PDF mode” for regular PDFs, PDFs with outlines/bookmarks, or cleaner text layers.

## Data and Cache

### Library Data

```text
data/library.json
```

Stores all books, chapters, extracted text, and page metadata.

### Source PDFs

```text
books/
```

User-added PDFs are copied here.

### AI Cache

```text
data/ai-cache/
```

Cache categories:

```text
data/ai-cache/summaries/  AI chapter summaries
data/ai-cache/ocr/        AI vision OCR corrections
```

This directory is ignored by Git by default, except for `.gitkeep`.

## Design Notes

### Why does AI not run automatically?

AI summaries and OCR corrections consume tokens. To avoid accidental cost, the app requires explicit user action:

- AI summary: generated only after the user clicks the button
- AI OCR: generated only after the user clicks the correction button
- Regeneration is also manual

### Why render text in multiple blocks?

iOS can struggle when tens of thousands of characters are rendered inside a single React Native `<Text>` component. The app splits text into paragraph-sized blocks so long chapters remain readable and stable.

### Why are there two PDF processing modes?

PDF structure varies a lot:

- Older scanned books may have noisy OCR but recognizable chapter headings.
- Regular PDFs may have usable outlines/bookmarks.

Letting the user choose a mode is more reliable than forcing every PDF through one algorithm.

## Troubleshooting

### 1. `npm run start:proxy` says port 8081 is already in use

An old Expo dev server is probably still running. Close the old terminal or stop the Node process using port 8081, then start again.

### 2. `[UNDICI-EHPA] EnvHttpProxyAgent is experimental`

This is an `undici` warning in proxy-enabled environments. It usually does not affect the app.

### 3. AI summary generation fails

Check:

- `.env` contains `GEMINI_API_KEY`
- `.env` contains `GEMINI_VOCAB_MODEL`
- The network or proxy can reach the Gemini API

### 4. AI OCR says the chapter has too many pages

Realtime OCR has a page limit to avoid sending very large PDFs to Gemini in one request. Use it on shorter chapters or split the book into smaller reading sections.

### 5. A newly added PDF does not appear immediately

Return to the library screen and refresh/reopen it, or restart the dev server. The shelf tries to read `/api/library` first and falls back to the bundled `data/library.json` if the API is unavailable.

## Development Checks

Type check:

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

## Notes

This project is currently designed as a local personal reading tool, not as a multi-user cloud library. PDFs, extracted library JSON, and AI caches all live in the local project directory. This keeps the workflow simple, transparent, and easy to inspect or manually correct.
