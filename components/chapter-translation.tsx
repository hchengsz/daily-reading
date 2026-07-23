import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { apiUrl, readJsonResponse } from '@/lib/api-client';

type TranslationProvider = 'google' | 'ai';

type TranslationState =
  | { status: 'idle' }
  | { status: 'loading'; provider: TranslationProvider }
  | { status: 'success'; translation: string; provider: TranslationProvider; source?: 'cache' | 'gemini' | 'google' }
  | { status: 'error'; message: string; provider?: TranslationProvider };

const aiTranslationCache = new Map<string, string>();
const googleTranslationCache = new Map<string, string>();

export function ChapterTranslation({
  bookId,
  chapterId,
  enabled,
}: {
  bookId: string;
  chapterId: string;
  enabled: boolean;
}) {
  const cacheKey = `${bookId}:${chapterId}`;
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<TranslationState>({ status: 'idle' });

  useEffect(() => {
    setState({ status: 'idle' });
    return () => controllerRef.current?.abort();
  }, [cacheKey]);

  if (!enabled) return null;

  async function translate(provider: TranslationProvider, force = false) {
    const cached = provider === 'ai' ? aiTranslationCache.get(cacheKey) : googleTranslationCache.get(cacheKey);
    if (cached && !force) {
      setState({ status: 'success', translation: cached, provider, source: provider === 'ai' ? 'cache' : 'google' });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'loading', provider });

    try {
      const response = await fetch(apiUrl('/api/chapter-translation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, chapterId, provider, force }),
        signal: controller.signal,
      });
      const data = await readJsonResponse<{
        translation?: string;
        source?: 'cache' | 'gemini' | 'google';
        error?: string;
      }>(response);
      if (!data.translation) throw new Error('翻译接口没有返回正文');

      if (provider === 'ai') aiTranslationCache.set(cacheKey, data.translation);
      if (provider === 'google') googleTranslationCache.set(cacheKey, data.translation);
      setState({ status: 'success', translation: data.translation, provider, source: data.source });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : '翻译失败', provider });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.badge}><Text style={styles.badgeText}>译</Text></View>
        <View style={styles.headingText}>
          <Text style={styles.title}>本章中文翻译</Text>
          <Text style={styles.subtitle}>英文图书可手动调用 Google 翻译或 AI 翻译</Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          accessibilityRole="button"
          disabled={state.status === 'loading'}
          onPress={() => translate('google')}
          style={StyleSheet.flatten([styles.primaryButton, state.status === 'loading' ? styles.disabledButton : undefined])}>
          <Text style={styles.primaryText}>谷歌翻译</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={state.status === 'loading'}
          onPress={() => translate('ai')}
          style={StyleSheet.flatten([styles.primaryButton, styles.aiButton, state.status === 'loading' ? styles.disabledButton : undefined])}>
          <Text style={styles.primaryText}>AI翻译</Text>
        </Pressable>
      </View>

      {state.status === 'idle' && (
        <Text style={styles.idleText}>AI 翻译会保存到本地缓存；下次点击会优先读取本地文件，避免重复消耗 token。</Text>
      )}
      {state.status === 'loading' && (
        <View style={styles.loading}>
          <ActivityIndicator color="#8B3A2F" />
          <Text style={styles.loadingText}>{state.provider === 'google' ? '正在调用 Google 翻译…' : '正在调用 AI 翻译…'}</Text>
        </View>
      )}
      {state.status === 'success' && (
        <View style={styles.successBox}>
          <Text selectable style={styles.translation}>{state.translation}</Text>
          <Text style={styles.cacheHint}>
            {state.source === 'cache' && 'AI 翻译已从本地缓存读取'}
            {state.source === 'gemini' && 'AI 翻译已生成并保存到本地缓存'}
            {state.source === 'google' && '当前显示 Google 翻译结果'}
          </Text>
          {state.provider === 'ai' && (
            <Pressable style={styles.secondaryButton} onPress={() => translate('ai', true)}>
              <Text style={styles.secondaryText}>重新AI翻译（会消耗 token）</Text>
            </Pressable>
          )}
        </View>
      )}
      {state.status === 'error' && (
        <View style={styles.errorBox}>
          <Text selectable style={styles.errorText}>{state.message}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => translate(state.provider || 'ai', true)}>
            <Text style={styles.secondaryText}>重试</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#F0E7DA', borderRadius: 20, borderCurve: 'continuous', padding: 18, gap: 16, marginBottom: 30 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#5E513F', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF8E8', fontSize: 15, fontWeight: '800' },
  headingText: { flex: 1, gap: 2 },
  title: { color: '#302A23', fontSize: 17, fontWeight: '700' },
  subtitle: { color: '#837568', fontSize: 12 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  primaryButton: { backgroundColor: '#6E5F49', borderRadius: 99, paddingHorizontal: 16, paddingVertical: 10 },
  aiButton: { backgroundColor: '#8B3A2F' },
  disabledButton: { opacity: 0.5 },
  primaryText: { color: '#FFF8E8', fontSize: 13, fontWeight: '700' },
  idleText: { color: '#75695D', fontSize: 13, lineHeight: 20 },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#75695D', fontSize: 13 },
  successBox: { gap: 14 },
  translation: { color: '#383229', fontSize: 16, lineHeight: 29 },
  cacheHint: { color: '#837568', fontSize: 12 },
  secondaryButton: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: '#8B3A2F', borderRadius: 99, paddingHorizontal: 15, paddingVertical: 9 },
  secondaryText: { color: '#8B3A2F', fontSize: 12, fontWeight: '700' },
  errorBox: { gap: 14 },
  errorText: { color: '#8B3A2F', fontSize: 14, lineHeight: 21 },
});
