// =============================================================================
// MilionarWeb — hra Laundromats Milionář uvnitř Velína
// =============================================================================
// Načte pradlomaty.info/game ve WebView. Hra má vlastní účty (herní nick a
// heslo), takže se sem přihlášení z HolyOS nepředává — jen se nechá zapnuté
// úložiště a cookies, aby rozehraná síť přežila zavření aplikace.

import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const BS = { bg: '#04060c', text: '#eaf2ff', text2: '#8ea2c2', accent2: '#4fd1ff' };
const HRA = 'https://pradlomaty.info/game';

export default function MilionarWeb() {
  const ref = useRef<WebView>(null);
  const [muzuZpet, setMuzuZpet] = useState(false);

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <View style={s.bar}>
        <TouchableOpacity
          onPress={() => (muzuZpet ? ref.current?.goBack() : ref.current?.injectJavaScript('history.back(); true;'))}
          style={s.btn}
        >
          <Text style={s.btnTxt}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => ref.current?.reload()} style={s.btn}>
          <Text style={s.btnTxt}>↻ Obnovit</Text>
        </TouchableOpacity>
        <Text style={s.hint}>Hra běží dál, i když ji zavřeš</Text>
      </View>
      <WebView
        ref={ref}
        source={{ uri: HRA }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        // Mapa i panely počítají s plnou šířkou telefonu, proto bez přibližování.
        scalesPageToFit={false}
        allowsBackForwardNavigationGestures
        originWhitelist={['https://*']}
        startInLoadingState
        onNavigationStateChange={(st) => setMuzuZpet(st.canGoBack)}
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
});
