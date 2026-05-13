const fs = require('fs');
const src = fs.readFileSync('modules/vozovy-park/index.html', 'utf8');
const checks = [
  ['onBranchSelect', 'funkce onBranchSelect'],
  ['display:none', 'hidden chips div'],
  ['onchange=\\"onBranchSelect', 'onchange na selectu'],
  ['addBranchChip \u2014 zachov\u00e1no kv\u016fli zp\u011btn\u00e9 kompatibilit\u011b', 'addBranchChip alias'],
  ['data-branch-ids', 'data-branch-ids atribut'],
];
let ok = true;
checks.forEach(function(pair) {
  if (src.includes(pair[0])) { console.log('OK:', pair[1]); }
  else { console.log('CHYBI:', pair[1]); ok = false; }
});
const bpStart = src.indexOf('function branchPickerHtml');
const bpEnd = src.indexOf('function onBranchSelect', bpStart);
const bpBody = bpStart >= 0 && bpEnd > bpStart ? src.slice(bpStart, bpEnd) : '';
if (bpBody.includes('branch-chip')) {
  console.log('CHYBA: branchPickerHtml stale obsahuje branch-chip span!');
  ok = false;
} else {
  console.log('OK: branch-chip span odstranen z branchPickerHtml');
}
console.log(ok ? 'VSECHNY KONTROLY PROSLY' : 'NEKTERA KONTROLA SELHALA');
process.exit(ok ? 0 : 1);
