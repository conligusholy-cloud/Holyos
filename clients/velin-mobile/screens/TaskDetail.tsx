// =============================================================================
// TaskDetail — detail jednoho úkolu + chat + stavové přechody
// =============================================================================
// Lifecycle úkolu z UI:
//   proposed     → Přijmout (accept)
//   accepted     → Začít (start)
//   in_progress  → Hotovo (complete) / Blokováno (block — s důvodem)
//   blocked      → Pokračovat (start) / Hotovo (complete)
//   done         → koncový stav, jen čte
//
// Chat: GET /api/velin/tasks/:id vrací messages[]; POST /api/velin/tasks/:id/messages
// přidá novou. Polling není — refresh přes pull-down nebo když pošleš zprávu.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, ApiError } from '../lib/api';
import { loadAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'TaskDetail'>;

type Author = { id: number; first_name?: string; last_name?: string; photo_url?: string };
type Message = {
  id: number;
  author_kind: 'person' | 'ai' | 'system';
  author_person_id: number | null;
  body: string;
  created_at: string;
  author?: Author | null;
};

// Info o dávce z plánovače (Fáze 4 — Krok D). Backend ho posílá jen pokud
// task.source === 'production' a source_ref_type === 'BatchOperation'.
type BatchInfo = {
  batch_operation_id: number;
  op_status: string;
  planned_start: string | null;
  planned_end: string | null;
  operation_name: string | null;
  batch_id: number | null;
  batch_number: string | null;
  batch_quantity: number | null;
  product_name: string | null;
  product_code: string | null;
  workstation_name: string | null;
};

type Task = {
  id: number;
  title: string;
  description: string | null;
  priority: number;
  estimated_min: number | null;
  due_at: string | null;
  status: string;
  location_hint: string | null;
  source: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  actual_min: number | null;
  messages: Message[];
  creator_person: Author | null;
  feedback?: { id: number; self_rating: number | null } | null;
};

export default function TaskDetail({ route, navigation }: Props) {
  const { taskId } = route.params;
  const [task, setTask] = useState<Task | null>(null);
  const [batchInfo, setBatchInfo] = useState<BatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [meId, setMeId] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const reload = useCallback(async () => {
    setError(null);
    const auth = await loadAuth();
    setMeId(auth.personId);
    if (!auth.jwt) {
      setError('Nepřihlášen.');
      setLoading(false);
      return;
    }
    try {
      const res = await api.getTask(auth.jwt, taskId);
      setTask(res.task as Task);
      setBatchInfo((res as any).batchInfo || null);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Nepodařilo se načíst úkol.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [taskId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function doAction(name: 'accept' | 'start' | 'complete' | 'block', extra?: any) {
    const auth = await loadAuth();
    if (!auth.jwt) return;
    setActing(true);
    try {
      if (name === 'accept')   await api.acceptTask(auth.jwt, taskId);
      if (name === 'start')    await api.startTask(auth.jwt, taskId);
      if (name === 'complete') await api.completeTask(auth.jwt, taskId, extra?.actual_min);
      if (name === 'block')    await api.blockTask(auth.jwt, taskId, extra?.reason || 'bez důvodu');
      await reload();
    } catch (err) {
      if (err instanceof ApiError) Alert.alert('Chyba', err.message);
      else Alert.alert('Chyba', 'Akci se nepodařilo provést.');
    } finally {
      setActing(false);
    }
  }

  function onBlockPress() {
    Alert.prompt(
      'Co tě blokuje?',
      'Krátký popis blokátoru — vedoucí to uvidí v admin přehledu.',
      [
        { text: 'Zrušit', style: 'cancel' },
        { text: 'Označit jako blokované', onPress: (reason) => doAction('block', { reason: reason || '' }) },
      ],
      'plain-text'
    );
  }

  function onCompletePress() {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Hotovo!',
        'Kolik minut ti to reálně zabralo? (volitelné)',
        [
          { text: 'Bez údaje', onPress: () => doAction('complete') },
          { text: 'Uložit', onPress: (text) => {
              const n = parseInt(text || '', 10);
              doAction('complete', { actual_min: Number.isFinite(n) ? n : undefined });
            }
          },
        ],
        'plain-text',
        '',
        'number-pad'
      );
    } else {
      // Android — Alert.prompt nepodporuje, uložíme bez čísla
      Alert.alert('Hotovo!', 'Označit úkol jako hotový?', [
        { text: 'Zrušit', style: 'cancel' },
        { text: 'Hotovo', onPress: () => doAction('complete') },
      ]);
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    const auth = await loadAuth();
    if (!auth.jwt) return;
    setSending(true);
    try {
      await api.sendMessage(auth.jwt, taskId, text);
      setDraft('');
      await reload();
      // Scroll do konce po refreshi
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      if (err instanceof ApiError) Alert.alert('Chyba', err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }
  if (!task) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.errorText}>{error || 'Úkol nenalezen'}</Text>
        <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.linkText}>← Zpět</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Zpět</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detail úkolu</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} tintColor={colors.accent} />}
        >
          <View style={styles.titleRow}>
            <Text style={styles.title}>{task.title}</Text>
            <StatusBadge status={task.status} />
          </View>

          <View style={styles.metaRow}>
            {task.estimated_min ? <Chip text={`⏱ ${task.estimated_min} min`} /> : null}
            {task.due_at ? <Chip text={`📅 ${shortTime(task.due_at)}`} /> : null}
            {task.location_hint ? <Chip text={`📍 ${task.location_hint}`} /> : null}
            {batchInfo ? <Chip text="🏭 Z výroby" highlight /> : <Chip text={`🏷 ${task.source}`} />}
            {task.priority <= 2 ? <Chip text="🔴 priorita" highlight /> : null}
          </View>

          {batchInfo ? (
            <View style={styles.batchCard}>
              <Text style={styles.batchCardTitle}>🏭 Dávka z plánovače</Text>
              {batchInfo.batch_number ? (
                <View style={styles.batchRow}>
                  <Text style={styles.batchLabel}>Dávka</Text>
                  <Text style={styles.batchValue}>{batchInfo.batch_number}</Text>
                </View>
              ) : null}
              {batchInfo.product_name ? (
                <View style={styles.batchRow}>
                  <Text style={styles.batchLabel}>Výrobek</Text>
                  <Text style={styles.batchValue}>
                    {batchInfo.product_name}
                    {batchInfo.batch_quantity ? ` · ${batchInfo.batch_quantity} ks` : ''}
                  </Text>
                </View>
              ) : null}
              {batchInfo.workstation_name ? (
                <View style={styles.batchRow}>
                  <Text style={styles.batchLabel}>Pracoviště</Text>
                  <Text style={styles.batchValue}>{batchInfo.workstation_name}</Text>
                </View>
              ) : null}
              {batchInfo.operation_name ? (
                <View style={styles.batchRow}>
                  <Text style={styles.batchLabel}>Operace</Text>
                  <Text style={styles.batchValue}>{batchInfo.operation_name}</Text>
                </View>
              ) : null}
              {batchInfo.planned_start && batchInfo.planned_end ? (
                <View style={styles.batchRow}>
                  <Text style={styles.batchLabel}>Plán</Text>
                  <Text style={styles.batchValue}>
                    {shortTime(batchInfo.planned_start)} – {shortTime(batchInfo.planned_end)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {task.description ? (
            <View style={styles.descBox}>
              <Text style={styles.descText}>{task.description}</Text>
            </View>
          ) : null}

          {task.blocked_reason && task.status === 'blocked' ? (
            <View style={styles.blockBox}>
              <Text style={styles.blockLabel}>Blokátor</Text>
              <Text style={styles.blockText}>{task.blocked_reason}</Text>
            </View>
          ) : null}

          <ActionBar status={task.status} acting={acting} onAction={(n) => {
            if (n === 'complete') return onCompletePress();
            if (n === 'block')    return onBlockPress();
            return doAction(n);
          }} />

          <Text style={styles.sectionHeader}>💬 Chat ({task.messages.length})</Text>
          {task.messages.length === 0 ? (
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>Žádné zprávy. Napiš první.</Text>
            </View>
          ) : (
            task.messages.map((m) => (
              <Bubble key={m.id} message={m} meId={meId} />
            ))
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Napiš zprávu…"
            placeholderTextColor={colors.text2}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!draft.trim() || sending}
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Odeslat</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ActionBar({ status, acting, onAction }: { status: string; acting: boolean; onAction: (n: 'accept' | 'start' | 'complete' | 'block') => void }) {
  let actions: { label: string; name: 'accept' | 'start' | 'complete' | 'block'; primary?: boolean; danger?: boolean }[] = [];
  if (status === 'proposed') {
    actions = [{ label: '✓ Přijmout', name: 'accept', primary: true }];
  } else if (status === 'accepted') {
    actions = [{ label: '▶ Začít', name: 'start', primary: true }];
  } else if (status === 'in_progress') {
    actions = [
      { label: '✓ Hotovo', name: 'complete', primary: true },
      { label: '⏸ Blokováno', name: 'block', danger: true },
    ];
  } else if (status === 'blocked') {
    actions = [
      { label: '▶ Pokračovat', name: 'start', primary: true },
      { label: '✓ Hotovo', name: 'complete' },
    ];
  } else if (status === 'done') {
    return (
      <View style={[styles.actionBar, { justifyContent: 'center' }]}>
        <Text style={styles.doneNote}>✓ Úkol dokončen</Text>
      </View>
    );
  }
  return (
    <View style={styles.actionBar}>
      {actions.map((a) => (
        <TouchableOpacity
          key={a.name}
          style={[
            styles.actionBtn,
            a.primary && styles.actionBtnPrimary,
            a.danger && styles.actionBtnDanger,
            acting && { opacity: 0.5 },
          ]}
          onPress={() => onAction(a.name)}
          disabled={acting}
        >
          <Text style={[styles.actionText, a.primary && styles.actionTextPrimary]}>{a.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Bubble({ message, meId }: { message: Message; meId: number | null }) {
  const isAi = message.author_kind === 'ai';
  const isSystem = message.author_kind === 'system';
  const isMine = message.author_kind === 'person' && message.author_person_id === meId;
  const authorName = message.author
    ? `${message.author.first_name || ''} ${message.author.last_name || ''}`.trim()
    : (isAi ? 'Hugo' : isSystem ? 'Systém' : '');
  return (
    <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
      <View
        style={[
          styles.bubble,
          isMine ? styles.bubbleMine : isAi ? styles.bubbleAi : isSystem ? styles.bubbleSystem : styles.bubbleOther,
        ]}
      >
        {!isMine ? <Text style={styles.bubbleAuthor}>{authorName}</Text> : null}
        <Text style={[styles.bubbleText, isMine && { color: '#fff' }]}>{message.body}</Text>
        <Text style={[styles.bubbleTime, isMine && { color: 'rgba(255,255,255,0.6)' }]}>{shortTime(message.created_at)}</Text>
      </View>
    </View>
  );
}

function Chip({ text, highlight }: { text: string; highlight?: boolean }) {
  return (
    <View style={[styles.chip, highlight && styles.chipHighlight]}>
      <Text style={[styles.chipText, highlight && styles.chipTextHighlight]}>{text}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    proposed:    { label: 'Navrženo', bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1' },
    accepted:    { label: 'Přijato', bg: 'rgba(14,165,233,0.18)', fg: '#7dd3fc' },
    in_progress: { label: 'Probíhá', bg: 'rgba(245,158,11,0.22)', fg: '#fbbf24' },
    blocked:     { label: 'Blokováno', bg: 'rgba(239,68,68,0.22)', fg: '#fca5a5' },
    done:        { label: 'Hotovo', bg: 'rgba(34,197,94,0.22)', fg: '#86efac' },
  };
  const it = map[status] || map.proposed;
  return (
    <View style={[styles.badge, { backgroundColor: it.bg }]}>
      <Text style={[styles.badgeText, { color: it.fg }]}>{it.label}</Text>
    </View>
  );
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: 80 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: spacing.xs, width: 60 },
  backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  title: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '700' },

  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '600' },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: { backgroundColor: colors.surface2, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm },
  chipHighlight: { backgroundColor: 'rgba(239,68,68,0.18)' },
  chipText: { color: colors.text2, fontSize: 12 },
  chipTextHighlight: { color: '#fca5a5', fontWeight: '600' },

  descBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  batchCard: {
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)',
    marginBottom: spacing.md,
  },
  batchCardTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm },
  batchRow: { flexDirection: 'row', paddingVertical: 3 },
  batchLabel: { color: colors.text2, fontSize: 12, width: 90 },
  batchValue: { color: colors.text, fontSize: 13, flex: 1, fontWeight: '500' },
  descText: { color: colors.text, fontSize: 14, lineHeight: 22 },

  blockBox: { backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', marginBottom: spacing.md },
  blockLabel: { color: '#fca5a5', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  blockText: { color: colors.text, fontSize: 14 },

  actionBar: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  actionBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface2 },
  actionBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionBtnDanger: { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.3)' },
  actionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  actionTextPrimary: { color: '#fff' },
  doneNote: { color: colors.success, fontSize: 14, fontWeight: '600' },

  sectionHeader: { color: colors.text2, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.md },

  emptyChat: { padding: spacing.lg, alignItems: 'center' },
  emptyChatText: { color: colors.text2, fontSize: 13, fontStyle: 'italic' },

  bubbleRow: { marginBottom: spacing.sm, flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: radius.md, padding: spacing.md, borderWidth: 1 },
  bubbleMine: { backgroundColor: colors.accent, borderColor: colors.accent },
  bubbleOther: { backgroundColor: colors.surface, borderColor: colors.border },
  bubbleAi: { backgroundColor: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.3)' },
  bubbleSystem: { backgroundColor: 'rgba(148,163,184,0.10)', borderColor: 'rgba(148,163,184,0.3)' },
  bubbleAuthor: { color: colors.text2, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bubbleTime: { color: colors.text2, fontSize: 10, marginTop: 4, textAlign: 'right' },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 14,
    maxHeight: 120,
  },
  sendBtn: { backgroundColor: colors.accent, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  errorText: { color: colors.danger, fontSize: 14, marginBottom: spacing.md },
  linkBtn: { padding: spacing.md },
  linkText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
