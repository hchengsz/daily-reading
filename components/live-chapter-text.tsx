import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type LiveStatus = 'disabled' | 'idle' | 'loading' | 'ready' | 'failed';

type CorrectedContentResponse = {
  content?: string;
  source?: 'cache' | 'gemini-vision';
  error?: string;
};

const SCG_BOOK_IDS = new Set(['scg-truth', 'scg-creation', 'scg-providence', 'scg-mysteries']);
const correctedTextCache = new Map<string, string>();

export function LiveChapterText({
  bookId,
  chapterId,
  content,
  fontSize,
}: {
  bookId: string;
  chapterId: string;
  content: string;
  fontSize: number;
}) {
  const cacheKey = `${bookId}:${chapterId}`;
  const enabled = SCG_BOOK_IDS.has(bookId);
  const cachedText = correctedTextCache.get(cacheKey);
  const [displayText, setDisplayText] = useState(cachedText || content);
  const [status, setStatus] = useState<LiveStatus>(enabled ? (cachedText ? 'ready' : 'idle') : 'disabled');
  const [message, setMessage] = useState('');
  const [source, setSource] = useState<'cache' | 'gemini-vision' | undefined>(cachedText ? 'cache' : undefined);
  const [request, setRequest] = useState({ count: 0, force: false });
  const bodyStyle = useMemo(
    () => [styles.body, { fontSize, lineHeight: fontSize * 1.9 }],
    [fontSize],
  );

  useEffect(() => {
    setDisplayText(cachedText || content);
    setStatus(enabled ? (cachedText ? 'ready' : 'idle') : 'disabled');
    setSource(cachedText ? 'cache' : undefined);
    setMessage('');
  }, [cacheKey, cachedText, content, enabled]);

  useEffect(() => {
    if (!enabled || (cachedText && !request.force) || request.count === 0) return;

    const controller = new AbortController();
    let cancelled = false;

    async function loadCorrectedText() {
      setStatus('loading');
      setMessage('');

      try {
        const response = await fetch('/api/chapter-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId, chapterId, force: request.force }),
          signal: controller.signal,
        });
        const data = await response.json() as CorrectedContentResponse;
        if (!response.ok || !data.content) {
          throw new Error(data.error || `实时校正文失败（${response.status}）`);
        }
        if (cancelled) return;

        correctedTextCache.set(cacheKey, data.content);
        setDisplayText(data.content);
        setSource(data.source);
        setStatus('ready');
      } catch (error) {
        if (controller.signal.aborted || cancelled) return;

        setDisplayText(content);
        setStatus('failed');
        setMessage(error instanceof Error ? error.message : '实时校正文失败');
      }
    }

    loadCorrectedText();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bookId, cacheKey, cachedText, chapterId, content, enabled, request]);

  return (
    <View style={styles.container}>
      {enabled && (
        <View style={[styles.statusBox, status === 'failed' ? styles.statusBoxError : undefined]}>
          <Text style={styles.statusText}>
            {status === 'idle' && '当前显示旧 OCR；需要时可手动启动 AI 视觉校正文'}
            {status === 'loading' && '正在用 AI 视觉校正文，完成后会替换当前正文'}
            {status === 'ready' && (source === 'cache' ? '已切换为本地缓存的 AI 视觉校正版' : '已切换为 AI 视觉校正版，并保存到本地缓存')}
            {status === 'failed' && `AI 视觉校正失败，继续使用旧 OCR${message ? `：${message}` : ''}`}
          </Text>
          {(status === 'idle' || status === 'failed' || status === 'ready') && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setRequest((value) => ({
                count: value.count + 1,
                force: status === 'ready' || status === 'failed',
              }))}
              style={styles.retryButton}>
              <Text style={styles.retryText}>
                {status === 'ready' && '重新校正'}
                {status === 'failed' && '重试'}
                {status === 'idle' && 'AI校正'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      <Text selectable style={bodyStyle}>{displayText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 18 },
  statusBox: {
    backgroundColor: '#F1E7D9',
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusBoxError: { backgroundColor: '#F7E6DF' },
  statusText: { flex: 1, color: '#6C5A49', fontSize: 13, lineHeight: 19 },
  retryButton: {
    backgroundColor: '#8B3A2F',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  retryText: { color: '#FFF8EE', fontSize: 12, fontWeight: '700' },
  body: { color: '#353029', letterSpacing: 0.5 },
});
