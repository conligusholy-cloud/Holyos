// =============================================================================
// PayRequest — „Zaplatit doklad" (QR platba) uvnitř Velína
// =============================================================================
// Otevře se z push notifikace (data.type = 'pay_request', data.token). Načte veřejnou stránku
// /platba-qr/<token> (podepsaný odkaz, bez přihlášení): ukáže doklad a po klepnutí vygeneruje QR platbu.
// Vygenerováním QR se doklad v HolyOS označí „platí se přes QR"; zaplaceno se potvrdí až nalezením ve výpisu.

import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { apiBase } from '../lib/api';

const BS = { bg: '#0f1220', text: '#eaf2ff', text2: '#8ea2c2', accent2: '#4fd1ff' };

export default function PayRequest({ route, navigation }: any) {
  const token: string = route?.params?.token || '';
  const ref = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);

  if (!token) {
    return (
      <SafeAreaView style={s.root}>
        <Text style={s.err}>Chybí odkaz na platbu.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.bar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.btn}><Text style={s.btnTxt}>← Zpět</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => ref.current?.reload()} style={s.btn}><Text style={s.btnTxt}>↻ Obnovit</Text></TouchableOpacity>
      </View>
      <WebView
        ref={ref}
        source={{ uri: apiBase.replace(/\/$/, '') + '/platba-qr/' + encodeURIComponent(token) }}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        onLoadEnd={() => setLoading(false)}
        renderLoading={() => <ActivityIndicator color={BS.accent2} style={StyleSheet.absoluteFill} />}
        style={{ flex: 1, backgroundColor: BS.bg }}
      />
      {loading ? null : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(120,160,255,0.16)' },
  btn: { borderWidth: 1, borderColor: 'rgba(120,160,255,0.32)', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 6 },
  btnTxt: { color: BS.text, fontWeight: '700', fontSize: 13 },
  err: { color: '#ff7a86', padding: 20 },
});
