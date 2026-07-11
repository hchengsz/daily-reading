import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChapterSummary } from '@/components/chapter-summary';
import { getBook, getChapter } from '@/lib/book';

export default function ReaderScreen() {
  const { bookId, chapterId } = useLocalSearchParams<{ bookId: string; chapterId: string }>();
  const [fontSize, setFontSize] = useState(19);
  const book = getBook(bookId);
  const chapter = getChapter(bookId, chapterId);
  const index = useMemo(
    () => book?.chapters.findIndex((item) => item.id === chapterId) ?? -1,
    [book, chapterId],
  );

  if (!book || !chapter) {
    return <ScrollView contentInsetAdjustmentBehavior="automatic"><Text style={styles.error}>没有找到这一章。</Text></ScrollView>;
  }

  const previous = book.chapters[index - 1];
  const next = book.chapters[index + 1];

  return (
    <>
      <Stack.Screen options={{ title: chapter.title.split(' · ')[0] }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Text style={styles.section}>{book.title} · {chapter.section} · PDF 第 {chapter.startPage} 页</Text>
        <Text selectable style={styles.title}>{chapter.title}</Text>
        <View style={styles.divider} />
        <ChapterSummary key={`${book.id}:${chapter.id}`} bookId={book.id} chapterId={chapter.id} />
        <Text selectable style={[styles.body, { fontSize, lineHeight: fontSize * 1.9 }]}>{chapter.content}</Text>

        <View style={styles.navigation}>
          {previous ? <ChapterButton bookId={book.id} chapterId={previous.id} label="上一章" title={previous.title} reverse /> : <View style={styles.spacer} />}
          {next ? <ChapterButton bookId={book.id} chapterId={next.id} label="下一章" title={next.title} /> : <View style={styles.spacer} />}
        </View>
      </ScrollView>

      <View style={styles.toolbar}>
        <Pressable accessibilityLabel="减小字号" onPress={() => setFontSize((size) => Math.max(15, size - 2))} style={styles.toolButton}>
          <Text style={styles.smallA}>A</Text>
        </Pressable>
        <Text style={styles.progress}>{index + 1} / {book.chapters.length}</Text>
        <Pressable accessibilityLabel="增大字号" onPress={() => setFontSize((size) => Math.min(29, size + 2))} style={styles.toolButton}>
          <Text style={styles.largeA}>A</Text>
        </Pressable>
      </View>
    </>
  );
}

function ChapterButton({ bookId, chapterId, label, title, reverse = false }: { bookId: string; chapterId: string; label: string; title: string; reverse?: boolean }) {
  return (
    <Link href={{ pathname: '/reader/[bookId]/[chapterId]', params: { bookId, chapterId } }} replace asChild>
      <Pressable style={StyleSheet.flatten([styles.chapterButton, reverse ? styles.chapterButtonReverse : undefined])}>
        {reverse && <Image source="sf:chevron.left" style={styles.icon} tintColor="#8B3A2F" />}
        <View style={styles.chapterText}>
          <Text style={styles.chapterLabel}>{label}</Text>
          <Text numberOfLines={1} style={styles.chapterTitle}>{title}</Text>
        </View>
        {!reverse && <Image source="sf:chevron.right" style={styles.icon} tintColor="#8B3A2F" />}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 120, maxWidth: 760, width: '100%', alignSelf: 'center' },
  section: { color: '#9A5A4F', fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textAlign: 'center' },
  title: { color: '#25211C', fontSize: 28, lineHeight: 39, fontWeight: '700', textAlign: 'center', paddingTop: 12 },
  divider: { width: 40, height: 2, backgroundColor: '#9B4A3D', alignSelf: 'center', marginVertical: 26 },
  body: { color: '#353029', letterSpacing: 0.5 },
  navigation: { flexDirection: 'row', gap: 12, paddingTop: 52 },
  chapterButton: { flex: 1, minWidth: 0, backgroundColor: '#EDE3D2', borderRadius: 16, borderCurve: 'continuous', padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  chapterButtonReverse: { justifyContent: 'flex-start' },
  chapterText: { flex: 1, gap: 3 },
  chapterLabel: { color: '#8B3A2F', fontSize: 12, fontWeight: '700' },
  chapterTitle: { color: '#4D463D', fontSize: 12 },
  icon: { width: 14, height: 14 },
  spacer: { flex: 1 },
  toolbar: { position: 'absolute', left: 20, right: 20, bottom: 22, height: 54, borderRadius: 27, backgroundColor: '#2E2A25', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' },
  toolButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  smallA: { color: '#F8F0E3', fontSize: 15, fontWeight: '600' },
  largeA: { color: '#F8F0E3', fontSize: 23, fontWeight: '600' },
  progress: { color: '#CFC3B2', fontSize: 12, fontVariant: ['tabular-nums'] },
  error: { padding: 24, color: '#8B3A2F', fontSize: 16 },
});
