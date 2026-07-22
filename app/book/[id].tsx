import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import { Chapter, getBookFrom } from '@/lib/book';
import { useLibrary } from '@/lib/use-library';

export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { library, loading } = useLibrary();
  const book = getBookFrom(library, id);
  if (!book) {
    return <View style={styles.errorBox}><Text style={styles.errorText}>{loading ? '正在读取目录…' : '没有找到这本书。'}</Text></View>;
  }
  const grouped = book.chapters.reduce<{ title: string; data: Chapter[] }[]>((sections, chapter) => {
    const last = sections[sections.length - 1];
    if (last?.title === chapter.section) last.data.push(chapter);
    else sections.push({ title: chapter.section, data: [chapter] });
    return sections;
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: book.title }} />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        sections={grouped}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.author}>{book.author}</Text>
            <Text style={styles.summary}>共 {book.chapters.length} 个章节节点，来源于 {book.pageCount} 页 PDF</Text>
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item, index, section }) => (
          <Link href={{ pathname: '/reader/[bookId]/[chapterId]', params: { bookId: book.id, chapterId: item.id } }} asChild>
            <Pressable
              style={({ pressed }) => StyleSheet.flatten([
                styles.row,
                index === section.data.length - 1 ? styles.lastRow : undefined,
                pressed ? styles.pressedRow : undefined,
              ])}>
              <Text style={styles.rowText} numberOfLines={2}>{item.title}</Text>
            </Pressable>
          </Link>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, gap: 6 },
  author: { color: '#514A41', fontSize: 17, fontWeight: '600' },
  summary: { color: '#857B6D', fontSize: 13, fontVariant: ['tabular-nums'] },
  section: { backgroundColor: '#E8DFCF', color: '#7B352C', paddingHorizontal: 20, paddingVertical: 9, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  row: { backgroundColor: '#FFFCF6', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8D0C4' },
  rowText: { color: '#2B2823', fontSize: 16, lineHeight: 23 },
  pressedRow: { backgroundColor: '#F0E8DB' },
  lastRow: { borderBottomWidth: 0 },
  errorBox: { padding: 24 },
  errorText: { color: '#8B3A2F', fontSize: 16 },
});
