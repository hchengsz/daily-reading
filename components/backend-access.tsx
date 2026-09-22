import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiUrl, readJsonResponse, setBetaAccessToken } from '@/lib/api-client';

export function BackendAccess({ onConnected }: { onConnected: () => Promise<void> }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (process.env.EXPO_PUBLIC_BETA_ACCESS_REQUIRED !== 'true') return null;

  async function connect() {
    setBusy(true);
    setMessage('正在连接；免费服务器首次唤醒可能需要约一分钟…');
    try {
      const response = await fetch(apiUrl('/api/library'), {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      await readJsonResponse(response);
      setBetaAccessToken(token);
      setToken('');
      setMessage('测试服务已连接。完全关闭应用后需重新输入访问码。');
      await onConnected();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.card}>
    <Text style={styles.title}>连接私人测试服务</Text>
    <Text style={styles.note}>输入测试访问码后可使用云端书库和 AI 功能。未连接时仍可阅读内置书籍。</Text>
    <TextInput accessibilityLabel="测试访问码" placeholder="测试访问码" secureTextEntry autoCapitalize="none"
      autoCorrect={false} value={token} onChangeText={setToken} editable={!busy} style={styles.input} />
    <Pressable accessibilityRole="button" disabled={busy || !token.trim()} onPress={connect}
      style={[styles.button, (busy || !token.trim()) && { opacity: 0.5 }]}>
      <Text style={styles.buttonText}>{busy ? '正在连接…' : '连接'}</Text>
    </Pressable>
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.note}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#E9E0D0', borderRadius: 18, padding: 18, gap: 10 },
  title: { color: '#413B33', fontSize: 16, fontWeight: '700' },
  note: { color: '#6D6459', fontSize: 13, lineHeight: 20 },
  input: { backgroundColor: '#FFFCF6', borderRadius: 10, padding: 12, color: '#25221D' },
  button: { backgroundColor: '#8B3A2F', borderRadius: 20, padding: 12, alignItems: 'center' },
  buttonText: { color: '#FFF8E8', fontWeight: '700' },
});
