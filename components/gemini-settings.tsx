import { Button, Column, Host, Text as NativeText, TextInput, useNativeState } from '@expo/ui';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { apiFetch, readJsonResponse } from '@/lib/api-client';
import { normalizeGeminiSettings } from '@/lib/gemini-config';
import { clearGeminiSettings, getGeminiSettings, saveGeminiSettings } from '@/lib/gemini-settings';

export function GeminiSettingsCard() {
  const apiKey = useNativeState('');
  const model = useNativeState('');
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    getGeminiSettings().then((settings) => {
      if (!active) return;
      setSaved(Boolean(settings));
      model.set(settings?.model || '');
    }).catch(() => {
      if (active) { setFailed(true); setMessage('无法读取安全存储，可以重新填写并保存。'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [model]);

  async function run(action: 'save' | 'check' | 'clear') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    setMessage('');
    try {
      if (action === 'clear') {
        await clearGeminiSettings();
        apiKey.set('');
        model.set('');
        setSaved(false);
        setMessage('已清除密钥。已缓存的阅读内容不受影响。');
        return;
      }
      const key = apiKey.value.trim() || (await getGeminiSettings())?.apiKey || '';
      const settings = normalizeGeminiSettings({ apiKey: key, model: model.value });
      if (action === 'save') {
        await saveGeminiSettings(settings);
        apiKey.set('');
        model.set(settings.model);
        setSaved(true);
        setMessage('已保存。总结、翻译和 OCR 将使用此配置；可点击检查连接验证。');
      } else {
        const response = await apiFetch('/api/gemini-check', { method: 'POST', signal: AbortSignal.timeout(60_000) }, settings);
        const result = await readJsonResponse<{ ok: boolean; model: string }>(response);
        if (!result.ok) throw new Error('连接检查失败，请稍后重试');
        setMessage(`连接正常，模型：${result.model}。此检查不生成内容；如有修改，请保存配置。`);
      }
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Gemini 设置</Text>
      <Text style={styles.note}>{loading ? '正在读取配置…' : saved ? '已保存 API Key · 用于 AI 总结、翻译和 OCR' : '尚未配置 API Key · 阅读原文无需密钥'}</Text>
      <Host matchContents={{ vertical: true }} colorScheme="light" seedColor="#8B3A2F">
        <Column spacing={12}>
          <Button variant="outlined" disabled={loading || busy} onPress={() => setExpanded(!expanded)}
            label={expanded ? '收起设置' : saved ? '管理 Gemini API Key' : '填写 Gemini API Key'} />
          {expanded && <>
            <NativeText>Gemini API Key</NativeText>
            <TextInput
              testID="gemini-api-key"
              value={apiKey}
              secureTextEntry
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              placeholder={saved ? '已保存（留空保留，输入可替换）' : '粘贴 Gemini API Key'}
              style={{ padding: 12, backgroundColor: '#FFFCF6', borderRadius: 10 }}
            />
            <NativeText>模型 ID（可选，留空使用服务器默认）</NativeText>
            <TextInput
              testID="gemini-model"
              value={model}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              maxLength={120}
              placeholder="例如 gemini-3.8-flash"
              style={{ padding: 12, backgroundColor: '#FFFCF6', borderRadius: 10 }}
            />
            <Button label="保存配置" disabled={busy} onPress={() => { void run('save'); }} />
            <Button label="检查连接（不生成内容）" variant="outlined" disabled={busy} onPress={() => { void run('check'); }} />
            {saved && <Button label="清除密钥" variant="text" disabled={busy} onPress={() => {
              if (Platform.OS === 'web') { void run('clear'); return; }
              Alert.alert('清除 Gemini 密钥？', '之后需重新输入密钥才能生成新的 AI 内容。', [
                { text: '取消', style: 'cancel' },
                { text: '清除', style: 'destructive', onPress: () => { void run('clear'); } },
              ]);
            }} />}
          </>}
        </Column>
      </Host>
      {expanded && <Text style={styles.note}>
        {Platform.OS === 'web' ? '网页版仅在当前页面内存中保留密钥，刷新后需重新输入。' : '密钥加密保存在本机安全存储中，不写入书库或云端配置。'}
        使用 AI 时，密钥和当前章节内容会经本应用后端通过 HTTPS 发送给 Google Gemini，费用计入你的 Google 账户。连接检查只验证密钥和模型访问权限，不保证剩余额度。测试访问码与 API Key 是两项独立配置。
      </Text>}
      {busy && <Text style={styles.note}>正在处理…</Text>}
      {!!message && <Text selectable accessibilityLiveRegion="polite" style={[styles.note, failed && styles.error]}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#E9E0D0', borderRadius: 18, padding: 18, gap: 10 },
  title: { color: '#413B33', fontSize: 16, fontWeight: '700' },
  note: { color: '#6D6459', fontSize: 13, lineHeight: 20 },
  error: { color: '#8B3A2F' },
});
