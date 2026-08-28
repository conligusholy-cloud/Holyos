// HolyOS — plnění DOCX šablon smluv.
// Nahrazuje CELÉ odstavce, jejichž text odpovídá pravidlu, a to zachová formátování
// všech ostatních odstavců (mění se jen ty vyplňované). Řeší roztříštěné runy tím,
// že odpovídající odstavec přestaví na jeden run (první rPr) s novým textem.
const fs = require('fs');
const PizZip = require('pizzip');

function xmlEscape(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Text odstavce (spojení všech <w:t>, zalomení <w:br/>/<w:tab/> jako prázdné).
function paraText(p) {
  var out = ''; var re = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>/g; var m;
  while ((m = re.exec(p))) { out += (m[1] != null ? m[1] : ''); }
  return out.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function firstRpr(p) { var m = p.match(/<w:r\b[^>]*>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/); return m ? m[1] : ''; }
function pPr(p) { var m = p.match(/(<w:pPr>[\s\S]*?<\/w:pPr>)/); return m ? m[1] : ''; }
function pOpen(p) { var m = p.match(/^<w:p\b[^>]*>/); return m ? m[0] : '<w:p>'; }
// Nový obsah odstavce: text s '\n' → <w:br/>.
function buildPara(p, text) {
  var rpr = firstRpr(p);
  var parts = String(text).split('\n');
  var runs = parts.map(function (line, i) {
    var sp = (line !== line.trim() || /\s/.test(line)) ? ' xml:space="preserve"' : '';
    return (i > 0 ? '<w:r>' + rpr + '<w:br/></w:r>' : '') + '<w:r>' + rpr + '<w:t' + sp + '>' + xmlEscape(line) + '</w:t></w:r>';
  }).join('');
  return pOpen(p) + pPr(p) + runs + '</w:p>';
}

// rules: [{ test:(text)=>bool, build:(text)=>string }]. build vrací nový plný text odstavce.
function applyRules(xml, rules) {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, function (p) {
    var t = paraText(p);
    for (var i = 0; i < rules.length; i++) {
      try {
        if (rules[i].test(t, p)) { var nt = rules[i].build(t, p); if (nt != null) return buildPara(p, nt); }
      } catch (e) { /* pravidlo best-effort */ }
    }
    return p;
  });
}

// Naplní DOCX buffer/šablonu podle pravidel, vrátí Buffer.
function fillDocxBuffer(buffer, rules) {
  var zip = new PizZip(buffer);
  var xml = zip.file('word/document.xml').asText();
  xml = applyRules(xml, rules);
  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
function fillDocxFile(path, rules) { return fillDocxBuffer(fs.readFileSync(path), rules); }

module.exports = { fillDocxBuffer, fillDocxFile, paraText };
