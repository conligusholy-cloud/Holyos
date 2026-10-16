// =============================================================================
// useKeyboardPad — výška klávesnice pro Android (edge-to-edge)
// =============================================================================
// Na Androidu s edge-to-edge (Expo SDK 54) se okno při otevření klávesnice
// nezmenšuje, takže KeyboardAvoidingView bez behavior nic neudělá a pole pro
// psaní zmizí pod klávesnicí. Hook vrací výšku klávesnice → použij ji jako
// paddingBottom kontejneru. Na iOS vrací 0 (tam řeší KeyboardAvoidingView 'padding').

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardPad(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const s = Keyboard.addListener('keyboardDidShow', (e) => setH(e?.endCoordinates?.height || 0));
    const hd = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => { s.remove(); hd.remove(); };
  }, []);
  return h;
}
