// =============================================================================
// HolyOS — Compounder: Znalostní báze AI specialisty (extrakce dokumentů)
// =============================================================================
// Z nahraných souborů (PDF / DOCX / XLSX / CSV / TXT) vytáhne čistý text/data,
// který se AI specialistovi vkládá do system promptu jako ZÁVAZNÝ zdroj pravdy.
// Uloženo v AppSetting compounder.ai_specialist_docs (JSON pole {name,at,chars,text}).

const PER_DOC_MAX = 40000;   // strop na jeden dokument (znaků)
const TOTAL_MAX = 90000;     // strop na celou znalostní bázi vloženou do promptu

function ext(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

// Vytáhne text z jednoho souboru podle přípony. Vrací string (může být prázdný).
async function extractText(buffer, filename) {
  const e = ext(filename);
  if (e === 'pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return String(data.text || '');
  }
  if (e === 'docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer });
    return String((r && r.value) || '');
  }
  if (e === 'xlsx' || e === 'xls' || e === 'xlsm') {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const parts = [];
    (wb.SheetNames || []).forEach((sn) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sn], { blankrows: false });
      if (csv && csv.trim()) parts.push('# List: ' + sn + '\n' + csv);
    });
    return parts.join('\n\n');
  }
  if (e === 'csv' || e === 'tsv' || e === 'txt' || e === 'md') {
    return buffer.toString('utf8');
  }
  throw new Error('Nepodporovaný typ souboru: .' + (e || '?') + ' (podporováno: PDF, DOCX, XLSX, CSV, TXT)');
}

// Ořízne text na strop a odstraní přebytečné prázdné řádky.
function clean(text, max) {
  let t = String(text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > max) t = t.slice(0, max) + '\n…[zkráceno]';
  return t;
}

// Sestaví text znalostní báze pro vložení do promptu (spojí dokumenty, respektuje strop).
function buildKnowledgeBlock(docs) {
  if (!Array.isArray(docs) || !docs.length) return '';
  let out = '';
  for (const d of docs) {
    const chunk = '\n\n===== DOKUMENT: ' + (d.name || 'bez názvu') + ' =====\n' + (d.text || '');
    if ((out.length + chunk.length) > TOTAL_MAX) {
      out += chunk.slice(0, Math.max(0, TOTAL_MAX - out.length)) + '\n…[další podklady zkráceny]';
      break;
    }
    out += chunk;
  }
  return out.trim();
}

module.exports = { extractText, clean, buildKnowledgeBlock, PER_DOC_MAX, TOTAL_MAX };
