// =============================================================================
// NotificationsHistory — historie notifikací (zvonek)
// =============================================================================
// Nahoře nejnovější, dole nejstarší. Notifikace kliknutím NEMIZÍ — jen se
// označí jako přečtená (zešedne). Pull-to-refresh obnoví seznam.

import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { loadAuth } from '../lib/auth';
import { api, API_BASE, AppNotification } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Dnes ${time}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `Včera ${time}`;
  return `${d.toLocaleDateString('cs-CZ')} ${time}`;
}

// Emoji podle typu notifikace — rychlá vizuální orientace v historii.
function typeIcon(type: string | null): string {
  const t = String(type || '');
  if (t.indexOf('chat') === 0) return '💬';
  if (t.indexOf('contract') !== -1 || t.indexOf('compounder_contract') !== -1) return '📄';
  if (t.indexOf('reserv') !== -1) return '📋';
  if (t.indexOf('compounder') === 0) return '🌐';
  if (t.indexOf('task') !== -1) return '✅';
  return '🔔';
}

export default function NotificationsHistory() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AppNotification | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await loadAuth();
      if (!auth.jwt) throw new Error('Chybí přihlášení.');
      const rows = await api.notifications(auth.jwt, 100);
      // API vrací nejnovější první — přesně jak chceme (nahoře nejmladší).
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setError(e?.message || 'Notifikace se nepodařilo načíst.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Obnov při každém návratu na záložku.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function markRead(item: AppNotification) {
    if (item.read_at) return; // už přečtená — nic
    // Optimisticky přebarvi hned, ať UI nečeká na server.
    setItems((prev) =>
      prev.map((x) => (x.id === item.id ? { ...x, read_at: new Date().toISOString() } : x))
    );
    try {
      const auth = await loadAuth();
      if (auth.jwt) await api.markNotificationRead(auth.jwt, item.id);
    } catch {
      // Tichý fail — při příštím načtení se stav srovná podle serveru.
    }
  }

  // Klik na notifikaci → otevři detail (plný text) a zároveň označ jako přečtenou.
  function openDetail(item: AppNotification) {
    setSelected(item);
    markRead(item);
  }

  function openLink(link: string) {
    const url = /^https?:\/\//i.test(link) ? link : `${API_BASE}${link.startsWith('/') ? '' : '/'}${link}`;
    Linking.openURL(url).catch(() => {});
  }

  async function markAll() {
    setItems((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })));
    try {
      const auth = await loadAuth();
      if (auth.jwt) await api.markAllNotificationsRead(auth.jwt);
    } catch {
      // Tichý fail.
    }
  }

  const unread = items.filter((x) => !x.read_at).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifikace</Text>
        {unread > 0 && (
          <TouchableOpacity onPress={markAll} style={styles.readAllBtn}>
            <Text style={styles.readAllText}>Přečíst vše ({unread})</Text>
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Zkusit znovu</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => String(x.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.center}>
                <Text style={styles.emptyText}>Zatím žádné notifikace.</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const isUnread = !item.read_at;
            return (
              <TouchableOpacity
                style={[styles.card, isUnread && styles.cardUnread]}
                activeOpacity={0.7}
                onPress={() => openDetail(item)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.icon}>{typeIcon(item.type)}</Text>
                  <Text style={[styles.cardTitle, !isUnread && styles.readText]} numberOfLines={2}>
                    {item.title || 'Notifikace'}
                  </Text>
                  {isUnread && <View style={styles.dot} />}
                </View>
                {!!item.body && (
                  <Text style={[styles.cardBody, !isUnread && styles.readText]} numberOfLines={4}>
                    {item.body}
                  </Text>
                )}
                <Text style={styles.when}>{fmtWhen(item.created_at)}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalIcon}>{typeIcon(selected?.type ?? null)}</Text>
              <Text style={styles.modalTitle}>{selected?.title || 'Notifikace'}</Text>
            </View>
            <Text style={styles.modalWhen}>{selected ? fmtWhen(selected.created_at) : ''}</Text>
            <ScrollView
              style={styles.modalBodyScroll}
              contentContainerStyle={{ paddingBottom: spacing.md }}
            >
              <Text style={styles.modalBody}>{selected?.body || 'Bez podrobností.'}</Text>
            </ScrollView>
            {!!selected?.link && (
              <TouchableOpacity
                style={styles.modalLinkBtn}
                onPress={() => selected?.link && openLink(selected.link)}
              >
                <Text style={styles.modalLinkText}>Otevřít v prohlížeči</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setSelected(null)}>
              <Text style={styles.modalCloseText}>Zavřít</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  readAllBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  readAllText: { color: colors.accent2, fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: spacing.xl, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardUnread: {
    borderColor: colors.accent,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontSize: 16 },
  cardTitle: { color: colors.text, fontSize: 14.5, fontWeight: '700', flex: 1 },
  cardBody: { color: colors.text2, fontSize: 13, marginTop: 4, lineHeight: 18 },
  readText: { opacity: 0.75 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  when: { color: colors.text2, fontSize: 11, marginTop: 8 },
  center: { alignItems: 'center', paddingTop: 60, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.text2, fontSize: 14 },
  errorText: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  retryText: { color: colors.accent2, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  modalIcon: { fontSize: 20, marginTop: 1 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '700', flex: 1, lineHeight: 22 },
  modalWhen: { color: colors.text2, fontSize: 12, marginTop: 6, marginBottom: spacing.md },
  modalBodyScroll: { flexGrow: 0 },
  modalBody: { color: colors.text, fontSize: 15, lineHeight: 22 },
  modalLinkBtn: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  modalLinkText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  modalCloseBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  modalCloseText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
