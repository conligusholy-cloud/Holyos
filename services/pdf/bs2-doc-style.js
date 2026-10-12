// HolyOS — Jednotný vzhled dokladů v designu Best Series 2.0 (tisk A4 + uložení do PDF).
// Okraje řídí @page (preferCSSPageSize), patička se opakuje na každé straně, tabulky se nelámou uprostřed řádku.
'use strict';

const FOOTER_TEXT = 'Best Series s.r.o. · Prádlomat';

// Monogram „B" z BS2 (tmavá kapsle s gradientovým okrajem a oběžnou drahou).
function logoSvg(size, id) {
  size = size || 38; id = id || 'dl';
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;flex:none">'
    + '<defs><linearGradient id="' + id + 'g" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff"/><stop offset=".55" stop-color="#3a6cf5"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>'
    + '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#121d36"/><stop offset="1" stop-color="#070b16"/></linearGradient></defs>'
    + '<rect x="2" y="2" width="60" height="60" rx="17" fill="url(#' + id + 'b)"/>'
    + '<rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.5" stroke="url(#' + id + 'g)" stroke-width="1.5"/>'
    + '<path d="M22 17.5v29M22 17.5h11.5a7.25 7.25 0 0 1 0 14.5H22M22 32h13.5a7.25 7.25 0 0 1 0 14.5H22" stroke="url(#' + id + 'g)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<ellipse cx="32" cy="32" rx="26" ry="11" transform="rotate(-28 32 32)" stroke="url(#' + id + 'g)" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="3 4"/>'
    + '<circle cx="50.5" cy="15" r="2.6" fill="#eaf2ff"/></svg>';
}

const CSS = `
@page{size:A4;margin:16mm 15mm 22mm 15mm}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Inter,'Segoe UI',Tahoma,Arial,sans-serif;font-size:9.5pt;line-height:1.45;color:#0b1220;
  --accent:#1e86e0;--accent2:#4fd1ff;--vio:#7c5cff;--navy:#0b1220;--ink2:#46557a;--muted:#7a8aa6;--line:#dbe4f3;--soft:#f3f7fe;--grad:linear-gradient(90deg,#4fd1ff,#3a6cf5 55%,#7c5cff)}
@media screen{body{padding:16mm 15mm 22mm;max-width:210mm;margin:0 auto;background:#fff}}

.hdr{display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;position:relative;margin-bottom:18px}
.hdr::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;border-radius:3px;background:var(--grad)}
.brand{display:flex;align-items:center;gap:10px}
.brand .wm{font-size:15pt;font-weight:800;letter-spacing:-.02em;line-height:1}
.brand .wm span{background:linear-gradient(90deg,#1e86e0,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}
.brand .sub{font-size:6.8pt;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-top:4px}
.doc{text-align:right}
.doc .t{font-size:17pt;font-weight:800;letter-spacing:-.02em;line-height:1.1}
.doc .n{font-size:11pt;font-weight:700;font-family:Consolas,'Courier New',monospace;color:var(--accent);margin-top:2px}
.doc .p{display:inline-block;margin-top:5px;font-size:7.3pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1e5fb0;background:#e8f1fd;border:1px solid #c7dbf6;padding:2px 9px;border-radius:999px}
.doc .e{font-size:8pt;color:var(--muted);margin-top:3px}

.parties{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:14px}
.party .h{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.14em;color:var(--accent);font-weight:800;padding-left:8px;border-left:3px solid var(--accent);margin-bottom:6px;line-height:1.2}
.party .name{font-weight:800;font-size:11pt;margin-bottom:2px}
.party .row{font-size:9pt;color:var(--ink2);margin:1px 0}

.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin-bottom:14px}
.meta .l{font-size:7pt;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.meta .v{font-weight:700;margin-top:1px}

table.items{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:8.6pt;table-layout:auto}
table.items thead{display:table-header-group}
table.items th{background:#eaf2fe;color:#0b1220;text-align:left;padding:7px 5px;font-size:7pt;text-transform:uppercase;letter-spacing:.06em;font-weight:800;border-bottom:2px solid var(--accent)}
table.items th.r,table.items td.r{text-align:right}
table.items td{padding:7px 5px;border-bottom:1px solid var(--line);vertical-align:top}
table.items tr{page-break-inside:avoid}
table.items td.d{font-weight:700;width:34%}table.items td.c{color:var(--accent);font-weight:800;text-align:center;width:24px}
table.items td.r{white-space:nowrap;font-variant-numeric:tabular-nums}
.code{display:block;font-weight:700;font-size:7.5pt;color:var(--accent);letter-spacing:.05em;margin-top:2px}
.vat{display:block;font-weight:500;font-size:7.5pt;color:var(--muted)}

.sum{margin-left:auto;width:54%;margin-top:10px;page-break-inside:avoid}
.sum .row{display:flex;justify-content:space-between;padding:5px 12px;font-size:10pt}
.sum .row span:first-child{color:var(--ink2)}
.sum .row.total{background:linear-gradient(90deg,#1e86e0,#3a6cf5 55%,#7c5cff);color:#fff;font-size:12pt;font-weight:800;border-radius:8px;margin-top:5px;padding:8px 12px}
.sum .row.total span:first-child{color:#fff}

.box{border:1px solid var(--line);border-radius:8px;padding:10px 13px;background:var(--soft);margin-top:12px;page-break-inside:avoid}
.box h3{font-size:7.5pt;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);font-weight:800;margin-bottom:5px}
.box .row{margin:2px 0;font-size:9pt}.box .row .label{color:var(--muted);display:inline-block;width:125px}.box .row .value{font-family:Consolas,'Courier New',monospace;font-weight:700}
.pay{display:flex;gap:10px}.pc{flex:1;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.pk{font-size:7.5pt;text-transform:uppercase;color:var(--muted);font-weight:700}.pv{font-size:12pt;font-weight:800;margin-top:2px}.ps{font-size:8pt;color:var(--muted)}
.payment{display:grid;grid-template-columns:1fr 150px;gap:14px;margin-top:12px;page-break-inside:avoid}
.payment .box{margin-top:0}.qr{text-align:center}.qr img{width:130px;height:130px;border:1px solid var(--line);border-radius:8px;background:#fff}
.qr .ql{font-size:7pt;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.note{margin-top:12px;padding:9px 13px;background:#eef5ff;border:1px solid #c7dbf6;border-radius:8px;font-size:9pt;color:#1e4d8f;page-break-inside:avoid}
.letter{margin-top:6px;font-size:10.5pt;line-height:1.6;white-space:pre-wrap}
.fine ul{margin:4px 0 0;padding-left:16px;color:var(--ink2);font-size:8.5pt}.fine li{margin:2px 0}
.sig{display:flex;gap:40px;margin-top:46px;page-break-inside:avoid}.sig>div{flex:1;border-top:1px solid #8b9ab5;padding-top:5px;text-align:center;color:var(--ink2);font-size:8.5pt}
.sigcol{flex:1}.sigcol h4{font-size:7.5pt;text-transform:uppercase;color:var(--accent);font-weight:800;margin-bottom:5px}.sigcol img{max-width:200px;max-height:90px}
.sigwrap{display:flex;gap:24px;margin-top:16px;page-break-inside:avoid}.sigwrap .m{font-size:8pt;color:var(--muted);margin-top:3px}.sigwrap .st{font-size:8.5pt;color:var(--ink2)}

.footer{text-align:center;font-size:7.5pt;color:var(--muted);letter-spacing:.04em;border-top:1px solid var(--line);padding-top:6px}
@media screen{.footer{margin-top:30px}}
@media print{.footer{position:fixed;left:0;right:0;bottom:-13mm}.demo{display:none}}
.demo{position:fixed;top:6px;left:50%;transform:translateX(-50%);font-size:8pt;color:#b45309;background:#fef3c7;border:1px solid #fcd34d;padding:2px 8px;border-radius:999px;z-index:5}
`;

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Hlavička: logo + název dokladu + číslo (+ štítek)
function header(o) {
  o = o || {};
  return '<div class="hdr"><div class="brand">' + logoSvg(38, 'h' + Math.floor(Math.random() * 1e6)) + '<div><div class="wm">Best Series</div><div class="sub">Prádlomat</div></div></div>'
    + '<div class="doc"><div class="t">' + esc(o.title) + '</div>' + (o.number ? '<div class="n">' + esc(o.number) + '</div>' : '')
    + (o.pill ? '<div class="p">' + esc(o.pill) + '</div>' : '') + (o.ext ? '<div class="e">' + esc(o.ext) + '</div>' : '') + '</div></div>';
}

// Celá stránka dokladu: opts = { docTitle, title, number, pill, ext, demo }
function page(opts, bodyHtml) {
  return '<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><title>' + esc(opts.docTitle || opts.title) + '</title><style>' + CSS + '</style></head><body>'
    + (opts.demo ? '<div class="demo">UKÁZKA — smyšlená data</div>' : '')
    + header(opts) + bodyHtml + '<div class="footer">' + FOOTER_TEXT + '</div></body></html>';
}

module.exports = { CSS, FOOTER_TEXT, logoSvg, header, page, esc };
