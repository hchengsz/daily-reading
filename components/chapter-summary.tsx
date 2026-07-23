import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { apiUrl, readJsonResponse } from '@/lib/api-client';

const clientCache = new Map<string, string>();

type SummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; summary: string; source?: 'cache' | 'gemini' }
  | { status: 'error'; message: string };

export function ChapterSummary({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const cacheKey = `${bookId}:${chapterId}`;
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<SummaryState>(() => {
    const cached = clientCache.get(cacheKey);
    return cached ? { status: 'success', summary: cached, source: 'cache' } : { status: 'idle' };
  });

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function generateSummary(force = false) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'loading' });

    try {
      const response = await fetch(apiUrl('/api/chapter-summary'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, chapterId, force }),
        signal: controller.signal,
      });
      const data = await readJsonResponse<{ summary?: string; source?: 'cache' | 'gemini'; error?: string }>(response);
      if (!data.summary) throw new Error('总结接口没有返回正文');
      clientCache.set(cacheKey, data.summary);
      setState({ status: 'success', summary: data.summary, source: data.source });
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
          <Pressable style={styles.generateButton} onPress={() => generateSummary(false)}>
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
      {state.status === 'success' && (
        <View style={styles.successBox}>
          <Text selectable style={styles.summary}>{state.summary}</Text>
          <Text style={styles.cacheHint}>{state.source === 'cache' ? '已从本地缓存读取' : '已生成并保存到本地缓存'}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => generateSummary(true)}>
            <Text style={styles.secondaryText}>重新生成（会消耗 token）</Text>
          </Pressable>
        </View>
      )}
      {state.status === 'error' && (
        <View style={styles.errorBox}>
          <Text selectable style={styles.errorText}>{state.message}</Text>
          <Pressable style={styles.generateButton} onPress={() => generateSummary(true)}>
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
  successBox: { gap: 14 },
  summary: { color: '#443C33', fontSize: 16, lineHeight: 29 },
  cacheHint: { color: '#837568', fontSize: 12 },
  errorBox: { gap: 14 },
  errorText: { color: '#8B3A2F', fontSize: 14, lineHeight: 21 },
  generateButton: { alignSelf: 'flex-start', backgroundColor: '#8B3A2F', borderRadius: 99, paddingHorizontal: 17, paddingVertical: 10 },
  generateText: { color: '#FFF8E8', fontSize: 13, fontWeight: '700' },
  secondaryButton: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: '#8B3A2F', borderRadius: 99, paddingHorizontal: 15, paddingVertical: 9 },
  secondaryText: { color: '#8B3A2F', fontSize: 12, fontWeight: '700' },
});
