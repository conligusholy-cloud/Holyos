// =============================================================================
// GameAdminWeb — administrace hry Laundromat Tycoon uvnitř Velína
// =============================================================================
// Načte /modules/milionar/index.html a předá přihlášení (cookie `token` = HolyOS
// JWT), takže se nemusíš znovu přihlašovat. Adresa jde s ?embed=1&mobil=1:
// embed schová postranní menu, mobil stáhne odsazení na šířku telefonu.
// Vidí to jen Tomáš a Jan Holý — server u /api/game-admin hlídá oprávnění sám.

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { apiBase } from '../lib/api';
import { loadAuth } from '../lib/auth';

const BS = { bg: '#04060c', text: '#eaf2ff', text2: '#8ea2c2', accent2: '#4fd1ff' };
const STRANKA = '/modules/milionar/index.html?embed=1&mobil=1';

export default function GameAdminWeb() {
  const [jwt, setJwt] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const ref = useRef<WebView>(null);

  useEffect(() => {
    (async () => {
      try { const a = await loadAuth(); if (!a.jwt) throw new Error('Nejsi přihlášený.'); setJwt(a.jwt); }
      catch (e: any) { setErr(e?.message || 'Nelze načíst přihlášení.'); }
    })();
  }, []);

  if (err) return <SafeAreaView style={s.root}><Text style={s.err}>{err}</Text></SafeAreaView>;
  if (!jwt) return <SafeAreaView style={s.root}><ActivityIndicator color={BS.accent2} style={{ marginTop: 40 }} /></SafeAreaView>;

  // cookie ještě před načtením stránky (stránka čte přihlášení z cookie `token`)
  const inject = `try{document.cookie='token=${jwt}; path=/; max-age=2592000; Secure; SameSite=Lax';}catch(e){} true;`;
  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <View style={s.bar}>
        <TouchableOpacity onPress={() => ref.current?.goBack()} style={s.btn}><Text style={s.btnTxt}>←</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => ref.current?.reload()} style={s.btn}><Text style={s.btnTxt}>↻ Obnovit</Text></TouchableOpacity>
        <Text style={s.hint}>Tabulky posuneš do stran prstem</Text>
      </View>
      <WebView
        ref={ref}
        source={{ uri: apiBase.replace(/\/$/, '') + STRANKA }}
        injectedJavaScriptBeforeContentLoaded={inject}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        scalesPageToFit
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        allowsBackForwardNavigationGestures
        startInLoadingState
        renderLoading={() => <ActivityIndicator color={BS.accent2} style={StyleSheet.absoluteFill} />}
        style={{ flex: 1, backgroundColor: BS.bg }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(120,160,255,0.16)' },
  btn: { borderWidth: 1, borderColor: 'rgba(120,160,255,0.32)', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 6 },
  btnTxt: { color: BS.text, fontWeight: '700', fontSize: 13 },
  hint: { color: BS.text2, fontSize: 11.5, marginLeft: 'auto' },
  err: { color: '#ff5d6c', padding: 16, fontSize: 14 },
});
