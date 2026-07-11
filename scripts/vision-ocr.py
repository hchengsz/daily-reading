"""Re-transcribe scanned PDF pages with Gemini vision, with resumable caching."""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from pypdf import PdfReader, PdfWriter


ROOT = Path(__file__).resolve().parents[1]
BOOKS_DIR = ROOT / "books"
CACHE_DIR = ROOT / "data" / "vision-ocr"


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.strip())
        if not match:
            continue
        value = match.group(2).strip().strip('"').strip("'")
        os.environ.setdefault(match.group(1), value)


def book_id(source: Path) -> str:
    stem = source.stem
    if stem.startswith("1."):
        return "scg-truth"
    if stem.startswith("2."):
        return "scg-creation"
    if stem.startswith("3."):
        return "scg-providence"
    if stem.startswith("4."):
        return "scg-mysteries"
    if "慕道者" in stem:
        return "catechumen-guide"
    return "summa-contra-gentiles"


def make_pdf_batch(reader: PdfReader, page_indexes: list[int]) -> bytes:
    writer = PdfWriter()
    for page_index in page_indexes:
        writer.add_page(reader.pages[page_index])
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def request_transcription(pdf_bytes: bytes, page_numbers: list[int], retries: int = 4) -> list[dict]:
    api_key = os.environ.get("GEMINI_API_KEY")
    model = os.environ.get("GEMINI_VOCAB_MODEL", "").removeprefix("models/")
    if not api_key or not model:
        raise RuntimeError(".env must define GEMINI_API_KEY and GEMINI_VOCAB_MODEL")

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    expected = ", ".join(str(number) for number in page_numbers)
    payload = {
        "systemInstruction": {"parts": [{"text": (
            "你是严谨的中文古籍和神学著作校录员。你的任务是看PDF页面图像逐字转录，"
            "不是总结、翻译或润色。保留原文繁体/简体、标点、标题和段落。"
            "忽略纯页码及重复页眉页脚。明显看不清的单字写作〔疑字〕，绝不凭常识补写整句。"
        )}]},
        "contents": [{"role": "user", "parts": [
            {"text": (
                f"附件依次对应原书第 {expected} 页。请逐页完整转录。"
                "每个数组项必须对应一页，page使用给出的原书页码，text为该页正文。"
            )},
            {"inlineData": {"mimeType": "application/pdf", "data": base64.b64encode(pdf_bytes).decode("ascii")}},
        ]}],
        "generationConfig": {
            "maxOutputTokens": 16384,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "pages": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "page": {"type": "INTEGER"},
                                "text": {"type": "STRING"},
                            },
                            "required": ["page", "text"],
                        },
                    }
                },
                "required": ["pages"],
            },
        },
    }

    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
            text = "".join(
                part.get("text", "")
                for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            )
            result = json.loads(text)
            pages = result.get("pages", [])
            returned = {item.get("page") for item in pages}
            if returned != set(page_numbers):
                raise ValueError(f"Gemini returned pages {sorted(returned)}, expected {page_numbers}")
            return pages
        except (urllib.error.URLError, ValueError, KeyError, json.JSONDecodeError) as error:
            last_error = error
            if attempt + 1 < retries:
                if isinstance(error, urllib.error.HTTPError) and error.code == 429:
                    retry_after = error.headers.get("Retry-After")
                    delay = int(retry_after) if retry_after and retry_after.isdigit() else 15 * (2 ** attempt)
                    print(f"Gemini rate limited the request; retrying in {delay}s...", flush=True)
                else:
                    delay = 2 ** attempt
                time.sleep(delay)
    raise RuntimeError(f"Gemini transcription failed after {retries} attempts: {last_error}")


def transcribe_book(source: Path, start_page: int, max_pages: int | None, batch_size: int) -> tuple[int, int]:
    reader = PdfReader(source)
    cache = CACHE_DIR / book_id(source)
    cache.mkdir(parents=True, exist_ok=True)
    first_index = max(0, start_page - 1)
    end_index = len(reader.pages) if max_pages is None else min(len(reader.pages), first_index + max_pages)
    pending = [
        index for index in range(first_index, end_index)
        if not (cache / f"page-{index + 1:04d}.txt").exists()
    ]
    completed = 0

    for offset in range(0, len(pending), batch_size):
        batch = pending[offset:offset + batch_size]
        # Avoid combining non-contiguous holes left by a partially completed run.
        contiguous = [batch[0]]
        for index in batch[1:]:
            if index != contiguous[-1] + 1:
                break
            contiguous.append(index)
        numbers = [index + 1 for index in contiguous]
        print(f"{source.name}: transcribing pages {numbers[0]}-{numbers[-1]}...", flush=True)
        results = request_transcription(make_pdf_batch(reader, contiguous), numbers)
        for result in results:
            page = int(result["page"])
            text = str(result["text"]).strip()
            (cache / f"page-{page:04d}.txt").write_text(text, encoding="utf-8")
            completed += 1

    return completed, end_index - first_index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--book", help="Book id or a substring of the PDF filename")
    parser.add_argument("--start-page", type=int, default=1, help="1-based first page")
    parser.add_argument("--max-pages", type=int, help="Maximum pages to process")
    parser.add_argument("--batch-size", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--all", action="store_true", help="Process every page of every book")
    args = parser.parse_args()
    load_env()

    sources = sorted(BOOKS_DIR.glob("*.pdf"), key=lambda path: path.name)
    if args.book:
        sources = [source for source in sources if args.book in source.name or args.book == book_id(source)]
    if not sources:
        parser.error("No matching PDF found")
    if not args.all and args.max_pages is None:
        parser.error("Specify --max-pages for a bounded run, or --all for the complete library")

    total_completed = 0
    for source in sources:
        completed, selected = transcribe_book(
            source,
            args.start_page,
            None if args.all else args.max_pages,
            args.batch_size,
        )
        total_completed += completed
        print(f"{source.name}: cached {completed} new page(s), {selected} selected", flush=True)
    print(f"Done. Cached {total_completed} new page(s) in {CACHE_DIR}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Interrupted; completed page caches are safe and the run can be resumed.", file=sys.stderr)
        raise SystemExit(130)
