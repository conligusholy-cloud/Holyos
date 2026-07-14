// =============================================================================
// SignContract — podpis rezervační/kupní/servisní smlouvy za Best Series
// =============================================================================
// Otevírá se z push notifikace „K autorizaci" (data.type='compounder_contract',
// contract_id). Jan/Tomáš:
//   1) vidí náhled smlouvy (PDF přes veřejný token),
//   2) nakreslí podpis (WebView plátno),
//   3) odešlou → POST /api/compounder/contracts/:id/countersign (JWT).
// Po podpisu je smlouva buď zpřístupněna zákazníkovi (awaiting_customer), nebo
// plně podepsaná.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, ApiError, API_BASE } from '../lib/api';
import { loadAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'SignContract'>;

// HTML podpisové plátno — na onMessage pošle dataURL (PNG). window.getSig()
// vyvoláme z RN po klepnutí na „Podepsat". clearSig() maže.
const SIGN_HTML = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}#c{display:block;width:100%;height:100%;touch-action:none}</style></head>
<body><canvas id="c"></canvas><script>
var cv=document.getElementById('c'),ctx=cv.getContext('2d'),drawing=false,dirty=false;
function resize(){var r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=r.width*d;cv.height=r.height*d;ctx.scale(d,d);ctx.strokeStyle='#111';ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';}
setTimeout(resize,50);
function pos(e){var r=cv.getBoundingClientRect(),t=(e.touches&&e.touches[0])?e.touches[0]:e;return{x:t.clientX-r.left,y:t.clientY-r.top};}
cv.addEventListener('touchstart',function(e){e.preventDefault();drawing=true;var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});
cv.addEventListener('touchmove',function(e){if(!drawing)return;e.preventDefault();var p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();dirty=true;},{passive:false});
cv.addEventListener('touchend',function(){drawing=false;});
window.clearSig=function(){ctx.clearRect(0,0,cv.width,cv.height);dirty=false;};
window.getSig=function(){window.ReactNativeWebView.postMessage(dirty?cv.toDataURL('image/png'):'');};
</script></body></html>`;

export default function SignContract({ route, navigation }: Props) {
  const contractId = route.params?.contractId;
  const [jwt, setJwt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const webRef = useRef<WebView>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const auth = await loadAuth();
      if (!auth.jwt) { navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); return; }
      setJwt(auth.jwt);
      const d = await api.contractForSign(auth.jwt, contractId);
      setInfo(d);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 403) setError('Nemáte oprávnění podepisovat za Best Series.');
      else setError(e?.message || 'Smlouvu se nepodařilo načíst.');
    } finally { setLoading(false); }
  }, [contractId, navigation]);

  useEffect(() => { load(); }, [load]);

  const openPdf = () => {
    if (info?.share_token) Linking.openURL(`${API_BASE}/api/compounder/contracts/public/${info.share_token}/pdf`);
    else Alert.alert('Náhled', 'Náhled PDF zatím není k dispozici.');
  };

  // Klepnutí na „Podepsat" → požádáme WebView o dataURL; přijde do onMessage.
  const requestSignature = () => { webRef.current?.injectJavaScript('window.getSig(); true;'); };

  const onMessage = async (event: any) => {
    const dataUrl = event?.nativeEvent?.data || '';
    if (!dataUrl || dataUrl.indexOf('data:image') !== 0) {
      Alert.alert('Podpis', 'Nakreslete prosím svůj podpis.');
      return;
    }
    if (!jwt) return;
    setSubmitting(true);
    try {
      const r = await api.contractCountersign(jwt, contractId, dataUrl);
      Alert.alert(
        'Hotovo',
        r.awaiting_customer ? 'Podepsáno za Best Series. Smlouva je zpřístupněna zákazníkovi k podpisu.' : 'Smlouva je plně podepsaná.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert('Chyba', e?.message || 'Podpis se nepodařilo odeslat.');
    } finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={s.wrap} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>‹ Zpět</Text>
        </TouchableOpacity>
        <Text style={s.title}>Podpis smlouvy</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error ? (
        <View style={s.center}><Text style={s.err}>{error}</Text>
          <TouchableOpacity style={s.btnGhost} onPress={load}><Text style={s.btnGhostTxt}>Zkusit znovu</Text></TouchableOpacity>
        </View>
      ) : info?.status === 'podepsano' ? (
        <View style={s.center}><Text style={s.done}>Smlouva už je plně podepsaná.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md }}>
          <Text style={s.ctype}>{info?.typeLabel || 'Smlouva'}</Text>
          <Text style={s.csub}>{info?.kiosk_label || info?.kiosk_code || ''}</Text>

          <TouchableOpacity style={s.pdfBtn} onPress={openPdf}>
            <Text style={s.pdfBtnTxt}>📄 Náhled smlouvy (PDF)</Text>
          </TouchableOpacity>

          {info?.customer_signature ? (
            <View style={s.custBox}>
              <Text style={s.custLbl}>Zákazník už podepsal{info?.customer_name ? ` (${info.customer_name})` : ''}.</Text>
            </View>
          ) : (
            <Text style={s.note}>Podpisem za Best Series se smlouva zpřístupní zákazníkovi k podpisu.</Text>
          )}

          <Text style={s.padLbl}>Váš podpis</Text>
          <View style={s.padWrap}>
            <WebView
              ref={webRef}
              originWhitelist={['*']}
              source={{ html: SIGN_HTML }}
              style={s.pad}
              scrollEnabled={false}
              onMessage={onMessage}
            />
          </View>
          <TouchableOpacity onPress={() => webRef.current?.injectJavaScript('window.clearSig(); true;')}>
            <Text style={s.clear}>Vymazat</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.signBtn, submitting && { opacity: 0.6 }]} disabled={submitting} onPress={requestSignature}>
            <Text style={s.signBtnTxt}>{submitting ? 'Podepisuji…' : 'Podepsat za Best Series'}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  err: { color: '#fca5a5', textAlign: 'center', marginBottom: 14 },
  done: { color: '#4ade80', fontSize: 16, fontWeight: '600' },
  ctype: { color: colors.text, fontSize: 20, fontWeight: '800' },
  csub: { color: colors.text2, fontSize: 14, marginTop: 2, marginBottom: 14 },
  pdfBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginBottom: 14 },
  pdfBtnTxt: { color: colors.text, fontSize: 15, fontWeight: '600' },
  custBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, marginBottom: 12 },
  custLbl: { color: '#4ade80', fontSize: 13 },
  note: { color: colors.text2, fontSize: 13, marginBottom: 12 },
  padLbl: { color: colors.text2, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  padWrap: { height: 200, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#fff' },
  pad: { flex: 1, backgroundColor: '#fff' },
  clear: { color: colors.text2, fontSize: 13, textAlign: 'right', paddingVertical: 8 },
  signBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  signBtnTxt: { color: '#0a0a0c', fontSize: 16, fontWeight: '800' },
  btnGhost: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 18 },
  btnGhostTxt: { color: colors.text, fontSize: 14 },
});
