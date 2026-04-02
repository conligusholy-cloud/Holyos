/* ============================================
   config.js — Konstanty a konfigurace
   ============================================ */

const COLORS = {
  areal:      { fill: 'rgba(139,92,246,0.1)',  stroke: '#8b5cf6', label: 'Areál' },
  hala:       { fill: 'rgba(59,130,246,0.15)', stroke: '#3b82f6', label: 'Hala' },
  pracoviste: { fill: 'rgba(245,158,11,0.2)',  stroke: '#f59e0b', label: 'Pracoviště' },
  sklad:      { fill: 'rgba(16,185,129,0.15)', stroke: '#10b981', label: 'Sklad' },
  cesta:      { fill: 'rgba(16,185,129,0.1)',  stroke: '#10b981', label: 'Cesta' },
  vstup:      { fill: 'rgba(108,140,255,0.2)', stroke: '#6c8cff', label: 'Vstup/Výstup' },
};

const DEFAULT_SIZES = {
  areal:      { w: 100, h: 80 },
  hala:       { w: 40, h: 25 },
  pracoviste: { w: 6, h: 4 },
  sklad:      { w: 15, h: 10 },
  cesta:      { w: 20, h: 3 },
  vstup:      { w: 4, h: 4 },
};

// Typy které se kreslí jako polygon (bod po bodu)
const POLYGON_TYPES = ['areal', 'hala', 'cesta'];

// Typy které se kreslí jako obdélník (drag & drop)
const RECT_TYPES = ['pracoviste', 'sklad', 'vstup'];

const COLOR_SWATCHES = [
  '#8b5cf6', '#3b82f6', '#f59e0b', '#10b981',
  '#ef4444', '#6c8cff', '#f472b6', '#a78bfa'
];

// Typy vjezdů/výjezdů na obvodu areálu
const ENTRANCE_TYPES = {
  vjezd:  { color: '#22c55e', label: 'Vjezd',         icon: '→' },
  vyjezd: { color: '#ef4444', label: 'Výjezd',        icon: '←' },
  oboji:  { color: '#f59e0b', label: 'Vjezd/Výjezd',  icon: '↔' },
};
