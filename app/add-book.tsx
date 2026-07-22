import * as DocumentPicker from 'expo-document-picker';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

type ProcessingMode = 'scg' | 'generic';

type PickedPdf = {
  name: string;
  uri: string;
  mimeType?: string;
  size?: number;
  file?: File;
};

type AddBookResponse = {
  book?: { id: string; title: string; chapters: unknown[]; pageCount: number };
  error?: string;
};

const modeOptions: { value: ProcessingMode; title: string; description: string }[] = [
  {
    value: 'scg',
    title: '驳异大全模式',
    description: '适合旧书扫描 OCR，尽量按“第X章”识别章节，并开启手动 AI 视觉校正文。',
  },
  {
    value: 'generic',
    title: '一般 PDF 模式',
    description: '适合普通 PDF：优先按 PDF 目录切分；没有目录时按页数分段，稳定可读。',
  },
];

export default function AddBookScreen() {
  const [pickedPdf, setPickedPdf] = useState<PickedPdf | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [translator, setTranslator] = useState('');
  const [mode, setMode] = useState<ProcessingMode>('generic');
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = Boolean(pickedPdf && title.trim() && !submitting);
  const sizeLabel = useMemo(() => {
    if (!pickedPdf?.size) return '';
    if (pickedPdf.size > 1024 * 1024) return `${(pickedPdf.size / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(pickedPdf.size / 1024))} KB`;
  }, [pickedPdf]);

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0] as PickedPdf;
    setPickedPdf(asset);
    if (!title.trim()) setTitle(asset.name.replace(/\.pdf$/i, ''));
  }

  async function submit() {
    if (!pickedPdf || !title.trim()) return;
    setSubmitting(true);

    try {
      const form = new FormData();
      appendPdf(form, pickedPdf);
      form.append('title', title.trim());
      form.append('author', author.trim());
      form.append('translator', translator.trim());
      form.append('mode', mode);

      const response = await fetch('/api/add-book', {
        method: 'POST',
        body: form,
      });
      const data = await response.json() as AddBookResponse;
      if (!response.ok || !data.book) throw new Error(data.error || `添加失败（${response.status}）`);

      Alert.alert(
        '添加成功',
        `《${data.book.title}》已生成 ${data.book.chapters.length} 个阅读段。`,
        [{ text: '去阅读', onPress: () => router.replace({ pathname: '/book/[id]', params: { id: data.book!.id } }) }],
      );
    } catch (error) {
      Alert.alert('添加失败', error instanceof Error ? error.message : '添加图书失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: '添加图书' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>本地 PDF 入库</Text>
          <Text style={styles.heading}>选择一本书，然后决定怎么切分</Text>
          <Text style={styles.note}>添加后 PDF 会保存到项目的 books 文件夹，正文会写入 data/library.json。</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={pickPdf}
          style={({ pressed }) => StyleSheet.flatten([styles.fileBox, pressed ? styles.pressed : undefined])}>
          <Text style={styles.fileTitle}>{pickedPdf ? pickedPdf.name : '选择 PDF 文件'}</Text>
          <Text style={styles.fileMeta}>{pickedPdf ? `${sizeLabel || '已选择'} · 点此更换` : '从 iCloud、文件 App 或本机选择一本 PDF'}</Text>
        </Pressable>

        <View style={styles.form}>
          <Label text="书名" />
          <TextInput value={title} onChangeText={setTitle} placeholder="例如：天主之城" style={styles.input} />

          <Label text="作者" />
          <TextInput value={author} onChangeText={setAuthor} placeholder="未知作者也可以先留空" style={styles.input} />

          <Label text="译者" />
          <TextInput value={translator} onChangeText={setTranslator} placeholder="可选" style={styles.input} />
        </View>

        <View style={styles.modeGroup}>
          <Text style={styles.groupTitle}>处理方式</Text>
          {modeOptions.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === option.value }}
              onPress={() => setMode(option.value)}
              style={StyleSheet.flatten([styles.modeCard, mode === option.value ? styles.modeCardSelected : undefined])}>
              <View style={styles.modeHeader}>
                <Text style={styles.modeTitle}>{option.title}</Text>
                <View style={StyleSheet.flatten([styles.radio, mode === option.value ? styles.radioSelected : undefined])} />
              </View>
              <Text style={styles.modeDescription}>{option.description}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={submit}
          style={StyleSheet.flatten([styles.submitButton, !canSubmit ? styles.submitButtonDisabled : undefined])}>
          <Text style={styles.submitText}>{submitting ? '正在提取正文…' : '添加到书库'}</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

function Label({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>;
}

function appendPdf(form: FormData, pdf: PickedPdf) {
  if (pdf.file) {
    form.append('file', pdf.file, pdf.name);
    return;
  }

  form.append('file', {
    uri: pdf.uri,
    name: pdf.name,
    type: pdf.mimeType || 'application/pdf',
  } as unknown as Blob);
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 44, gap: 18 },
  hero: { gap: 8 },
  eyebrow: { color: '#8B3A2F', fontSize: 13, fontWeight: '700', letterSpacing: 2 },
  heading: { color: '#25221D', fontSize: 28, lineHeight: 36, fontWeight: '700' },
  note: { color: '#6D6459', fontSize: 14, lineHeight: 21 },
  fileBox: { backgroundColor: '#FFFCF6', borderRadius: 22, borderCurve: 'continuous', padding: 18, gap: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D8D0C4' },
  pressed: { opacity: 0.76 },
  fileTitle: { color: '#25221D', fontSize: 17, fontWeight: '700' },
  fileMeta: { color: '#83786A', fontSize: 13, lineHeight: 19 },
  form: { backgroundColor: '#FFFCF6', borderRadius: 22, borderCurve: 'continuous', padding: 18, gap: 9 },
  label: { color: '#7B352C', fontSize: 13, fontWeight: '700' },
  input: { backgroundColor: '#F5EFE4', borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 13, paddingVertical: 11, color: '#29241E', fontSize: 16 },
  modeGroup: { gap: 10 },
  groupTitle: { color: '#413B33', fontSize: 16, fontWeight: '700' },
  modeCard: { backgroundColor: '#FFFCF6', borderRadius: 18, borderCurve: 'continuous', padding: 16, gap: 8, borderWidth: 1, borderColor: '#E1D8CA' },
  modeCardSelected: { borderColor: '#8B3A2F', backgroundColor: '#FFF6E9' },
  modeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  modeTitle: { color: '#302A23', fontSize: 16, fontWeight: '700' },
  modeDescription: { color: '#6D6459', fontSize: 13, lineHeight: 20 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#C8B8A2' },
  radioSelected: { borderColor: '#8B3A2F', backgroundColor: '#8B3A2F' },
  submitButton: { backgroundColor: '#8B3A2F', borderRadius: 999, borderCurve: 'continuous', paddingVertical: 14, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#C8B8A2' },
  submitText: { color: '#F9F4E8', fontSize: 16, fontWeight: '700' },
});
