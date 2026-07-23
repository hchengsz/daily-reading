"""Extract bundled PDF/EPUB books into chapter-oriented JSON for the mobile reader."""

from __future__ import annotations

import json
import re
import sys
import zipfile
import html
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
LOCAL_PYTHON_PACKAGES = ROOT / ".python-packages"
if LOCAL_PYTHON_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PYTHON_PACKAGES))

try:
    import pymupdf
except ModuleNotFoundError:
    pymupdf = None

try:
    from pypdf import PdfReader
except ModuleNotFoundError:
    PdfReader = None

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
    if "基督大能两千年" in stem:
        return {"id": "christs-power-middle-ages", "title": "基督大能两千年·中世纪", "author": "尼克・尼德姆", "translator": "路丹 译；贾少彬 校"}
    if "天主之城" in stem:
        return {"id": "city-of-god", "title": "天主之城", "author": "圣奥古斯丁", "translator": ""}
    if "Life_Is_Worth_Living" in stem or "Worth_Living" in stem:
        return {"id": "your-life-is-worth-living", "title": "Your Life Is Worth Living", "author": "Fulton Sheen", "translator": ""}
    return {"id": "summa-contra-gentiles", "title": "驳异大全（合集）", "author": "圣多玛斯・阿奎纳", "translator": "吕穆迪 译述"}


def read_pdf_pages(source: Path, prefer_pypdf: bool = False) -> list[str]:
    if prefer_pypdf:
        if PdfReader is None:
            raise RuntimeError("《天主之城》需要 pypdf 提取文字：python -m pip install pypdf")
        reader = PdfReader(source)
        return [page.extract_text() or "" for page in reader.pages]

    if pymupdf is not None:
        document = pymupdf.open(source)
        return [page.get_text() for page in document]

    if PdfReader is not None:
        reader = PdfReader(source)
        return [page.extract_text() or "" for page in reader.pages]

    raise RuntimeError("需要安装 PyMuPDF 或 pypdf 才能提取 PDF 文字")


def epub_text_from_html(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|svg|head|nav)[^>]*>.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>", "\n", markup)
    markup = re.sub(r"(?i)</(p|div|section|article|blockquote|h[1-6]|li)>", "\n\n", markup)
    text = re.sub(r"(?s)<[^>]+>", " ", markup)
    text = html.unescape(text)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    paragraphs = [line for line in lines if line]
    return "\n\n".join(paragraphs)


def epub_title_from_html(text: str, fallback: str) -> str:
    for line in text.splitlines():
        value = line.strip()
        if 3 <= len(value) <= 100:
            return value
    return fallback


def read_epub(source: Path) -> dict:
    metadata = book_metadata(source)
    with zipfile.ZipFile(source) as archive:
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        container_ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
        rootfile = container.find(".//c:rootfile", container_ns).attrib["full-path"]
        root_dir = Path(rootfile).parent
        opf = ET.fromstring(archive.read(rootfile))
        ns = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}

        title_values = [node.text.strip() for node in opf.findall(".//dc:title", ns) if node.text and node.text.strip()]
        creator_values = [node.text.strip() for node in opf.findall(".//dc:creator", ns) if node.text and node.text.strip()]
        if title_values:
            metadata["title"] = title_values[0]
        if creator_values:
            metadata["author"] = creator_values[0]

        manifest = {
            item.attrib.get("id"): item.attrib
            for item in opf.findall(".//opf:manifest/opf:item", ns)
            if item.attrib.get("id")
        }
        spine = [item.attrib.get("idref") for item in opf.findall(".//opf:spine/opf:itemref", ns)]

        chapters = []
        current_section = "Front Matter"
        for idref in spine:
            item = manifest.get(idref)
            if not item or item.get("media-type") != "application/xhtml+xml":
                continue
            href = unquote(item.get("href", ""))
            if not href:
                continue
            file_path = str((root_dir / href).as_posix())
            if file_path not in archive.namelist():
                continue
            text = epub_text_from_html(archive.read(file_path).decode("utf-8", "ignore"))
            if len(text) < 80:
                continue
            fallback = Path(href).stem
            title = epub_title_from_html(text, fallback)
            if re.match(r"^(Part|Chapter|\d+[:.\s-])", title, re.IGNORECASE):
                current_section = title if title.lower().startswith("part ") else current_section
            chapters.append({
                "id": str(len(chapters) + 1),
                "section": current_section,
                "title": title,
                "content": text,
                "startPage": len(chapters) + 1,
            })

    return {
        **metadata,
        "sourceFile": source.name,
        "sourceType": "epub",
        "pageCount": len(chapters),
        "visionOcrPageCount": 0,
        "chapters": chapters,
    }


def extract_book(source: Path) -> dict:
    if source.suffix.lower() == ".epub":
        return read_epub(source)

    metadata = book_metadata(source)
    raw_pages = read_pdf_pages(source, prefer_pypdf=metadata["id"] == "city-of-god")
    cache_dir = ROOT / "data" / "vision-ocr" / metadata["id"]
    pages = []
    vision_page_count = 0
    for index, page_text in enumerate(raw_pages):
        cached_page = cache_dir / f"page-{index + 1:04d}.txt"
        if cached_page.exists():
            pages.append(clean_page(cached_page.read_text(encoding="utf-8")))
            vision_page_count += 1
        else:
            pages.append(clean_page(page_text))
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
    elif metadata["id"] == "christs-power-middle-ages":
        starts = [
            (0, "前置内容", "封面、版权、目录与献辞"),
            (9, "前置内容", "致谢"),
            (11, "前置内容", "前言"),
            (21, "中世纪", "1. 伊斯兰教与教会"),
            (77, "中世纪", "2. 查理曼与神圣罗马帝国"),
            (145, "中世纪", "3. 拜占庭帝国：从伊苏利亚的利奥到东西教会大分裂"),
            (237, "中世纪", "4. 克吕尼改革、希尔德布兰与授职权之争"),
            (305, "中世纪", "5. 十字军东征"),
            (357, "中世纪", "6. 神圣的俄罗斯：斯拉夫人的正教信仰"),
            (399, "中世纪", "7. 大学与经院神学的兴起"),
            (493, "中世纪", "8. 英诺森三世的时代"),
            (553, "中世纪", "9. 拜占庭帝国：从十字军东征到君士坦丁堡的陷落"),
            (611, "中世纪", "10. 天主教会的危机：从教廷被囚阿维尼翁到胡斯派"),
            (677, "附录", "词汇表"),
            (717, "附录", "地图"),
        ]
        starts = [start for start in starts if start[0] < len(pages)]
    elif metadata["id"] == "city-of-god":
        outline_starts = [
            (0, "前置内容"),
            (10, "第一卷"),
            (49, "第二卷"),
            (84, "第三卷"),
            (125, "第四卷"),
            (164, "第五卷"),
            (205, "第六卷"),
            (228, "第七卷"),
            (265, "第八卷"),
            (303, "第九卷"),
            (329, "第十卷"),
            (376, "第十一卷"),
            (416, "第十二卷"),
            (450, "第十三卷"),
            (483, "第十四卷"),
            (526, "第十五卷"),
            (573, "第十六卷"),
            (634, "第十七卷"),
            (683, "第十八卷"),
            (760, "第十九卷"),
            (805, "第二十卷"),
            (868, "第二十一卷"),
            (918, "第二十二卷"),
            (978, "附录"),
            (991, "附录"),
            (994, "勘误表"),
        ]
        starts = []
        chunk_size = 10
        for index, (start, section) in enumerate(outline_starts):
            if start >= len(pages):
                continue
            end = outline_starts[index + 1][0] if index + 1 < len(outline_starts) else len(pages)
            if section == "前置内容":
                starts.append((start, section, "封面、译者序、作者序与目录"))
                continue
            for chunk_start in range(start, min(end, len(pages)), chunk_size):
                part = ((chunk_start - start) // chunk_size) + 1
                title = section if end - start <= chunk_size else f"{section} · 第{part}段"
                starts.append((chunk_start, section, title))
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
        "sourceType": "pdf",
        "pageCount": len(pages),
        "visionOcrPageCount": vision_page_count,
        "chapters": chapters,
    }


def main() -> None:
    sources = sorted(
        [*list((ROOT / "books").glob("*.pdf")), *list((ROOT / "books").glob("*.epub"))],
        key=lambda path: path.name,
    )
    payload = {"books": [extract_book(source) for source in sources]}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Extracted {len(payload['books'])} books -> {OUTPUT}")
    for book in payload["books"]:
        print(f"  {book['title']}: {len(book['chapters'])} chapters, {book['pageCount']} pages")


if __name__ == "__main__":
    main()
