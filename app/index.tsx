import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { hideBook, restoreAllBooks, useHiddenBooks } from '@/lib/library-storage';
import { useLibrary } from '@/lib/use-library';

const coverColors = ['#8B3A2F', '#315C56', '#6A4B73', '#7A5A31', '#3D5875', '#73524A'];

export default function LibraryScreen() {
  const { library, loading, error } = useLibrary();
  const hiddenBookIds = useHiddenBooks();
  const visibleBooks = library.books.filter((book) => !hiddenBookIds.includes(book.id));

  function confirmDelete(bookId: string, title: string) {
    Alert.alert(
      '从书架删除？',
      `“${title}”将从当前书架隐藏，内置书稿不会被永久删除。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => hideBook(bookId) },
      ],
    );
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>我的藏书</Text>
      <Text style={styles.heading}>安静地读一会儿</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/add-book' as never)}
        style={({ pressed }) => StyleSheet.flatten([styles.addButton, pressed ? styles.addButtonPressed : undefined])}>
        <Image source="sf:plus" style={styles.addIcon} tintColor="#F9F4E8" />
        <Text style={styles.addText}>添加图书</Text>
      </Pressable>
      {loading && <Text style={styles.statusText}>正在读取最新书库…</Text>}
      {error && <Text style={styles.statusText}>使用本地书库：{error}</Text>}

      {visibleBooks.map((book, index) => (
        <View key={book.id} style={styles.card}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/book/[id]', params: { id: book.id } })}
            style={({ pressed }) => pressed ? styles.bookPressed : styles.bookContent}>
            <View style={[styles.cover, { backgroundColor: coverColors[index % coverColors.length] }]}>
              <Text style={styles.coverSmall}>离线藏书</Text>
              <Text style={styles.coverTitle} numberOfLines={4}>{book.title}</Text>
              <View style={styles.rule} />
              <Text style={styles.coverAuthor}>{book.author}</Text>
            </View>
            <View style={styles.details}>
              <Text style={styles.title}>{book.title}</Text>
              <Text style={styles.author}>{book.author}</Text>
              <Text style={styles.meta}>{book.chapters.length} 章 · {book.pageCount} 页</Text>
              <View style={styles.continueButton}>
                <Text style={styles.continueText}>开始阅读</Text>
                <Image source="sf:chevron.right" style={styles.chevron} tintColor="#F9F4E8" />
              </View>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel={`删除${book.title}`}
            onPress={() => confirmDelete(book.id, book.title)}
            style={styles.deleteButton}>
            <Image source="sf:trash" style={styles.deleteIcon} tintColor="#8B3A2F" />
          </Pressable>
        </View>
      ))}

      {visibleBooks.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>书架空了</Text>
          <Text style={styles.noteText}>你可以恢复所有内置书籍。</Text>
        </View>
      )}

      <View style={styles.note}>
        <Text style={styles.noteTitle}>离线可读</Text>
        <Text style={styles.noteText}>你可以从手机选择 PDF 添加到本地书库；AI 总结和 OCR 校正文会继续保存到本地缓存。</Text>
        {hiddenBookIds.length > 0 && (
          <Pressable onPress={restoreAllBooks} style={styles.restoreButton}>
            <Text style={styles.restoreText}>恢复已删除书籍（{hiddenBookIds.length}）</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, gap: 16 },
  eyebrow: { color: '#8B3A2F', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  heading: { color: '#25221D', fontSize: 30, fontWeight: '700', marginBottom: 8 },
  addButton: { backgroundColor: '#8B3A2F', borderRadius: 999, borderCurve: 'continuous', paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addButtonPressed: { opacity: 0.78 },
  addIcon: { width: 16, height: 16 },
  addText: { color: '#F9F4E8', fontSize: 15, fontWeight: '700' },
  statusText: { color: '#7A6D5D', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: '#FFFCF6', borderRadius: 24, borderCurve: 'continuous', boxShadow: '0 8px 24px rgba(70,50,30,0.12)', overflow: 'hidden' },
  bookContent: { padding: 18, flexDirection: 'row', gap: 18 },
  bookPressed: { padding: 18, flexDirection: 'row', gap: 18, opacity: 0.78 },
  cover: { width: 112, aspectRatio: 0.7, borderRadius: 8, borderCurve: 'continuous', padding: 12, justifyContent: 'space-between' },
  coverSmall: { color: '#E7C69B', fontSize: 9, letterSpacing: 1 },
  coverTitle: { color: '#FFF8E8', fontSize: 19, fontWeight: '700', lineHeight: 27, letterSpacing: 1 },
  rule: { height: 1, backgroundColor: '#D8B681' },
  coverAuthor: { color: '#E7C69B', fontSize: 9, lineHeight: 14 },
  details: { flex: 1, paddingVertical: 7, justifyContent: 'center', gap: 6 },
  title: { color: '#25221D', fontSize: 19, fontWeight: '700' },
  author: { color: '#635C52', fontSize: 13 },
  meta: { color: '#948A7C', fontSize: 12, fontVariant: ['tabular-nums'] },
  continueButton: { marginTop: 10, backgroundColor: '#8B3A2F', borderRadius: 99, paddingVertical: 9, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  continueText: { color: '#F9F4E8', fontWeight: '700', fontSize: 13 },
  chevron: { width: 14, height: 14 },
  deleteButton: { position: 'absolute', right: 8, top: 8, width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFF8EE', alignItems: 'center', justifyContent: 'center' },
  deleteIcon: { width: 17, height: 17 },
  note: { marginTop: 8, backgroundColor: '#E9E0D0', borderRadius: 18, borderCurve: 'continuous', padding: 18, gap: 8 },
  noteTitle: { color: '#413B33', fontSize: 15, fontWeight: '700' },
  noteText: { color: '#6D6459', fontSize: 14, lineHeight: 21 },
  restoreButton: { alignSelf: 'flex-start', paddingVertical: 8 },
  restoreText: { color: '#8B3A2F', fontSize: 14, fontWeight: '700' },
  empty: { backgroundColor: '#FFFCF6', borderRadius: 20, padding: 24, gap: 8 },
  emptyTitle: { color: '#302A23', fontSize: 20, fontWeight: '700' },
});
