import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#F5F0E6' },
        }}>
        <Stack.Screen name="index" options={{ title: '我的书架', headerLargeTitle: true }} />
        <Stack.Screen name="add-book" options={{ title: '添加图书', presentation: 'modal' }} />
        <Stack.Screen name="book/[id]" options={{ title: '目录', headerLargeTitle: true }} />
        <Stack.Screen name="reader/[bookId]/[chapterId]" options={{ title: '阅读', headerLargeTitle: false }} />
      </Stack>
      <StatusBar style="dark" />
    </>
  );
}
