// =============================================================================
// SupportThread — konverzace se zákazníkem BS2 (jen Tomáš a Jan Holý)
// =============================================================================
// GET  /api/velin/support/threads/:id           — načte zprávy + označí přečtené
// GET  ...?after=<id>                           — polling nových zpráv (5 s)
// POST /api/velin/support/threads/:id/send      — odpověď (zákazník dostane e-mail,
//                                                 pokud není online na webu)
// Přílohy od zákazníka: obrázky se zobrazí v bublině (tap = celá obrazovka).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useKeyboardPad } from '../lib/useKeyboardPad';
import { api, ApiError, type SupportMessage, type SupportThreadResponse } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';
import { supportName } from './SupportList';

type Props = NativeStackScreenProps<RootStackParamList, 'SupportThread'>;
type Local = SupportMessage & { _status?: 'sending' | 'failed' };

function fmt(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const t = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return t;
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) + ' ' + t;
}

export default function SupportThread({ route }: Props) {
  const kbPad = useKeyboardPad(); // Android: pole pro psaní nad klávesnicí
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { supporterId, title } = route.params;

  const [msgs, setMsgs] = useState<Local[]>([]);
  const [info, setInfo] = useState<SupportThreadResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [bigImage, setBigImage] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const list = useRef<FlatList<Local>>(null);
  const mounted = useRef(true);
  const lastId = useRef(0);
  const tmp = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  const scrollEnd = () => setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80);

  const merge = useCallback((incoming: SupportMessage[]) => {
    if (!incoming.length) return;
    setMsgs((cur) => {
      const have = new Set(cur.filter((m) => m.id > 0).map((m) => m.id));
      const fresh = incoming.filter((m) => !have.has(m.id));
      if (!fresh.length) return cur;
      // Náhradu optimistické bubliny provede odpověď na odeslání; ostatní jen přidej
      return [...cur, ...fresh].sort((a, b) => (a.id > 0 && b.id > 0 ? a.id - b.id : 0));
    });
    lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
    scrollEnd();
  }, []);

  const load = useCallback(async (initial: boolean) => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    setJwt(auth.jwt);
    try {
      const r = await api.supportThread(auth.jwt, supporterId, initial ? undefined : lastId.current);
      if (!mounted.current) return;
      setInfo((prev) => ({ ...(prev || r), ...r, msgs: [] }));
      if (initial) {
        setMsgs(r.msgs);
        lastId.current = r.msgs.reduce((m, x) => Math.max(m, x.id), 0);
        scrollEnd();
      } else {
        merge(r.msgs);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [navigation, supporterId, merge]);

  useEffect(() => { load(true); }, [load]);
  useFocusEffect(useCallback(() => {
    const t = setInterval(() => load(false), 5000);
    return () => clearInterval(t);
  }, [load]));

  async function send(retry?: Local) {
    const text = (retry ? retry.body : draft).trim();
    if (!text) return;
    const auth = await loadAuth();
    if (!auth.jwt) return;
    const tid = retry ? retry.id : -(++tmp.current);
    if (!retry) {
      setMsgs((c) => [...c, {
        id: tid, supporter_id: supporterId, sender: 'agent', agent_name: info?.agent || null, body: text,
        created_at: new Date().toISOString(), file_name: null, file_type: null, file_size: null, order_id: null, _status: 'sending',
      }]);
      setDraft('');
      scrollEnd();
    } else {
      setMsgs((c) => c.map((m) => (m.id === tid ? { ...m, _status: 'sending' } : m)));
    }
    try {
      const r = await api.supportSend(auth.jwt, supporterId, text);
      if (!mounted.current) return;
      setMsgs((c) => {
        const without = c.filter((m) => m.id !== tid);
        return r.msg && !without.some((m) => m.id === r.msg!.id) ? [...without, r.msg] : without;
      });
      if (r.msg) lastId.current = Math.max(lastId.current, r.msg.id);
    } catch (err) {
      if (!mounted.current) return;
      setMsgs((c) => c.map((m) => (m.id === tid ? { ...m, _status: 'failed' } : m)));
    }
  }

  const name = info ? supportName(info.who) : title || 'Podpora';
  const imgHeaders: Record<string, string> = jwt ? { Authorization: `Bearer ${jwt}` } : {};

  if (loading && msgs.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowInfo((v) => !v)} activeOpacity={0.7}>
          <Text style={styles.title} numberOfLines={1}>{name}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {info?.online ? '● právě na webu' : 'není na webu'}{info?.who.email ? ` · ${info.who.email}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowInfo((v) => !v)} hitSlop={12}>
          <Text style={styles.infoBtn}>{showInfo ? '▴' : 'ⓘ'}</Text>
        </TouchableOpacity>
      </View>

      {showInfo && info && (
        <View style={styles.infoCard}>
          <View style={styles.kv}><Text style={styles.k}>E-mail</Text><Text style={styles.v}>{info.who.email || '—'}</Text></View>
          <View style={styles.kv}><Text style={styles.k}>Telefon</Text><Text style={styles.v}>{info.who.phone || '—'}</Text></View>
          <View style={styles.kv}><Text style={styles.k}>Objednávky</Text><Text style={styles.v}>{info.orders}</Text></View>
          {!!info.who.phone && (
            <TouchableOpacity style={styles.callBtn} onPress={() => Linking.openURL(`tel:${info.who.phone}`)}>
              <Text style={styles.callBtnText}>📞 Zavolat</Text>
            </TouchableOpacity>
          )}
          {!info.supportOnline && (
            <Text style={styles.warn}>Podpora je offline — zákazník zprávu uvidí, ale nemůže odpovědět v reálném čase.</Text>
          )}
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1, paddingBottom: kbPad }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={list}
          data={msgs}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={styles.msgs}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.empty}>Zatím žádné zprávy.</Text>}
          renderItem={({ item }) => {
            const mine = item.sender === 'agent';
            const isImg = !!item.file_type && item.file_type.startsWith('image/');
            return (
              <View style={[styles.rowWrap, mine ? styles.rowMine : styles.rowTheirs]}>
                <Pressable
                  onPress={() => item._status === 'failed' && send(item)}
                  style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                >
                  {isImg && item.id > 0 && (
                    <TouchableOpacity onPress={() => setBigImage({ uri: api.supportFileUrl(item.id), headers: imgHeaders })}>
                      <Image
                        source={{ uri: api.supportFileUrl(item.id), headers: imgHeaders }}
                        style={styles.img}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  )}
                  {!isImg && !!item.file_name && <Text style={styles.file}>📎 {item.file_name}</Text>}
                  {!!item.body && !(item.file_name && item.body === `📎 ${item.file_name}`) && (
                    <Text style={[styles.text, mine && styles.textMine]}>{item.body}</Text>
                  )}
                  <Text style={[styles.meta, mine && styles.metaMine]}>
                    {mine && item.agent_name ? `${item.agent_name} · ` : ''}{fmt(item.created_at)}
                    {item._status === 'sending' ? ' · odesílám…' : ''}
                    {item._status === 'failed' ? ' · ❌ klepni pro opakování' : ''}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Napsat odpověď…"
            placeholderTextColor={colors.text2}
            multiline
            maxLength={4000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !draft.trim() && { opacity: 0.4 }]}
            onPress={() => send()}
            disabled={!draft.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.sendText}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!bigImage} transparent animationType="fade" onRequestClose={() => setBigImage(null)}>
        <Pressable style={styles.modal} onPress={() => setBigImage(null)}>
          {bigImage && <Image source={bigImage} style={styles.bigImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  back: { color: colors.accent2, fontSize: 34, lineHeight: 34 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.text2, fontSize: 11, marginTop: 1 },
  infoBtn: { color: colors.accent2, fontSize: 20 },
  infoCard: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 },
  kv: { flexDirection: 'row', justifyContent: 'space-between' },
  k: { color: colors.text2, fontSize: 13 },
  v: { color: colors.text, fontSize: 13, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  callBtn: { marginTop: spacing.sm, backgroundColor: colors.surface2, paddingVertical: 9, borderRadius: radius.md, alignItems: 'center' },
  callBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  warn: { color: colors.warning, fontSize: 12, marginTop: spacing.sm },
  msgs: { padding: spacing.lg, paddingBottom: spacing.md, flexGrow: 1 },
  empty: { color: colors.text2, textAlign: 'center', marginTop: 40 },
  rowWrap: { marginBottom: spacing.sm, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  text: { color: colors.text, fontSize: 15, lineHeight: 20 },
  textMine: { color: '#fff' },
  file: { color: colors.accent2, fontSize: 14, marginBottom: 4 },
  img: { width: 220, height: 160, borderRadius: 10, marginBottom: 6, backgroundColor: colors.surface2 },
  meta: { color: colors.text2, fontSize: 10, marginTop: 3 },
  metaMine: { color: 'rgba(255,255,255,0.75)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 120, minHeight: 40, backgroundColor: colors.bg, color: colors.text, borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 18 },
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  bigImg: { width: '100%', height: '90%' },
});
