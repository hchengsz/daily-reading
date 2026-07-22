# Daily Reading

Daily Reading 是一个用 Expo / React Native 做的本地阅读软件。它的目标很朴素：把 `books/` 里的 PDF 书籍提取成适合手机阅读的章节文本，并在阅读前提供 AI 详细总结、必要时提供 AI 视觉 OCR 校正文，帮助用户读旧版神学、哲学、教会史类书籍。

当前项目主要围绕中文旧书扫描 PDF 做优化，尤其适合《驳异大全》这类 OCR 质量不稳定、章节结构复杂的书。

## 主要功能

### 1. 本地书架

- 首页显示当前书库中的所有图书。
- 每本书显示书名、作者、章节/阅读段数量和 PDF 页数。
- 用户可以从书架隐藏某本书，也可以恢复已隐藏图书。
- 书库数据来自 `data/library.json`，运行时也可以通过 API 读取最新版本。

### 2. 分章阅读

- PDF 会被提取成适合手机阅读的文本。
- 阅读页支持：
  - 章节标题
  - 当前所属部分
  - PDF 起始页码
  - 上一章 / 下一章导航
  - 字号增大 / 减小
  - 段落化正文，避免 iOS 上超长 `<Text>` 不可读

### 3. AI 详细总结

每章顶部都有 AI 总结区域。

- 默认不会自动调用 AI，避免浪费 token。
- 用户点击按钮后才会生成详细总结。
- 总结会保存到本地缓存目录：

```text
data/ai-cache/summaries/<bookId>/<chapterId>.txt
```

- 如果用户不满意，可以点击重新生成。
- 重新生成会再次调用 Gemini API，并覆盖/更新缓存。

### 4. AI 视觉 OCR 校正文

部分 OCR 质量差的书支持手动 AI 视觉校正。

目前支持：

- 《驳异大全》四卷
- 《天主之城》
- 用户新添加图书时，如果选择“驳异大全模式”，也会开启该功能

特点：

- 不自动运行，需要用户手动点击“AI校正”。
- 如果已有本地缓存，会优先使用缓存。
- 校正文保存到：

```text
data/ai-cache/ocr/<bookId>/<chapterId>.txt
```

- 如果 AI 处理失败，会继续显示旧 OCR 文本。

### 5. 用户添加图书

书架首页有“添加图书”入口。

用户可以：

1. 从手机或电脑选择 PDF。
2. 填写书名、作者、译者。
3. 选择处理方式：
   - “驳异大全模式”
   - “一般 PDF 模式”
4. 添加后，PDF 会保存到 `books/`。
5. 新书记录会写入 `data/library.json`。

#### 驳异大全模式

适合旧书扫描 PDF，尤其是：

- OCR 有错字
- 章节以“第X章”为主
- 需要 AI 视觉 OCR 校正文

处理逻辑：

- 尝试从页面开头识别“第X章”。
- 自动生成章节节点。
- 开启手动 AI OCR 校正文。

#### 一般 PDF 模式

适合普通 PDF 或结构比较规整的书。

处理逻辑：

- 优先读取 PDF 内置目录/书签。
- 如果没有目录，则按页数切成稳定的阅读段。
- 默认不开启 AI 视觉 OCR 校正文。

## 当前内置书籍

项目当前 `books/` 目录包含：

- 《驳异大全·论真原》
- 《驳异大全·论万物》
- 《驳异大全·论万事》
- 《驳异大全·论奥理》
- 《基督大能两千年·中世纪》
- 《天主之城》
- 《慕道者指南》
- 《论道成肉身》

实际书库内容以 `data/library.json` 为准。

## 技术栈

- Expo SDK 54
- Expo Router
- React Native
- TypeScript
- `expo-document-picker`：选择 PDF 文件
- `pdfjs-dist`：在 API route 中提取 PDF 文本
- `pdf-lib`：抽取 PDF 页段给 Gemini 视觉 OCR
- `undici`：服务端请求 Gemini API，可走代理
- Python 脚本：用于批量重建内置书库和离线 OCR 流程

## 项目结构

```text
app/
  index.tsx                       书架首页
  add-book.tsx                    添加图书页面
  book/[id].tsx                   图书目录页
  reader/[bookId]/[chapterId].tsx 阅读页
  api/
    library+api.ts                读取最新书库
    add-book+api.ts               上传 PDF 并写入书库
    chapter-summary+api.ts        AI 章节总结
    chapter-content+api.ts        AI 视觉 OCR 校正文

components/
  chapter-summary.tsx             章节 AI 总结组件
  live-chapter-text.tsx           正文与 AI OCR 校正组件

lib/
  book.ts                         书库类型与静态 fallback
  use-library.ts                  前端读取最新书库 hook
  server-library.ts               服务端读写 data/library.json
  server-pdf-books.ts             服务端 PDF 提取与切分逻辑
  library-storage.ts              隐藏/恢复书籍的本地存储

scripts/
  extract-book.py                 从 books/ 批量提取生成 data/library.json
  vision-ocr.py                   批量视觉 OCR 辅助脚本

books/                            PDF 原书
data/
  library.json                    书库与章节正文数据
  ai-cache/                       AI 总结/OCR 本地缓存
```

## 环境变量

AI 功能依赖 `.env` 中的 Gemini 配置。

常用变量：

```env
GEMINI_API_KEY=你的 Gemini API Key
GEMINI_VOCAB_MODEL=gemini-...
HTTP_PROXY=http://127.0.0.1:xxxx
HTTPS_PROXY=http://127.0.0.1:xxxx
```

说明：

- `GEMINI_API_KEY` 用于 AI 总结和 AI 视觉 OCR。
- `GEMINI_VOCAB_MODEL` 是要调用的 Gemini 模型。
- `HTTP_PROXY` / `HTTPS_PROXY` 可选，如果本地网络需要代理就配置。
- AI 结果会写入 `data/ai-cache/`，避免重复调用。

## 安装与运行

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
npm run start:proxy
```

或者：

```bash
npx expo start --clear
```

常用平台命令：

```bash
npm run ios
npm run android
npm run web
```

## 常用脚本

### 重建书库

```bash
npm run books:rebuild
```

等价于：

```bash
python scripts/extract-book.py
```

它会读取 `books/` 中的 PDF，并重新生成 `data/library.json`。

### 批量 OCR

```bash
npm run ocr:pilot
```

用于小范围测试视觉 OCR。

```bash
npm run ocr:all
```

用于完整批量 OCR，并重建书库。

## 添加新书的推荐方式

现在推荐直接在 App 中添加：

1. 启动项目。
2. 打开书架首页。
3. 点击“添加图书”。
4. 选择 PDF。
5. 填写书名和作者。
6. 选择处理方式。
7. 点击“添加到书库”。

如果是旧版扫描书、OCR 错字多、章节像《驳异大全》一样以“第X章”为主，选择“驳异大全模式”。

如果是普通 PDF、有目录或文字层较好，选择“一般 PDF 模式”。

## 数据与缓存

### 书库数据

```text
data/library.json
```

这里保存所有图书、章节标题、正文、页码等。

### PDF 原文件

```text
books/
```

用户添加图书后，PDF 会复制到这里。

### AI 缓存

```text
data/ai-cache/
```

缓存分两类：

```text
data/ai-cache/summaries/  AI 章节总结
data/ai-cache/ocr/        AI 视觉 OCR 校正文
```

这个目录默认被 `.gitignore` 忽略，只保留 `.gitkeep`。

## 重要设计说明

### 为什么 AI 不自动运行？

AI 总结和 OCR 都会消耗 token。为了避免打开章节就自动花费 token，项目设计为手动触发：

- AI 总结：用户点击后生成
- AI OCR：用户点击后校正
- 不满意可以重新生成

### 为什么正文要分段渲染？

iOS 上如果把几万字塞进一个 `<Text>`，容易出现空白、卡顿或不可阅读。项目会把正文拆成多个自然段 `<Text>` 渲染，让长章节也能稳定阅读。

### 为什么有两种 PDF 处理模式？

不同 PDF 的结构差异很大：

- 《驳异大全》这类旧书扫描 OCR 错字多，但章节规律明显。
- 普通 PDF 可能有目录/书签，按目录切更稳。

所以添加图书时让用户选择模式，比强行用一种规则更可靠。

## 常见问题

### 1. `npm run start:proxy` 提示端口 8081 被占用

说明旧的 Expo dev server 还在运行。关闭旧终端，或结束占用 8081 的 Node 进程后重新启动。

### 2. 出现 `[UNDICI-EHPA] EnvHttpProxyAgent is experimental`

这是 `undici` 在代理环境下的提示，通常不影响运行。

### 3. AI 总结失败

检查：

- `.env` 是否有 `GEMINI_API_KEY`
- `.env` 是否有 `GEMINI_VOCAB_MODEL`
- 网络/代理是否能访问 Gemini API

### 4. AI OCR 提示章节页数太多

实时 OCR 有页数限制，避免一次发送过大的 PDF 给 Gemini。可以考虑把书切得更细，或只对较短章节使用 AI OCR。

### 5. 新增 PDF 后没有立刻显示

回到书架刷新页面，或重启 dev server。书架会优先读取 `/api/library` 的最新书库，如果 API 不可用则使用打包时的 fallback。

## 开发检查

类型检查：

```bash
npx tsc --noEmit
```

Lint：

```bash
npm run lint
```

Web 导出：

```bash
npx expo export --platform web
```

## 备注

这个项目目前更偏向本地个人阅读工具，而不是多用户云端书库。PDF、书库 JSON、AI 缓存都保存在本地项目目录中。这样做的好处是简单、透明、可控，也方便检查和手动修正 OCR/章节数据。
