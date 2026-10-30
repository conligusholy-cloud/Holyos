// =============================================================================
// Meetings — administrace kalendáře schůzek (jen Tomáš a Jan Holý)
// =============================================================================
// Stejná data jako BS2 admin → Schůzky a HolyOS → Prodejní objednávky → Termíny.
// Týdenní přehled po dnech, souhrn, detail termínu (úprava, vypnutí, smazání,
// rezervace se stavy + zavolat / napsat) a hromadné vypsání termínů.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, MeetingSlot, MeetingReservation } from '../lib/api';
import { loadAuth } from '../lib/auth';

const BS = {
  bg: '#04060c', card: 'rgba(14,22,40,0.85)', border: 'rgba(120,160,255,0.16)', border2: 'rgba(120,160,255,0.32)',
  text: '#eaf2ff', text2: '#8ea2c2', text3: '#58698a', accent: '#1e86e0', accent2: '#4fd1ff', vio: '#7c5cff',
  ok: '#2fe3a0', err: '#ff7a86',
};
const DN = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const MON = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const MODE: Record<string, string> = { online: '💻 online', osobne: '👤 osobně' };
const PATH: Record<string, string> = { vlastni: '💰 vlastní kapitál', financovani: '🏦 financování' };
const ST: Record<string, string> = { booked: 'rezervováno', done: 'proběhla', canceled: 'zrušeno', no_show: 'nedorazil' };
const ST_COLOR: Record<string, string> = { booked: BS.accent2, done: BS.ok, canceled: BS.err, no_show: BS.err };

const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekStart = (off: number) => { const m = sod(new Date()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7) + 7 * off); return m; };
const p2 = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => d.getHours() + ':' + p2(d.getMinutes());
const ymd = (d: Date) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const dlong = (d: Date) => DN[d.getDay()] + ' ' + d.getDate() + '. ' + MON[d.getMonth()];
// WhatsApp: číslo v mezinárodním tvaru bez + (9 číslic = ČR → 420…)
const waNumber = (phone: string) => { let d = String(phone || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.length === 9) d = '420' + d; return d; };
// „dnes v 16:00“ / „zítra v 10:30“ / „v pondělí 20. 10. v 9:00“
const whenText = (d: Date) => {
  const diff = Math.round((+sod(d) - +sod(new Date())) / 86400000);
  const DNF = ['v neděli', 'v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu'];
  return (diff === 0 ? 'dnes' : diff === 1 ? 'zítra' : DNF[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.') + ' v ' + hm(d);
};
const confirmText = (d: Date, mode?: string | null) => 'Dobrý den, ' + whenText(d) + (mode === 'osobne' ? ' máme domluvenou osobní schůzku' : ' bychom si měli volat videohovor') + ' ohledně Prádlomatu. Mohu s Vámi počítat? 😊🤝';
const openWhatsApp = async (phone: string, text?: string) => {
  const n = waNumber(phone); if (!n) return;
  const q = text ? '&text=' + encodeURIComponent(text) : '';
  const app = 'whatsapp://send?phone=' + n + q;
  try { if (await Linking.canOpenURL(app)) return Linking.openURL(app); } catch (e) { /* fallback níže */ }
  Linking.openURL('https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : ''));
};
const parseDate = (s: string, t: string): Date | null => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim()); const tm = /^(\d{1,2})[:.](\d{2})$/.exec(t.trim());
  if (!m || !tm) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +tm[1], +tm[2]);
  return isNaN(d.getTime()) ? null : d;
};

type ModeVal = '' | 'online' | 'osobne';
function ModeChips({ value, onChange }: { value: ModeVal; onChange: (v: ModeVal) => void }) {
  const opts: { v: ModeVal; t: string }[] = [{ v: '', t: 'online i osobně' }, { v: 'online', t: 'jen online' }, { v: 'osobne', t: 'jen osobně' }];
  return (
    <View style={s.chipRow}>
      {opts.map((o) => (
        <TouchableOpacity key={o.v} onPress={() => onChange(o.v)} style={[s.chip, value === o.v && s.chipOn]}>
          <Text style={[s.chipTxt, value === o.v && s.chipTxtOn]}>{o.t}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function Meetings() {
  const [week, setWeek] = useState(0);
  const [slots, setSlots] = useState<MeetingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<MeetingSlot | null>(null);
  const [addDay, setAddDay] = useState<Date | null | undefined>(undefined); // undefined = zavřeno, null = bez předvybraného dne

  const mon = useMemo(() => weekStart(week), [week]);
  const sun = useMemo(() => addDays(mon, 7), [mon]);

  const load = useCallback(async (quiet?: boolean) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const auth = await loadAuth();
      if (!auth.jwt) throw new Error('Nejsi přihlášený.');
      const today = sod(new Date());
      const from = new Date(Math.min(mon.getTime(), today.getTime()));
      const to = new Date(Math.max(sun.getTime(), addDays(today, 60).getTime()));
      const r = await api.meetings(auth.jwt, from.toISOString(), to.toISOString());
      setSlots(r.slots || []);
    } catch (e: any) { setError(e?.message || 'Načtení selhalo.'); }
    setLoading(false);
  }, [mon, sun]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };

  const now = new Date();
  const inWeek = slots.filter((x) => { const d = new Date(x.starts_at); return d >= mon && d < sun; });
  const upcoming: { s: MeetingSlot; r: MeetingReservation }[] = [];
  slots.forEach((x) => x.reservations.forEach((r) => { if (new Date(x.starts_at) >= sod(now) && r.status === 'booked') upcoming.push({ s: x, r }); }));
  upcoming.sort((a, b) => +new Date(a.s.starts_at) - +new Date(b.s.starts_at));
  const freeCnt = slots.filter((x) => x.active && new Date(x.starts_at) > now && x.booked < x.capacity).length;
  const wkBooked = inWeek.reduce((a, x) => a + x.booked, 0);
  const last = addDays(sun, -1);
  const range = mon.getDate() + '. ' + MON[mon.getMonth()] + ' – ' + last.getDate() + '. ' + MON[last.getMonth()] + ' ' + last.getFullYear();

  const closeAndReload = () => { setDetail(null); setAddDay(undefined); load(true); };

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BS.accent2} />}>
        <View style={s.bar}>
          <TouchableOpacity style={s.navBtn} onPress={() => setWeek(week - 1)}><Text style={s.navTxt}>←</Text></TouchableOpacity>
          <Text style={s.range}>{range}</Text>
          <TouchableOpacity style={s.navBtn} onPress={() => setWeek(week + 1)}><Text style={s.navTxt}>→</Text></TouchableOpacity>
          <TouchableOpacity style={s.navBtn} onPress={() => setWeek(0)}><Text style={s.navTxt}>Dnes</Text></TouchableOpacity>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => setAddDay(null)} activeOpacity={0.8}>
          <Text style={s.addBtnTxt}>＋ Přidat termíny</Text>
        </TouchableOpacity>

        <View style={s.sumRow}>
          <View style={s.sum}><Text style={s.sumN}>{wkBooked}</Text><Text style={s.sumL}>rezervací v týdnu</Text></View>
          <View style={s.sum}><Text style={s.sumN}>{upcoming.length}</Text><Text style={s.sumL}>nadcházejících</Text></View>
          <View style={s.sum}><Text style={s.sumN}>{freeCnt}</Text><Text style={s.sumL}>volných (60 dní)</Text></View>
        </View>

        {error ? <Text style={s.err}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={BS.accent2} style={{ marginTop: 30 }} /> : (
          <>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const d = addDays(mon, i);
              const list = inWeek.filter((x) => new Date(x.starts_at).toDateString() === d.toDateString());
              const isToday = d.toDateString() === now.toDateString();
              return (
                <View key={i} style={[s.day, isToday && s.dayToday, d < sod(now) && { opacity: 0.6 }]}>
                  <View style={s.dayHead}>
                    <Text style={s.dayTitle}>{DN[d.getDay()]} <Text style={s.dayNum}>{d.getDate()}. {d.getMonth() + 1}.</Text>{isToday ? '  · dnes' : ''}</Text>
                    <TouchableOpacity style={s.plus} onPress={() => setAddDay(d)}><Text style={s.plusTxt}>+</Text></TouchableOpacity>
                  </View>
                  {list.length === 0 ? <Text style={s.empty}>—</Text> : list.map((x) => {
                    const full = x.booked >= x.capacity;
                    const who = x.reservations.filter((r) => r.status === 'booked').map((r) => (r.lead && r.lead.name) || r.name || r.phone || r.email || 'zájemce');
                    return (
                      <TouchableOpacity key={x.id} activeOpacity={0.7} onPress={() => setDetail(x)}
                        style={[s.slot, !x.active ? s.slotOff : full ? s.slotFull : s.slotFree]}>
                        <View style={s.slotTop}>
                          <Text style={s.slotT}>{hm(new Date(x.starts_at))}</Text>
                          <Text style={s.slotW}> · {x.duration_min} min{x.mode ? ' · ' + (MODE[x.mode] || x.mode) : ''}</Text>
                          <Text style={[s.slotOcc, { color: !x.active ? BS.text3 : full ? BS.ok : BS.accent2 }]}>{x.active ? x.booked + '/' + x.capacity : 'vypnuto'}</Text>
                        </View>
                        {who.map((w, k) => <Text key={k} style={s.who} numberOfLines={1}>{w}</Text>)}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}

            <Text style={s.h2}>Nadcházející schůzky</Text>
            {upcoming.length === 0 ? <Text style={s.empty}>Žádné rezervace.</Text> : upcoming.slice(0, 40).map(({ s: sl, r }) => {
              const d = new Date(sl.starts_at); const L = r.lead;
              return (
                <TouchableOpacity key={r.id} style={s.upRow} activeOpacity={0.7} onPress={() => setDetail(sl)}>
                  <Text style={s.upWhen}>{dlong(d)} · {hm(d)}</Text>
                  <Text style={s.upName}>{(L && L.name) || r.name || 'Zájemce'}{L && L.city ? ' · ' + L.city : ''}</Text>
                  <Text style={s.upSub}>{[r.mode && MODE[r.mode], r.financing_path && PATH[r.financing_path], r.phone || (L && L.phone)].filter(Boolean).join(' · ')}</Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>

      {detail ? <SlotModal slot={detail} onClose={() => setDetail(null)} onChanged={closeAndReload} /> : null}
      {addDay !== undefined ? <AddModal day={addDay} onClose={() => setAddDay(undefined)} onChanged={closeAndReload} /> : null}
    </SafeAreaView>
  );
}

// ── Detail termínu ───────────────────────────────────────────────────────────
function SlotModal({ slot, onClose, onChanged }: { slot: MeetingSlot; onClose: () => void; onChanged: () => void }) {
  const d0 = new Date(slot.starts_at);
  const [date, setDate] = useState(ymd(d0));
  const [time, setTime] = useState(p2(d0.getHours()) + ':' + p2(d0.getMinutes()));
  const [dur, setDur] = useState(String(slot.duration_min));
  const [cap, setCap] = useState(String(slot.capacity));
  const [mode, setMode] = useState<ModeVal>((slot.mode as ModeVal) || '');
  const [note, setNote] = useState(slot.note || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (fn: (jwt: string) => Promise<any>) => {
    setBusy(true); setMsg('');
    try { const auth = await loadAuth(); if (!auth.jwt) throw new Error('Nejsi přihlášený.'); const r = await fn(auth.jwt); setBusy(false); return r; }
    catch (e: any) { setMsg(e?.message || 'Chyba'); setBusy(false); return null; }
  };
  const save = async () => {
    const nd = parseDate(date, time); if (!nd) { setMsg('Neplatné datum (RRRR-MM-DD) nebo čas (HH:MM).'); return; }
    const r = await run((jwt) => api.meetingSlotUpdate(jwt, slot.id, { starts_at: nd.toISOString(), duration_min: +dur || 17, capacity: +cap || 1, mode: mode || null, note }));
    if (r) onChanged();
  };
  const toggle = async () => { const r = await run((jwt) => api.meetingSlotUpdate(jwt, slot.id, { active: !slot.active })); if (r) onChanged(); };
  const del = () => Alert.alert('Smazat termín?', 'Termín s historií rezervací se jen vypne.', [
    { text: 'Zrušit', style: 'cancel' },
    { text: 'Smazat', style: 'destructive', onPress: async () => { const r = await run((jwt) => api.meetingSlotDelete(jwt, slot.id)); if (r) { if (r.deactivated) Alert.alert('Termín měl historii rezervací – byl jen vypnut.'); onChanged(); } } },
  ]);
  const setRes = (r: MeetingReservation, status: string) => {
    const go = async () => { const x = await run((jwt) => api.meetingReservationSet(jwt, r.id, { status })); if (x) onChanged(); };
    if (status === 'canceled') Alert.alert('Zrušit rezervaci?', 'Zájemce se o tom automaticky nedozví – dejte mu vědět.', [{ text: 'Zpět', style: 'cancel' }, { text: 'Zrušit rezervaci', style: 'destructive', onPress: go }]);
    else go();
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.ov}>
        <View style={s.md}>
          <View style={s.mdHead}><Text style={s.mdTitle}>{dlong(d0)} · {hm(d0)}</Text><TouchableOpacity onPress={onClose}><Text style={s.x}>×</Text></TouchableOpacity></View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={s.row2}>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Datum</Text><TextInput style={s.inp} value={date} onChangeText={setDate} placeholder="2026-10-20" placeholderTextColor={BS.text3} autoCapitalize="none" /></View>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Čas</Text><TextInput style={s.inp} value={time} onChangeText={setTime} placeholder="10:00" placeholderTextColor={BS.text3} autoCapitalize="none" /></View>
            </View>
            <View style={s.row2}>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Délka (min)</Text><TextInput style={s.inp} value={dur} onChangeText={setDur} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Kapacita</Text><TextInput style={s.inp} value={cap} onChangeText={setCap} keyboardType="number-pad" /></View>
            </View>
            <Text style={s.lbl}>Forma</Text>
            <ModeChips value={mode} onChange={setMode} />
            <Text style={s.lbl}>Poznámka (interní)</Text>
            <TextInput style={s.inp} value={note} onChangeText={setNote} placeholder="např. Tomáš, výroba Vrtačka" placeholderTextColor={BS.text3} />
            <View style={s.actRow}>
              <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={save}><Text style={s.btnTxt}>Uložit</Text></TouchableOpacity>
              <TouchableOpacity style={[s.btn2, busy && { opacity: 0.6 }]} disabled={busy} onPress={toggle}><Text style={s.btn2Txt}>{slot.active ? 'Vypnout' : 'Zapnout'}</Text></TouchableOpacity>
              <TouchableOpacity style={[s.btn2, busy && { opacity: 0.6 }]} disabled={busy} onPress={del}><Text style={[s.btn2Txt, { color: BS.err }]}>Smazat</Text></TouchableOpacity>
            </View>
            {msg ? <Text style={s.err}>{msg}</Text> : null}

            <Text style={s.h2}>Rezervace</Text>
            {slot.reservations.length === 0 ? <Text style={s.empty}>Zatím nikdo.</Text> : slot.reservations.map((r) => {
              const L = r.lead; const phone = r.phone || (L && L.phone) || ''; const email = r.email || (L && L.email) || '';
              return (
                <View key={r.id} style={s.res}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={s.resName}>{(L && L.name) || r.name || 'Zájemce'}</Text>
                    <Text style={[s.pill, { color: ST_COLOR[r.status] || BS.text2, borderColor: (ST_COLOR[r.status] || BS.text2) + '88' }]}>{ST[r.status] || r.status}</Text>
                  </View>
                  <Text style={s.resSub}>{[phone, email, L && L.city].filter(Boolean).join(' · ')}</Text>
                  <Text style={s.resSub}>{[r.mode && MODE[r.mode], r.financing_path && PATH[r.financing_path], r.compounder_lead_id ? 'lead #' + r.compounder_lead_id : ''].filter(Boolean).join(' · ')}</Text>
                  {r.note ? <Text style={s.resSub}>{r.note}</Text> : null}
                  <ResNote r={r} run={run} onChanged={onChanged} />
                  <LeasingBox r={r} run={run} />
                  {phone ? (
                    <View style={s.actRow}>
                      <TouchableOpacity style={[s.btn, { backgroundColor: '#25D366' }]} onPress={() => openWhatsApp(phone, confirmText(d0, r.mode || slot.mode))}><Text style={[s.btnTxt, { color: '#0a2e17' }]}>💬 Potvrdit na WhatsApp</Text></TouchableOpacity>
                      <TouchableOpacity style={[s.btn2, { borderColor: '#25D366' }]} onPress={() => Alert.alert('Videohovor přes WhatsApp', 'Otevře se chat s ' + phone + '. Videohovor spustíš ikonou kamery 📹 vpravo nahoře.', [{ text: 'Zpět', style: 'cancel' }, { text: 'Otevřít WhatsApp', onPress: () => openWhatsApp(phone) }])}><Text style={[s.btn2Txt, { color: '#25D366' }]}>📹 Videohovor WhatsApp</Text></TouchableOpacity>
                    </View>
                  ) : null}
                  <View style={s.actRow}>
                    {phone ? <TouchableOpacity style={s.btn2} onPress={() => Linking.openURL('tel:' + phone.replace(/\s+/g, ''))}><Text style={s.btn2Txt}>📞 Zavolat</Text></TouchableOpacity> : null}
                    {email ? <TouchableOpacity style={s.btn2} onPress={() => Linking.openURL('mailto:' + email)}><Text style={s.btn2Txt}>✉️ Napsat</Text></TouchableOpacity> : null}
                    {r.status !== 'done' ? <TouchableOpacity style={s.btn} onPress={() => setRes(r, 'done')}><Text style={s.btnTxt}>✓ Proběhla</Text></TouchableOpacity> : null}
                    {r.status !== 'no_show' ? <TouchableOpacity style={s.btn2} onPress={() => setRes(r, 'no_show')}><Text style={s.btn2Txt}>Nedorazil</Text></TouchableOpacity> : null}
                    {r.status !== 'canceled' ? <TouchableOpacity style={s.btn2} onPress={() => setRes(r, 'canceled')}><Text style={[s.btn2Txt, { color: BS.err }]}>Zrušit</Text></TouchableOpacity> : null}
                    {r.status !== 'booked' ? <TouchableOpacity style={s.btn2} onPress={() => setRes(r, 'booked')}><Text style={s.btn2Txt}>Vrátit na rezervováno</Text></TouchableOpacity> : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Hromadné přidání termínů ────────────────────────────────────────────────
function AddModal({ day, onClose, onChanged }: { day: Date | null; onClose: () => void; onChanged: () => void }) {
  const d0 = day ? day : sod(new Date());
  const d1 = day ? day : addDays(d0, 13);
  const [from, setFrom] = useState(ymd(d0));
  const [to, setTo] = useState(ymd(d1));
  const [dows, setDows] = useState<number[]>(day ? [day.getDay()] : [1, 2, 3, 4, 5]);
  const [times, setTimes] = useState('9:00, 9:30, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 13:00, 13:30, 14:00, 14:30, 15:00, 15:30, 16:00, 16:30, 17:00, 17:30, 18:00, 18:30, 19:00');
  const [dur, setDur] = useState('17');
  const [cap, setCap] = useState('1');
  const [mode, setMode] = useState<ModeVal>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const toggleDow = (n: number) => setDows((a) => (a.includes(n) ? a.filter((x) => x !== n) : [...a, n]));
  const go = async () => {
    const f = parseDate(from, '0:00'), t = parseDate(to, '0:00');
    if (!f || !t || t < f) { setMsg('Zkontroluj rozsah dat (RRRR-MM-DD).'); return; }
    const ts = times.split(/[,;\s]+/).map((x) => { const m = /^(\d{1,2})[:.](\d{2})$/.exec(x.trim()); return m ? [+m[1], +m[2]] : null; }).filter(Boolean) as number[][];
    if (!dows.length || !ts.length) { setMsg('Vyber aspoň jeden den a zadej čas ve tvaru 9:00.'); return; }
    const out: any[] = []; const now = new Date();
    for (let d = new Date(f); d <= t; d.setDate(d.getDate() + 1)) {
      if (!dows.includes(d.getDay())) continue;
      ts.forEach((x) => { const st = new Date(d.getFullYear(), d.getMonth(), d.getDate(), x[0], x[1]); if (st > now) out.push({ starts_at: st.toISOString(), duration_min: +dur || 17, capacity: +cap || 1, mode: mode || null, note: note || null }); });
    }
    if (!out.length) { setMsg('Nevznikl žádný budoucí termín.'); return; }
    const doIt = async () => {
      setBusy(true); setMsg('Ukládám ' + out.length + ' termínů…');
      try { const auth = await loadAuth(); if (!auth.jwt) throw new Error('Nejsi přihlášený.'); await api.meetingsCreate(auth.jwt, out); onChanged(); }
      catch (e: any) { setMsg(e?.message || 'Chyba'); setBusy(false); }
    };
    if (out.length > 200) Alert.alert('Vytvořit ' + out.length + ' termínů?', '', [{ text: 'Zrušit', style: 'cancel' }, { text: 'Vytvořit', onPress: doIt }]);
    else doIt();
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.ov}>
        <View style={s.md}>
          <View style={s.mdHead}><Text style={s.mdTitle}>Přidat termíny</Text><TouchableOpacity onPress={onClose}><Text style={s.x}>×</Text></TouchableOpacity></View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={s.row2}>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Od</Text><TextInput style={s.inp} value={from} onChangeText={setFrom} autoCapitalize="none" /></View>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Do</Text><TextInput style={s.inp} value={to} onChangeText={setTo} autoCapitalize="none" /></View>
            </View>
            <Text style={s.lbl}>Dny v týdnu</Text>
            <View style={s.chipRow}>
              {[1, 2, 3, 4, 5, 6, 0].map((n) => (
                <TouchableOpacity key={n} onPress={() => toggleDow(n)} style={[s.chip, dows.includes(n) && s.chipOn]}>
                  <Text style={[s.chipTxt, dows.includes(n) && s.chipTxtOn]}>{DN[n]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.lbl}>Časy (oddělené čárkou)</Text>
            <TextInput style={s.inp} value={times} onChangeText={setTimes} autoCapitalize="none" />
            <View style={s.row2}>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Délka (min)</Text><TextInput style={s.inp} value={dur} onChangeText={setDur} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><Text style={s.lbl}>Kapacita</Text><TextInput style={s.inp} value={cap} onChangeText={setCap} keyboardType="number-pad" /></View>
            </View>
            <Text style={s.lbl}>Forma</Text>
            <ModeChips value={mode} onChange={setMode} />
            <Text style={s.lbl}>Poznámka (interní)</Text>
            <TextInput style={s.inp} value={note} onChangeText={setNote} placeholder="např. Tomáš, výroba Vrtačka" placeholderTextColor={BS.text3} />
            <View style={s.actRow}>
              <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={go}><Text style={s.btnTxt}>Vytvořit termíny</Text></TouchableOpacity>
            </View>
            {msg ? <Text style={[s.err, { color: BS.text2 }]}>{msg}</Text> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}


// Interní poznámka k rezervaci — píše se nebo diktuje mikrofonem na klávesnici telefonu
function ResNote({ r, run, onChanged }: { r: MeetingReservation; run: (fn: (jwt: string) => Promise<any>) => Promise<any>; onChanged: () => void }) {
  const [txt, setTxt] = useState(r.internal_note || '');
  const [saved, setSaved] = useState(r.internal_note || '');
  const [busy, setBusy] = useState(false);
  const dirty = txt !== saved;
  const save = async () => {
    setBusy(true);
    const x = await run((jwt) => api.meetingReservationSet(jwt, r.id, { internal_note: txt.trim() || null }));
    setBusy(false);
    if (x) { setSaved(txt); onChanged(); }
  };
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={s.lbl}>Moje poznámka ke schůzce (🎤 diktuj mikrofonem na klávesnici)</Text>
      <TextInput
        style={[s.inp, { minHeight: 80, textAlignVertical: 'top' }]}
        value={txt} onChangeText={setTxt} multiline
        placeholder="Co jste probírali, na čem jste se domluvili…" placeholderTextColor={BS.text3}
        autoCapitalize="sentences"
      />
      {dirty ? (
        <TouchableOpacity style={[s.btn, { marginTop: 6, alignSelf: 'flex-start' }]} onPress={save} disabled={busy}>
          <Text style={s.btnTxt}>{busy ? 'Ukládám…' : '💾 Uložit poznámku'}</Text>
        </TouchableOpacity>
      ) : saved ? <Text style={[s.resSub, { marginTop: 4 }]}>✓ uloženo</Text> : null}
    </View>
  );
}


// Poptávka financování: stejná funkce jako „Poslat kontakt leasingové společnosti“ v HolyOS (e-mail + SMS leasingovce s odkazem pro odpověď)
const LEAS_ST: Record<string, [string, string]> = { sent: ['📤 Odesláno', '#94a3b8'], opened: ['👀 Otevřeno', '#60a5fa'], in_progress: ['⏳ Zpracovává se', '#f59e0b'], approved: ['✅ Schváleno', '#22c55e'], rejected: ['❌ Zamítnuto', '#ef4444'], canceled: ['Zrušeno', '#6b7280'] };
function LeasingBox({ r, run }: { r: MeetingReservation; run: (fn: (jwt: string) => Promise<any>) => Promise<any> }) {
  const L = r.lead; const fullName = ((L && L.name) || r.name || '').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  const [open, setOpen] = useState(false);
  const [fn, setFn] = useState(parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '');
  const [ln, setLn] = useState(parts.length > 1 ? parts[parts.length - 1] : '');
  const [phone, setPhone] = useState(r.phone || (L && L.phone) || '');
  const [email, setEmail] = useState(r.email || (L && L.email) || '');
  const [company, setCompany] = useState('');
  const [ico, setIco] = useState('');
  const [subject, setSubject] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [cos, setCos] = useState<{ id: number; name: string; contact_name: string | null; email: string | null; phone: string | null }[] | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [cosErr, setCosErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<any[]>([]);
  const loadHist = useCallback(async () => { const x = await run((jwt) => api.meetingLeasingList(jwt, r.id)); if (Array.isArray(x)) setHist(x); }, [r.id]);
  useEffect(() => { loadHist(); }, [loadHist]);
  const openForm = async () => {
    setOpen(true);
    if (!cos) { const x = await run((jwt) => api.meetingLeasingCompanies(jwt)); if (Array.isArray(x)) { setCos(x); setCosErr(false); } else { setCosErr(true); } }
  };
  const send = async () => {
    const pr = Number(String(price).replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
    if (!fn.trim() || !ln.trim()) return Alert.alert('Doplň jméno a příjmení klienta');
    if (!subject.trim()) return Alert.alert('Napiš, co se bude financovat');
    if (!pr) return Alert.alert('Zadej cenu bez DPH');
    if (!sel.length) return Alert.alert('Vyber alespoň jednu leasingovou společnost');
    setBusy(true);
    const x = await run((jwt) => api.meetingLeasingSend(jwt, r.id, { company_ids: sel, client_first_name: fn.trim(), client_last_name: ln.trim(), client_company: company.trim() || null, client_ico: ico.trim() || null, client_email: email.trim() || null, client_phone: phone.trim() || null, subject: subject.trim(), price: pr, note: note.trim() || null }));
    setBusy(false);
    if (x && x.ok) {
      const lines = (x.sent || []).map((s: any) => (s.email_sent || s.sms_sent ? '✅ ' : '⚠️ ') + s.company + ': ' + (s.email_sent ? 'e-mail ✓ ' : '') + (s.sms_sent ? 'SMS ✓' : ''));
      Alert.alert('Poptávka odeslána', lines.join('\n') + '\n\nVýsledek očekáváme do 3 dnů.');
      setOpen(false); setSel([]); loadHist();
    }
  };
  const inp = [s.inp, { marginBottom: 6 }];
  return (
    <View style={{ marginTop: 10 }}>
      {!open ? (
        <TouchableOpacity style={[s.btn, { backgroundColor: '#0f766e' }]} onPress={openForm}><Text style={s.btnTxt}>🏦 Poslat kontakt leasingové společnosti</Text></TouchableOpacity>
      ) : (
        <View style={{ borderWidth: 1, borderColor: 'rgba(20,184,166,0.5)', borderRadius: 12, padding: 10, backgroundColor: 'rgba(20,184,166,0.06)' }}>
          <Text style={s.resName}>🏦 Poptávka financování</Text>
          <Text style={[s.resSub, { marginBottom: 6 }]}>Leasingovka dostane e-mail i SMS s odkazem, kde označí stav. Výsledek čekáme do 3 dnů.</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput style={[...inp, { flex: 1 }]} value={fn} onChangeText={setFn} placeholder="Jméno *" placeholderTextColor={BS.text3} />
            <TextInput style={[...inp, { flex: 1 }]} value={ln} onChangeText={setLn} placeholder="Příjmení *" placeholderTextColor={BS.text3} />
          </View>
          <TextInput style={inp} value={phone} onChangeText={setPhone} placeholder="Telefon" placeholderTextColor={BS.text3} keyboardType="phone-pad" />
          <TextInput style={inp} value={email} onChangeText={setEmail} placeholder="E-mail" placeholderTextColor={BS.text3} keyboardType="email-address" autoCapitalize="none" />
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TextInput style={[...inp, { flex: 2 }]} value={company} onChangeText={setCompany} placeholder="Firma (volitelné)" placeholderTextColor={BS.text3} />
            <TextInput style={[...inp, { flex: 1 }]} value={ico} onChangeText={setIco} placeholder="IČO" placeholderTextColor={BS.text3} keyboardType="number-pad" />
          </View>
          <TextInput style={inp} value={subject} onChangeText={setSubject} placeholder="Co se financuje * (např. Prádlomat MINI SK, 1 ks)" placeholderTextColor={BS.text3} />
          <TextInput style={inp} value={price} onChangeText={setPrice} placeholder="Cena bez DPH (Kč) *" placeholderTextColor={BS.text3} keyboardType="number-pad" />
          <TextInput style={[...inp, { minHeight: 56, textAlignVertical: 'top' }]} value={note} onChangeText={setNote} placeholder="Poznámka pro leasingovku" placeholderTextColor={BS.text3} multiline />
          <Text style={[s.lbl, { marginTop: 4 }]}>Komu poslat? (lze více)</Text>
          {cosErr ? <Text style={[s.empty, { color: BS.err }]}>Nepodařilo se načíst leasingové společnosti (server zatím nemusí být aktualizovaný). Zkus to za chvíli znovu.</Text> : cos === null ? <ActivityIndicator color={BS.accent2} /> : cos.length === 0 ? <Text style={s.empty}>V HolyOS není žádná aktivní leasingová společnost.</Text> : cos.map((c) => {
            const ok = !!(c.email || c.phone); const on = sel.includes(c.id);
            return (
              <TouchableOpacity key={c.id} disabled={!ok} onPress={() => setSel(on ? sel.filter((x) => x !== c.id) : sel.concat(c.id))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 9, marginTop: 5, borderWidth: 1, borderRadius: 10, borderColor: on ? '#14b8a6' : BS.border, opacity: ok ? 1 : 0.45 }}>
                <Text style={{ fontSize: 18 }}>{on ? '☑️' : '⬜'}</Text>
                <View style={{ flex: 1 }}><Text style={s.resName}>{c.name}</Text><Text style={s.resSub}>{(c.contact_name || '—') + ' · ' + (c.email ? '📧 ' : '') + (c.phone ? '📱 ' : '') + (ok ? '' : 'chybí kontakt')}</Text></View>
              </TouchableOpacity>
            );
          })}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={s.btn2} onPress={() => setOpen(false)}><Text style={s.btn2Txt}>Zrušit</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: '#0f766e', opacity: busy ? 0.6 : 1 }]} disabled={busy} onPress={send}><Text style={s.btnTxt}>{busy ? 'Odesílám…' : '📨 Odeslat poptávku'}</Text></TouchableOpacity>
          </View>
        </View>
      )}
      {hist.map((q) => {
        const st = LEAS_ST[q.status] || [q.status, '#94a3b8'];
        return (
          <View key={q.id} style={{ borderWidth: 1, borderColor: st[1] + '55', borderLeftWidth: 3, borderLeftColor: st[1], borderRadius: 10, padding: 8, marginTop: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={s.resName}>🏦 {q.company}</Text><Text style={{ color: st[1], fontWeight: '700', fontSize: 12.5 }}>{st[0]}</Text></View>
            <Text style={s.resSub}>{q.subject} · {Math.round(q.price).toLocaleString('cs-CZ')} Kč · odesláno {new Date(q.sent_at).toLocaleDateString('cs-CZ')}</Text>
            {q.result_note ? <Text style={s.resSub}>{q.result_note}{q.result_monthly ? ' · splátka ' + Math.round(q.result_monthly).toLocaleString('cs-CZ') + ' Kč/měs' : ''}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  scroll: { padding: 14, paddingBottom: 60 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  navBtn: { borderWidth: 1, borderColor: BS.border2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: BS.card },
  navTxt: { color: BS.text, fontWeight: '700' },
  range: { flex: 1, color: BS.text, fontWeight: '800', fontSize: 14, textAlign: 'center' },
  addBtn: { backgroundColor: BS.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  addBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sumRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  sum: { flex: 1, backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 12, padding: 10 },
  sumN: { color: BS.text, fontSize: 22, fontWeight: '800' },
  sumL: { color: BS.text2, fontSize: 11, marginTop: 2 },
  day: { backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 14, marginBottom: 10, padding: 10 },
  dayToday: { borderColor: 'rgba(47,227,160,0.6)' },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  dayTitle: { color: BS.text2, fontWeight: '700', fontSize: 13 },
  dayNum: { color: BS.text, fontSize: 15, fontWeight: '800' },
  plus: { width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: BS.border2, alignItems: 'center', justifyContent: 'center' },
  plusTxt: { color: BS.accent2, fontSize: 18, lineHeight: 20 },
  empty: { color: BS.text3, fontSize: 12.5, textAlign: 'center', paddingVertical: 6 },
  slot: { borderWidth: 1, borderColor: BS.border2, borderRadius: 10, padding: 9, marginTop: 6, backgroundColor: 'rgba(8,13,26,0.6)' },
  slotFree: { borderLeftWidth: 3, borderLeftColor: BS.accent2 },
  slotFull: { borderLeftWidth: 3, borderLeftColor: BS.ok, backgroundColor: 'rgba(47,227,160,0.08)' },
  slotOff: { opacity: 0.5, borderStyle: 'dashed' },
  slotTop: { flexDirection: 'row', alignItems: 'baseline' },
  slotT: { color: BS.text, fontWeight: '800', fontSize: 15 },
  slotW: { color: BS.text2, fontSize: 12, flex: 1 },
  slotOcc: { fontWeight: '800', fontSize: 12.5 },
  who: { color: '#fff', fontWeight: '600', marginTop: 3, fontSize: 13 },
  h2: { color: BS.text, fontSize: 16, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  upRow: { backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 12, padding: 11, marginBottom: 8 },
  upWhen: { color: BS.accent2, fontWeight: '800', fontSize: 13 },
  upName: { color: BS.text, fontWeight: '700', fontSize: 15, marginTop: 2 },
  upSub: { color: BS.text2, fontSize: 12.5, marginTop: 2 },
  err: { color: BS.err, marginTop: 10, fontSize: 13 },
  ov: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  md: { backgroundColor: '#0d1426', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: BS.border2, padding: 16, maxHeight: '92%' },
  mdHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  mdTitle: { color: BS.text, fontSize: 18, fontWeight: '800' },
  x: { color: BS.text2, fontSize: 28, paddingHorizontal: 8 },
  lbl: { color: BS.text2, fontSize: 12.5, marginTop: 10, marginBottom: 4 },
  inp: { backgroundColor: 'rgba(8,13,26,0.9)', borderWidth: 1, borderColor: BS.border2, borderRadius: 10, color: BS.text, paddingHorizontal: 11, paddingVertical: 10, fontSize: 16 },
  row2: { flexDirection: 'row', gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: BS.border2, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 },
  chipOn: { backgroundColor: BS.accent, borderColor: BS.accent },
  chipTxt: { color: BS.text2, fontWeight: '700', fontSize: 13 },
  chipTxtOn: { color: '#fff' },
  actRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: { backgroundColor: BS.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
  btn2: { borderWidth: 1, borderColor: BS.border2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  btn2Txt: { color: BS.text, fontWeight: '700', fontSize: 13.5 },
  res: { borderWidth: 1, borderColor: BS.border, borderRadius: 12, padding: 11, marginTop: 8 },
  resName: { color: BS.text, fontWeight: '800', fontSize: 15 },
  resSub: { color: BS.text2, fontSize: 12.5, marginTop: 3 },
  pill: { fontSize: 11.5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
});
