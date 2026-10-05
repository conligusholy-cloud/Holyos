// BS2 — logo Best Series 2.0: monogram „B" v tmavé kapsli s gradientovým okrajem a oběžnou drahou s uzlem.
// Jedno SVG pro hlavičku, přihlášení i favicon (/favicon.svg). `size` = px, `id` unikátní prefix (víc log na stránce).
function logoSvg(size = 40, id = 'l') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;flex:none">
<defs>
  <linearGradient id="${id}g" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff"/><stop offset=".55" stop-color="#3a6cf5"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>
  <linearGradient id="${id}b" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#121d36"/><stop offset="1" stop-color="#070b16"/></linearGradient>
  <radialGradient id="${id}r" cx="46" cy="18" r="22" gradientUnits="userSpaceOnUse"><stop stop-color="#4fd1ff" stop-opacity=".45"/><stop offset="1" stop-color="#4fd1ff" stop-opacity="0"/></radialGradient>
  <filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
</defs>
<rect x="2" y="2" width="60" height="60" rx="17" fill="url(#${id}b)"/>
<rect x="2" y="2" width="60" height="60" rx="17" fill="url(#${id}r)"/>
<rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.5" stroke="url(#${id}g)" stroke-width="1.5"/>
<path d="M22 17.5v29M22 17.5h11.5a7.25 7.25 0 0 1 0 14.5H22M22 32h13.5a7.25 7.25 0 0 1 0 14.5H22" stroke="url(#${id}g)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
<ellipse cx="32" cy="32" rx="26" ry="11" transform="rotate(-28 32 32)" stroke="url(#${id}g)" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="3 4"/>
<circle cx="50.5" cy="15" r="4.5" fill="#4fd1ff" filter="url(#${id}f)" opacity=".7"/>
<circle cx="50.5" cy="15" r="2.6" fill="#eaf2ff"/>
</svg>`;
}
module.exports = { logoSvg };
