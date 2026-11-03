// =============================================================================
// VideoCall — videohovor se zákazníkem z laundromats.eu přímo ve Velínu
// =============================================================================
// Stránka hovoru (laundromats.eu/videocall/agent/…) běží ve WebView s povolenou kamerou
// a mikrofonem (WebRTC). Odkaz přijde v push notifikaci nebo je v seznamu Videohovory.
// Když instalace ještě nemá oprávnění ke kameře/mikrofonu, nabídne otevření v prohlížeči.

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, PermissionsAndroid, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const BS = { bg: '#04060c', text: '#eaf2ff', text2: '#8ea2c2', accent2: '#4fd1ff', err: '#ff5d6c' };
export const VC_URL_RE = /^https:\/\/(www\.)?laundromats\.eu\/videocall\/agent\//;

export default function VideoCall({ route }: any) {
  const url: string = (route && route.params && route.params.url) || '';
  const [ready, setReady] = useState(Platform.OS !== 'android');
  const [denied, setDenied] = useState(false);
  const ref = useRef<WebView>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]);
        const ok = r[PermissionsAndroid.PERMISSIONS.CAMERA] === 'granted' && r[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === 'granted';
        setDenied(!ok);
      } catch { setDenied(true); }
      setReady(true);
    })();
  }, []);

  if (!VC_URL_RE.test(url)) return <SafeAreaView style={s.root}><Text style={s.err}>Neplatný odkaz na videohovor.</Text></SafeAreaView>;
  if (!ready) return <SafeAreaView style={s.root}><ActivityIndicator color={BS.accent2} style={{ marginTop: 40 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      {denied ? (
        <View style={s.warn}>
          <Text style={s.warnTxt}>Velín nemá povolenou kameru nebo mikrofon. Povol je v Nastavení telefonu, nebo otevři hovor v prohlížeči.</Text>
          <TouchableOpacity onPress={() => Linking.openURL(url).catch(() => {})} style={s.btn}><Text style={s.btnTxt}>Otevřít v prohlížeči</Text></TouchableOpacity>
        </View>
      ) : null}
      <WebView
        ref={ref}
        source={{ uri: url }}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsProtectedMedia
        originWhitelist={['https://*']}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) => {
          const u = req.url || '';
          if (/^https:\/\/(www\.)?laundromats\.eu\//.test(u) || /^(about:|data:|blob:)/.test(u)) return true;
          Linking.openURL(u).catch(() => {}); // tel:, mailto:, cizí weby → systém
          return false;
        }}
        startInLoadingState
        renderLoading={() => <ActivityIndicator color={BS.accent2} style={{ marginTop: 40 }} />}
        style={{ flex: 1, backgroundColor: BS.bg }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  err: { color: BS.err, padding: 20, fontSize: 15 },
  warn: { padding: 12, backgroundColor: 'rgba(255,93,108,.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,93,108,.35)' },
  warnTxt: { color: BS.text, fontSize: 13.5, marginBottom: 8 },
  btn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: BS.accent2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  btnTxt: { color: BS.accent2, fontWeight: '700' },
});
