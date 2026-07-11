import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const clientCache = new Map<string, string>();

type SummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; summary: string }
  | { status: 'error'; message: string };

export function ChapterSummary({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const cacheKey = `${bookId}:${chapterId}`;
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<SummaryState>(() => {
    const cached = clientCache.get(cacheKey);
    return cached ? { status: 'success', summary: cached } : { status: 'idle' };
  });

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function generateSummary() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'loading' });

    try {
      const response = await fetch('/api/chapter-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, chapterId }),
        signal: controller.signal,
      });
      const data = await response.json() as { summary?: string; error?: string };
      if (!response.ok || !data.summary) {
        throw new Error(data.error || `请求失败（${response.status}）`);
      }
      clientCache.set(cacheKey, data.summary);
      setState({ status: 'success', summary: data.summary });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : '暂时无法生成总结' });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.badge}><Text style={styles.badgeText}>AI</Text></View>
        <View style={styles.headingText}>
          <Text style={styles.title}>本章详细导读</Text>
          <Text style={styles.subtitle}>点击后由 Gemini 根据本章原文生成</Text>
        </View>
      </View>

      {state.status === 'idle' && (
        <View style={styles.idleBox}>
          <Text style={styles.idleText}>AI 总结不会自动运行，生成时会使用一次 Gemini 请求。</Text>
          <Pressable style={styles.generateButton} onPress={generateSummary}>
            <Text style={styles.generateText}>生成本章详细总结</Text>
          </Pressable>
        </View>
      )}
      {state.status === 'loading' && (
        <View style={styles.loading}>
          <ActivityIndicator color="#8B3A2F" />
          <Text style={styles.loadingText}>正在梳理本章内容…</Text>
        </View>
      )}
      {state.status === 'success' && <Text selectable style={styles.summary}>{state.summary}</Text>}
      {state.status === 'error' && (
        <View style={styles.errorBox}>
          <Text selectable style={styles.errorText}>{state.message}</Text>
          <Pressable style={styles.generateButton} onPress={generateSummary}>
            <Text style={styles.generateText}>重新生成</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#EDE3D2', borderRadius: 20, borderCurve: 'continuous', padding: 18, gap: 18, marginBottom: 30 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#8B3A2F', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF8E8', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  headingText: { flex: 1, gap: 2 },
  title: { color: '#302A23', fontSize: 17, fontWeight: '700' },
  subtitle: { color: '#837568', fontSize: 12 },
  idleBox: { gap: 14 },
  idleText: { color: '#75695D', fontSize: 13, lineHeight: 20 },
  loading: { minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#75695D', fontSize: 13 },
  summary: { color: '#443C33', fontSize: 16, lineHeight: 29 },
  errorBox: { gap: 14 },
  errorText: { color: '#8B3A2F', fontSize: 14, lineHeight: 21 },
  generateButton: { alignSelf: 'flex-start', backgroundColor: '#8B3A2F', borderRadius: 99, paddingHorizontal: 17, paddingVertical: 10 },
  generateText: { color: '#FFF8E8', fontSize: 13, fontWeight: '700' },
});
