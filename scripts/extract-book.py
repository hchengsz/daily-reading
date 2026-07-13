"""Extract the bundled PDF into chapter-oriented JSON for the mobile reader."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "library.json"

CHAPTER_RE = re.compile(r"第([一二三四五六七八九十百零〇○0-9]+)章")
SECTION_RE = re.compile(r"第([一二三四五六七八九十百零〇○0-9]+)节")
CN_DIGITS = {"零": 0, "〇": 0, "○": 0, "一": 1, "二": 2, "三": 3, "四": 4,
             "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def chinese_number(value: str) -> int:
    if value.isdigit():
        return int(value)
    if "百" in value:
        left, right = value.split("百", 1)
        return (CN_DIGITS.get(left, 1) * 100) + chinese_number(right) if right else CN_DIGITS.get(left, 1) * 100
    if "十" in value:
        left, right = value.split("十", 1)
        return (CN_DIGITS.get(left, 1) * 10) + (CN_DIGITS.get(right, 0) if right else 0)
    return CN_DIGITS.get(value, 0)


def clean_page(text: str) -> str:
    lines = [line.strip() for line in text.replace("\u3000", " ").splitlines()]
    kept: list[str] = []
    for line in lines:
        if not line or re.fullmatch(r"[IVXLCDMivxlcdm0-9\-—–.·• ]{1,12}", line):
            continue
        if re.fullmatch(r"(論|古詩|吉布|份|主若|青海).{0,8}", line):
            continue
        kept.append(line)
    text = "\n".join(kept)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def reflow_page(text: str) -> str:
    """Turn the PDF's one-glyph-per-line OCR layer into readable paragraphs."""
    compact = "".join(line.strip() for line in text.splitlines() if line.strip())
    compact = re.sub(r"\s+", "", compact)
    if not compact:
        return ""

    sentences = re.findall(r".*?(?:[。！？!?]+(?:[」』”’])?|$)", compact)
    paragraphs: list[str] = []
    current = ""
    for sentence in sentences:
        if not sentence:
            continue
        current += sentence
        if len(current) >= 220:
            paragraphs.append(current)
            current = ""
    if current:
        paragraphs.append(current)

    # OCR pages with no sentence punctuation still need to wrap naturally, but not
    # as one enormous paragraph.
    if len(paragraphs) == 1 and len(paragraphs[0]) > 520:
        value = paragraphs[0]
        paragraphs = [value[index:index + 260] for index in range(0, len(value), 260)]
    return "\n\n".join(paragraphs)


def chapter_title(text: str, label: str) -> str:
    compact = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(compact[:18]):
        position = line.find(label)
        if position < 0:
            continue
        tail = line[position + len(label):].strip(" :：.。·•-—")
        if len(tail) >= 2:
            return tail[:30]
        if index + 1 < len(compact):
            candidate = compact[index + 1].strip(" :：.。·•-—")
            if candidate and not CHAPTER_RE.search(candidate):
                return candidate[:30]
    compact_text = "".join(compact[:24])
    position = compact_text.find(label)
    if position >= 0:
        tail = compact_text[position + len(label):].strip(" :：.。·•-—")
        if tail:
            return tail[:18]
    return label


def book_metadata(source: Path) -> dict[str, str]:
    stem = source.stem
    if stem.startswith("1."):
        return {"id": "scg-truth", "title": "驳异大全·论真原", "author": "圣多玛斯・阿奎纳", "translator": "吕穆迪 译述"}
    if stem.startswith("2."):
        return {"id": "scg-creation", "title": "驳异大全·论万物", "author": "圣多玛斯・阿奎纳", "translator": "吕穆迪 译述"}
    if stem.startswith("3."):
        return {"id": "scg-providence", "title": "驳异大全·论万事", "author": "圣多玛斯・阿奎纳", "translator": "吕穆迪 译述"}
    if stem.startswith("4."):
        return {"id": "scg-mysteries", "title": "驳异大全·论奥理", "author": "圣多玛斯・阿奎纳", "translator": "吕穆迪 译述"}
    if "慕道者" in stem:
        return {"id": "catechumen-guide", "title": "慕道者指南", "author": "李善修", "translator": ""}
    if "论道成肉身" in stem:
        return {"id": "on-the-incarnation", "title": "论道成肉身", "author": "阿塔那修", "translator": "石敏敏 译"}
    return {"id": "summa-contra-gentiles", "title": "驳异大全（合集）", "author": "圣多玛斯・阿奎纳", "translator": "吕穆迪 译述"}


def extract_book(source: Path) -> dict:
    metadata = book_metadata(source)
    document = pymupdf.open(source)
    cache_dir = ROOT / "data" / "vision-ocr" / metadata["id"]
    pages = []
    vision_page_count = 0
    for index, page in enumerate(document):
        cached_page = cache_dir / f"page-{index + 1:04d}.txt"
        if cached_page.exists():
            pages.append(clean_page(cached_page.read_text(encoding="utf-8")))
            vision_page_count += 1
        else:
            pages.append(clean_page(page.get_text()))
    if metadata["id"] == "on-the-incarnation":
        starts: list[tuple[int, int | str, str]] = [
            (0, "前置内容", "封面、版权、目录与总序"),
            (11, "导言", "中译本导言"),
            (25, "正文", "驳异教徒"),
            (95, "正文", "论道成肉身"),
            (180, "阿里乌争议", "罢黜阿里乌"),
            (188, "阿里乌争议", "优西比乌书信"),
            (191, "阿里乌争议", "尼西亚大公会议"),
            (210, "阿里乌争议", "附注A"),
            (217, "阿里乌争议", "信仰陈述"),
            (219, "阿里乌争议", "论《路加福音》十章二十二节"),
            (234, "阿里乌争议", "致全世界主教的通谕"),
            (246, "阿里乌争议", "反驳阿里乌主义者的辩护"),
            (357, "附录", "译名对照表"),
            (372, "附录", "译后记"),
        ]
        starts = [start for start in starts if start[0] < len(pages)]
    else:
        pattern = SECTION_RE if "慕道者" in source.stem else CHAPTER_RE
        hits: list[tuple[int, int, str]] = []

        for page_index, text in enumerate(pages):
            if len(text) < 300:
                continue
            head = "".join(text.splitlines()[:20]).replace(" ", "")
            match = pattern.search(head)
            if match:
                number = chinese_number(match.group(1))
                if number:
                    hits.append((page_index, number, match.group(0)))

        anchor = next((index for index, hit in enumerate(hits) if hit[1] <= 5), 0)
        starts = []
        group = 1
        previous = 0
        for page_index, number, label in hits[anchor:]:
            if (previous >= 30 or pattern is SECTION_RE) and previous > number and number <= 5:
                group += 1
                previous = 0
            if number <= previous:
                continue
            # A large, isolated jump is usually an in-body cross-reference picked up
            # by OCR, not a real chapter heading. Keep plausible gaps for missed scans.
            if previous and number - previous > 8:
                continue
            starts.append((page_index, group, f"{label} · {chapter_title(pages[page_index], label)}"))
            previous = number

        if not starts:
            starts = [(0, 1, "全文")]
        elif starts[0][0] > 0:
            starts.insert(0, (0, 0, "前言与导论"))

    chapters = []
    for index, (start, group, title) in enumerate(starts):
        end = starts[index + 1][0] if index + 1 < len(starts) else len(pages)
        content = "\n\n".join(reflow_page(page) for page in pages[start:end] if page)
        if not content:
            continue
        chapters.append({
            "id": str(len(chapters) + 1),
            "section": group if isinstance(group, str) else ("前置内容" if group == 0 else f"第{group}篇"),
            "title": title,
            "content": content,
            "startPage": start + 1,
        })

    return {
        **metadata,
        "sourceFile": source.name,
        "pageCount": len(pages),
        "visionOcrPageCount": vision_page_count,
        "chapters": chapters,
    }


def main() -> None:
    sources = sorted((ROOT / "books").glob("*.pdf"), key=lambda path: path.name)
    payload = {"books": [extract_book(source) for source in sources]}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Extracted {len(payload['books'])} books -> {OUTPUT}")
    for book in payload["books"]:
        print(f"  {book['title']}: {len(book['chapters'])} chapters, {book['pageCount']} pages")


if __name__ == "__main__":
    main()
