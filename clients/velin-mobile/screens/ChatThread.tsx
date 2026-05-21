// =============================================================================
// ChatThread — konkrétní chat, scroll zpráv + send box
// =============================================================================
// GET /api/velin/chat/channels/:id/messages?limit=50 — posledních 50 zpráv.
// POST /api/velin/chat/channels/:id/messages — odeslat (s optimistic UI).
// POST /api/velin/chat/channels/:id/read — mark read při otevření / focus.
//
// "isMe" = porovnání sender_id (= User.id z backendu) s auth.userId
// uloženým v SecureStore při loginu. NE personId — chat využívá User model.
//
// Bubliny:
//   - mé (vpravo): accent indigo s tmavým textem
//   - cizí (vlevo): surface2 (světlejší slate) s avatarem
//
// Optimistic send:
//   1) User klikne Odeslat → vytvoříme local message s id 'tmp-<n>', status 'sending'.
//   2) Vyčistíme input, přidáme zprávu do listu okamžitě.
//   3) Pošleme přes API. Po úspěchu nahradíme tmp zprávu reálnou.
//   4) Po failu označíme jako 'failed' (TODO retry tap).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { api, ApiError, type ChatMessage, type ChatAttachment } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

type LocalMessage = ChatMessage & {
  _status?: 'sending' | 'sent' | 'failed';
};

export default function ChatThread({ route }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { channelId, channelTitle } = route.params;

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const tmpCounter = useRef(0);
  const flatListRef = useRef<FlatList<LocalMessage>>(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    navigation.setOptions({
      title: channelTitle || 'Chat',
      headerShown: true,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '600' },
    });
  }, [navigation, channelTitle]);

  const loadMessages = useCallback(async () => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    // myUserId = User.id (chat backend ho vrací jako sender_id)
    if (mountedRef.current) setMyUserId(auth.userId);

    try {
      const fresh = await api.chatMessages(auth.jwt, channelId);
      if (!mountedRef.current) return;
      setMessages(fresh as LocalMessage[]);
      setError(null);
      api.chatMarkRead(auth.jwt, channelId).catch(() => { /* silent */ });
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          await clearAuth();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        setError(err.message);
      } else {
        setError('Nepodařilo se načíst zprávy.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [channelId, navigation]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useFocusEffect(useCallback(() => { loadMessages(); }, [loadMessages]));

  // Společná pošli funkce — content + volitelné attachments[].
  // Optimistic UI: hned přidá tmp zprávu, po confirmu nahradí reálnou.
  async function sendMessage(content: string, attachments: ChatAttachment[] = []) {
    if (sending) return;
    if (!content.trim() && attachments.length === 0) return;

    const auth = await loadAuth();
    if (!auth.jwt) return;
    // POZOR: auth.userId může být null u starších uživatelů, kteří se nepřihlásili
    // znovu po doručení Krok D OTA (KEY_USER_ID nebyl ještě v SecureStore).
    // Backend identifikuje uživatele z JWT, takže send funguje i bez userId — jen
    // bubliny budou všechny vlevo (sender_id !== null userId). Doporučit re-login.
    const localUserId = auth.userId || -1;

    tmpCounter.current += 1;
    const tmpId = `tmp-${Date.now()}-${tmpCounter.current}`;
    const tmpMsg: LocalMessage = {
      id: tmpId,
      channel_id: channelId,
      sender_id: localUserId,
      sender_type: 'user',
      sender_label: null,
      content: content.trim(),
      attachments: attachments.length ? attachments : null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      sender: {
        id: localUserId,
        username: auth.username || '',
        display_name: auth.displayName || auth.username || '',
        person: null,
      },
      _status: 'sending',
    };
    setMessages((prev) => [...prev, tmpMsg]);
    setDraft('');
    setSending(true);

    try {
      const real = await api.chatSend(auth.jwt, channelId, content.trim(), attachments);
      if (!mountedRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...(real as LocalMessage), _status: 'sent' } : m)));
    } catch (err) {
      if (!mountedRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...m, _status: 'failed' } : m)));
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }

  function handleSend() {
    sendMessage(draft);
  }

  // ─── Attachments ──────────────────────────────────────────────────────────
  //
  // Tři tlačítka v send baru — 📷 kamera, 🖼 galerie, 📎 soubor.
  // Po výběru: upload na R2 → poslat ChatMessage s attachments[].

  async function uploadAndSend(file: { uri: string; name: string; mime: string }) {
    const auth = await loadAuth();
    if (!auth.jwt) return;
    setSending(true);
    try {
      const attachment = await api.chatUpload(auth.jwt, file, channelId);
      // Pošli zprávu s tímhle attachmentem (text z draftu jako caption, pokud je)
      await sendMessage(draft, [attachment]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Upload selhal.';
      Alert.alert('Nepodařilo se odeslat soubor', msg);
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }

  async function handleCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Přístup k fotoaparátu',
        'Povol Velínu používat fotoaparát v Nastavení iPhonu.'
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,           // ~70 % kvalita = malý soubor, ale stále hezký
      allowsEditing: false,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const a = result.assets[0];
    await uploadAndSend({
      uri: a.uri,
      name: a.fileName || `IMG_${Date.now()}.jpg`,
      mime: a.mimeType || 'image/jpeg',
    });
  }

  async function handleGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Přístup k fotkám',
        'Povol Velínu používat tvoje fotky v Nastavení iPhonu.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const a = result.assets[0];
    await uploadAndSend({
      uri: a.uri,
      name: a.fileName || `IMG_${Date.now()}.jpg`,
      mime: a.mimeType || 'image/jpeg',
    });
  }

  async function handleFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const a = result.assets[0];
    await uploadAndSend({
      uri: a.uri,
      name: a.name || `file_${Date.now()}`,
      mime: a.mimeType || 'application/octet-stream',
    });
  }

  if (loading && messages.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item, index }) => {
            const prev = index > 0 ? messages[index - 1] : null;
            const sameAuthorAsPrev = prev && prev.sender_id === item.sender_id;
            const isMine = item.sender_id != null && item.sender_id === myUserId;
            return (
              <Bubble
                message={item}
                isMe={isMine}
                showSenderName={!sameAuthorAsPrev && !isMine}
              />
            );
          }}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => {
            // Auto-scroll na konec při nové zprávě
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          ListEmptyComponent={
            !loading && !error ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Začni rozhovor 👋</Text>
              </View>
            ) : null
          }
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>⚠ {error}</Text>
              </View>
            ) : null
          }
        />

        <View style={styles.sendBar}>
          {/* Attachment tlačítka */}
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handleCamera}
            disabled={sending}
            activeOpacity={0.6}
          >
            <Text style={styles.attachIcon}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handleGallery}
            disabled={sending}
            activeOpacity={0.6}
          >
            <Text style={styles.attachIcon}>🖼</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handleFile}
            disabled={sending}
            activeOpacity={0.6}
          >
            <Text style={styles.attachIcon}>📎</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Napiš zprávu…"
            placeholderTextColor={colors.text2}
            multiline
            maxLength={4000}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#0b1220" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>Pošli</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  isMe,
  showSenderName,
}: {
  message: LocalMessage;
  isMe: boolean;
  showSenderName: boolean;
}) {
  const time = new Date(message.created_at).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.row, isMe ? styles.rowMe : styles.rowOther]}>
      {/* Avatar jen u cizích zpráv (vlevo) */}
      {!isMe && (
        message.sender?.person?.photo_url ? (
          <Image
            source={{ uri: message.sender.person.photo_url }}
            style={styles.avatar}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {(message.sender?.display_name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )
      )}

      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
        {showSenderName && message.sender?.display_name && (
          <Text style={styles.senderName}>{message.sender.display_name}</Text>
        )}
        {message.content ? (
          <Text style={[styles.text, isMe ? styles.textMe : styles.textOther]}>
            {message.content}
          </Text>
        ) : null}
        {message.attachments && message.attachments.length > 0 && (
          <View style={styles.attachments}>
            {message.attachments.map((a, i) =>
              a.kind === 'image' ? (
                <Image
                  key={i}
                  source={{ uri: a.url }}
                  style={styles.imageAttachment}
                  resizeMode="cover"
                />
              ) : (
                <Text
                  key={i}
                  style={[styles.attachmentLabel, isMe ? styles.textMe : styles.textOther]}
                >
                  📎 {a.name || a.url.split('/').pop()}
                </Text>
              )
            )}
          </View>
        )}
        <View style={styles.meta}>
          <Text style={[styles.time, isMe ? styles.timeMe : styles.timeOther]}>{time}</Text>
          {message._status === 'sending' && (
            <Text style={[styles.status, isMe ? styles.timeMe : styles.timeOther]}> · odesílá se…</Text>
          )}
          {message._status === 'failed' && (
            <Text style={[styles.status, { color: colors.danger }]}> · ! nedoručeno</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  emptyState: { alignItems: 'center', padding: spacing.xxl },
  emptyText: { color: colors.text2, fontSize: 14 },
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: { color: colors.danger, fontSize: 13 },

  // Řádek zprávy — wrap pro avatar + bubble
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },

  // Avatar cizí strany
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: spacing.xs,
    backgroundColor: colors.surface2,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.text, fontSize: 12, fontWeight: '700' },

  // Bublina obecně
  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Mé zprávy — indigo accent, tmavý text
  bubbleMe: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: 4,
    marginLeft: 'auto',
  },
  // Cizí — světlejší slate pro lepší kontrast (oproti původnímu surface)
  bubbleOther: {
    backgroundColor: colors.surface2,
    borderBottomLeftRadius: 4,
  },

  senderName: {
    color: colors.accent2,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  text: { fontSize: 15, lineHeight: 20 },
  textMe: { color: '#0b1220' },         // tmavý text na indigo bublině
  textOther: { color: colors.text },    // světlý text na slate bublině

  attachments: { marginTop: spacing.xs },
  attachmentLabel: { fontSize: 13, marginTop: 2 },

  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    justifyContent: 'flex-end',
  },
  time: { fontSize: 10 },
  timeMe: { color: 'rgba(11,18,32,0.6)' },
  timeOther: { color: colors.text2 },
  status: { fontSize: 10 },

  // Send bar (footer)
  sendBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    marginRight: spacing.sm,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    minHeight: 40,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#0b1220', fontWeight: '700', fontSize: 15 },

  // Attachment tlačítka — 📷 🖼 📎 — kompaktní, vedle input pole
  attachBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  attachIcon: { fontSize: 20 },

  // Image attachment v bublině — fullscreen-ready thumbnail
  imageAttachment: {
    width: 220,
    height: 220,
    borderRadius: radius.md,
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
  },
});
