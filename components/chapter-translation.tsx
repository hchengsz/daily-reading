import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { apiFetch, readJsonResponse } from '@/lib/api-client';

type TranslationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; translation: string; source?: 'cache' | 'gemini' }
  | { status: 'error'; message: string };

const aiTranslationCache = new Map<string, string>();

export function ChapterTranslation({
  bookId,
  chapterId,
  enabled,
}: {
  bookId: string;
  chapterId: string;
  enabled: boolean;
}) {
  const cacheKey = `catholic-v1:${bookId}:${chapterId}`;
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<TranslationState>({ status: 'idle' });

  useEffect(() => () => controllerRef.current?.abort(), [cacheKey]);

  if (!enabled) return null;

  async function translate(force = false) {
    const cached = aiTranslationCache.get(cacheKey);
    if (cached && !force) {
      setState({ status: 'success', translation: cached, source: 'cache' });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'loading' });

    try {
      const response = await apiFetch('/api/chapter-translation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, chapterId, force }),
        signal: controller.signal,
      });
      const data = await readJsonResponse<{
        translation?: string;
        source?: 'cache' | 'gemini';
        error?: string;
      }>(response);
      if (!data.translation) throw new Error('翻译接口没有返回正文');

      if (controller.signal.aborted) return;
      aiTranslationCache.set(cacheKey, data.translation);
      setState({ status: 'success', translation: data.translation, source: data.source });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : '翻译失败' });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.badge}><Text style={styles.badgeText}>译</Text></View>
        <View style={styles.headingText}>
          <Text style={styles.title}>本章中文翻译</Text>
          <Text style={styles.subtitle}>英文译为简体中文 · AI 翻译采用天主教译法</Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          accessibilityRole="button"
          disabled={state.status === 'loading'}
          onPress={() => translate()}
          style={StyleSheet.flatten([styles.primaryButton, styles.aiButton, state.status === 'loading' ? styles.disabledButton : undefined])}>
          <Text style={styles.primaryText}>Gemini 翻译（天主教译法）</Text>
        </Pressable>
      </View>

      {state.status === 'idle' && (
        <Text style={styles.idleText}>AI 翻译使用“天主”“圣神”“恩宠”等天主教术语。译文会保存到服务端本地缓存，再次点击可复用，避免重复消耗 token。</Text>
      )}
      {state.status === 'loading' && (
        <View style={styles.loading}>
          <ActivityIndicator color="#8B3A2F" />
          <Text style={styles.loadingText}>正在调用 Gemini 翻译…</Text>
        </View>
      )}
      {state.status === 'success' && (
        <View style={styles.successBox}>
          <Text selectable style={styles.translation}>{state.translation}</Text>
          <Text style={styles.cacheHint}>
            {state.source === 'cache' && 'AI 翻译已从本地缓存读取'}
            {state.source === 'gemini' && 'AI 翻译已生成并保存到本地缓存'}
          </Text>
          <Pressable style={styles.secondaryButton} onPress={() => translate(true)}>
            <Text style={styles.secondaryText}>重新 AI 翻译（会消耗 token）</Text>
          </Pressable>
        </View>
      )}
      {state.status === 'error' && (
        <View style={styles.errorBox}>
          <Text selectable style={styles.errorText}>{state.message}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => translate(true)}>
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
