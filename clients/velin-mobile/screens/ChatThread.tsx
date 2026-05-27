// =============================================================================
// ChatThread — konkrétní chat, scroll zpráv + send box + polish (Krok G)
// =============================================================================
// GET /api/velin/chat/channels/:id/messages?limit=50&before=<id> — paginated.
// POST /api/velin/chat/channels/:id/messages — odeslat (s optimistic UI).
// POST /api/velin/chat/channels/:id/read — mark read při otevření / focus.
// POST /api/velin/chat/upload — multipart upload pro fotky/soubory.
//
// Krok G polish:
//   - Tap na obrázek v bublině → fullscreen Modal s velkým náhledem
//   - Tap na soubor → Linking.openURL (iOS Files / Quick Look)
//   - Pull-to-refresh (RefreshControl) — táhni shora, refetch
//   - Paginace — scroll k vrcholu, načte starší (?before=<msgId>)
//   - Tap na ❌ failed bublinu → retry send
//
// "isMe" = sender_id (User.id) === auth.userId. Permissivní guard:
//   pokud auth.userId chybí (starší SecureStore před isMe fixem), send
//   stále funguje — backend identifikuje z JWT.

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
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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

const PAGE_LIMIT = 50;

export default function ChatThread({ route }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { channelId, channelTitle } = route.params;

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
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

  // Hlavní načítací funkce. `mode`:
  //   'mount' — první načtení (full reset)
  //   'refresh' — pull-to-refresh (full reset, ale bez velkého spinneru)
  //   'older' — paginace, načte starší a appendne nahoru
  const loadMessages = useCallback(async (mode: 'mount' | 'refresh' | 'older') => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    if (mountedRef.current) setMyUserId(auth.userId);

    try {
      let before: string | undefined;
      if (mode === 'older' && messages.length > 0) {
        // První zpráva (nejstarší) — paginace si vezme starší než ona
        before = messages[0].id;
        if (!before || before.startsWith('tmp-')) return; // optimistic zpráva, paginate dál ne
      }

      const fresh = await api.chatMessages(auth.jwt, channelId, before, PAGE_LIMIT);
      if (!mountedRef.current) return;

      if (mode === 'older') {
        // Appendni nahoru (jsou starší než aktuální nejstarší)
        setMessages((prev) => [...(fresh as LocalMessage[]), ...prev]);
        if (fresh.length < PAGE_LIMIT) setHasMoreOlder(false);
      } else {
        // Mount nebo refresh — kompletní replace
        setMessages(fresh as LocalMessage[]);
        setHasMoreOlder(fresh.length >= PAGE_LIMIT);
      }
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
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingOlder(false);
      }
    }
  }, [channelId, navigation, messages]);

  useEffect(() => {
    loadMessages('mount');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  useFocusEffect(useCallback(() => {
    loadMessages('refresh');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]));

  // Pošli zprávu — společně pro text i attachment.
  async function sendMessage(content: string, attachments: ChatAttachment[] = []) {
    if (sending) return;
    if (!content.trim() && attachments.length === 0) return;

    const auth = await loadAuth();
    if (!auth.jwt) return;
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

  // Retry: tap na failed bublinu → smaž ji a pošli znovu se stejným obsahem
  function handleRetry(failed: LocalMessage) {
    setMessages((prev) => prev.filter((m) => m.id !== failed.id));
    sendMessage(failed.content, failed.attachments || []);
  }

  // Attachments — kamera, galerie, soubor
  async function uploadAndSend(file: { uri: string; name: string; mime: string }) {
    const auth = await loadAuth();
    if (!auth.jwt) return;
    setSending(true);
    try {
      const attachment = await api.chatUpload(auth.jwt, file, channelId);
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
      Alert.alert('Přístup k fotoaparátu', 'Povol Velínu používat fotoaparát v Nastavení iPhonu.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
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
      Alert.alert('Přístup k fotkám', 'Povol Velínu používat tvoje fotky v Nastavení iPhonu.');
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

  // File tap — otevři v iOS Files / Quick Look
  async function openExternalFile(url: string) {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) {
        Alert.alert('Nelze otevřít', 'Tento soubor iOS neumí přímo otevřít.');
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Chyba', 'Nepodařilo se otevřít soubor.');
    }
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
                onImageTap={(url) => setFullscreenImage(url)}
                onFileTap={openExternalFile}
                onRetry={() => handleRetry(item)}
              />
            );
          }}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadMessages('refresh');
              }}
              tintColor={colors.accent}
            />
          }
          // Paginace: když uživatel scrollne k vrcholu, načti starší
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            if (y < 50 && hasMoreOlder && !loadingOlder && messages.length > 0) {
              setLoadingOlder(true);
              loadMessages('older');
            }
          }}
          scrollEventThrottle={400}
          ListEmptyComponent={
            !loading && !error ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Začni rozhovor 👋</Text>
              </View>
            ) : null
          }
          ListHeaderComponent={
            <>
              {loadingOlder && (
                <View style={styles.olderLoader}>
                  <ActivityIndicator color={colors.accent} size="small" />
                </View>
              )}
              {error && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>⚠ {error}</Text>
                </View>
              )}
            </>
          }
        />

        <View style={styles.sendBar}>
          <TouchableOpacity style={styles.attachBtn} onPress={handleCamera} disabled={sending} activeOpacity={0.6}>
            <Text style={styles.attachIcon}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={handleGallery} disabled={sending} activeOpacity={0.6}>
            <Text style={styles.attachIcon}>🖼</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachBtn} onPress={handleFile} disabled={sending} activeOpacity={0.6}>
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

      {/* Fullscreen image preview — tap mimo / na X zavře */}
      <Modal
        visible={fullscreenImage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreenImage(null)}
      >
        <Pressable style={styles.fullscreenBg} onPress={() => setFullscreenImage(null)}>
          {fullscreenImage && (
            <Image
              source={{ uri: fullscreenImage }}
              style={styles.fullscreenImage}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={styles.fullscreenClose}
            onPress={() => setFullscreenImage(null)}
          >
            <Text style={styles.fullscreenCloseText}>✕</Text>
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  isMe,
  showSenderName,
  onImageTap,
  onFileTap,
  onRetry,
}: {
  message: LocalMessage;
  isMe: boolean;
  showSenderName: boolean;
  onImageTap: (url: string) => void;
  onFileTap: (url: string) => void;
  onRetry: () => void;
}) {
  const time = new Date(message.created_at).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isFailed = message._status === 'failed';

  // Cely Bubble je touchable jen pokud je failed (=retry). Jinak jednotlivé části.
  const Wrap: any = isFailed ? Pressable : View;
  const wrapProps = isFailed ? { onPress: onRetry } : {};

  return (
    <View style={[styles.row, isMe ? styles.rowMe : styles.rowOther]}>
      {!isMe && (
        message.sender?.person?.photo_url ? (
          <Image source={{ uri: message.sender.person.photo_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {(message.sender?.display_name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )
      )}

      <Wrap {...wrapProps} style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther, isFailed && styles.bubbleFailed]}>
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
                <TouchableOpacity key={i} onPress={() => onImageTap(a.url)} activeOpacity={0.85}>
                  <Image
                    source={{ uri: a.url }}
                    style={styles.imageAttachment}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity key={i} onPress={() => onFileTap(a.url)} activeOpacity={0.65}>
                  <Text style={[styles.attachmentLabel, isMe ? styles.textMe : styles.textOther]}>
                    📎 {a.name || a.url.split('/').pop()}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        )}
        <View style={styles.meta}>
          <Text style={[styles.time, isMe ? styles.timeMe : styles.timeOther]}>{time}</Text>
          {message._status === 'sending' && (
            <Text style={[styles.status, isMe ? styles.timeMe : styles.timeOther]}> · odesílá se…</Text>
          )}
          {isFailed && (
            <Text style={[styles.status, { color: colors.danger }]}> · ! tap pro retry</Text>
          )}
        </View>
      </Wrap>
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
  olderLoader: { paddingVertical: spacing.md, alignItems: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },

  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: spacing.xs,
    backgroundColor: colors.surface2,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.text, fontSize: 12, fontWeight: '700' },

  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMe: { backgroundColor: colors.accent, borderBottomRightRadius: 4, marginLeft: 'auto' },
  bubbleOther: { backgroundColor: colors.surface2, borderBottomLeftRadius: 4 },
  bubbleFailed: { opacity: 0.7, borderWidth: 1, borderColor: colors.danger },

  senderName: { color: colors.accent2, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  text: { fontSize: 15, lineHeight: 20 },
  textMe: { color: '#0b1220' },
  textOther: { color: colors.text },

  attachments: { marginTop: spacing.xs },
  attachmentLabel: { fontSize: 13, marginTop: 2 },

  imageAttachment: {
    width: 220,
    height: 220,
    borderRadius: radius.md,
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
  },

  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 2, justifyContent: 'flex-end' },
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

  attachBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  attachIcon: { fontSize: 20 },

  // Fullscreen image modal
  fullscreenBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  fullscreenClose: {
    position: 'absolute',
    top: 48,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenCloseText: { color: '#fff', fontSize: 22, fontWeight: '700' },
});
