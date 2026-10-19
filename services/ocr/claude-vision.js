// HolyOS — Claude Vision extraction pro faktury
// Dvoupasová extrakce: (1) hlavička, (2) položky

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Modely lze přepnout bez nasazení kódu: OCR_MODEL_FIRST (průchod 1+2) a OCR_MODEL_REREAD (druhé čtení) v env / Railway.
const MODEL_SONNET = process.env.OCR_MODEL_FIRST || 'claude-fable-5-1';
const MODEL_OPUS = process.env.OCR_MODEL_REREAD || 'claude-opus-5-5';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY není nakonfigurovaný');
  return new Anthropic({ apiKey });
}

// Přečti soubor a vrať base64 + detekuj media type
function readFileForClaude(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const mediaTypes = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const media_type = mediaTypes[ext];
  if (!media_type) throw new Error(`Nepodporovaný formát souboru: ${ext}`);
  const type = media_type === 'application/pdf' ? 'document' : 'image';
  return { type, media_type, data: b64, size: buf.length };
}

// Textová vrstva PDF (přesný text bez OCR chyb). U skenů/fotek vrací '' → jen obraz.
async function extractPdfText(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') return '';
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(filePath));
    const t = String(data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    // Méně než ~80 znaků = sken bez textové vrstvy
    return t.length >= 80 ? t.slice(0, 12000) : '';
  } catch (e) {
    return '';
  }
}

// Připojí textovou vrstvu k promptu (pokud existuje)
async function withTextLayer(filePath, prompt) {
  const t = await extractPdfText(filePath);
  if (!t) return prompt;
  return `${prompt}\n\nTEXTOVÁ VRSTVA PDF (přesný text z dokumentu — pro čísla, IČO, DIČ, čísla účtů, částky a data ji upřednostni před vizuálním čtením; při rozporu rozhoduj podle toho, co dává smysl):\n"""\n${t}\n"""`;
}

// ────────────────────────────────────────────────────────────────────────────
// PASS 1 — Hlavička faktury
// ────────────────────────────────────────────────────────────────────────────

const HEADER_PROMPT = `Jsi expert na extrakci dat z českých faktur. Analyzuj dokument a vrať HLAVIČKU faktury jako JSON.

Vrať přesně tuto strukturu (všechna pole, chybějící = null):
{
  "document_kind": "invoice" | "statement" | "other" (invoice = SKUTEČNÁ faktura / dobropis / zálohová faktura / daňový doklad s číslem dokladu; statement = soupis či přehled faktur, výpis z účtu, vyúčtování/zůstatek bez vlastního čísla faktury, upomínka, objednávka, dodací list, nabídka; other = cokoli jiného, co není faktura),
  "type": "received" | "issued" | "credit_note_received" | "credit_note_issued" | "proforma_received" | "proforma_issued",
  "external_number": "číslo dokladu u dodavatele (např. 202601234)",
  "supplier": {
    "name": "Obchodní jméno dodavatele",
    "ico": "IČO (jen číslice)",
    "dic": "DIČ s prefixem země, např. CZ12345678",
    "address": "ulice + č.p.",
    "city": "město",
    "zip": "PSČ",
    "country": "dvoupísmenný kód země dodavatele (CZ, SK, IE, DE, US…), je-li z dokladu poznat"
  },
  "customer": {
    "name": "Obchodní jméno odběratele",
    "ico": "IČO",
    "dic": "DIČ"
  },
  "date_issued": "YYYY-MM-DD datum vystavení",
  "date_taxable": "YYYY-MM-DD DUZP (datum uskutečnění zdanitelného plnění)",
  "date_due": "YYYY-MM-DD splatnost",
  "currency": "CZK" | "EUR" | "USD" | ...,
  "subtotal": number (bez DPH),
  "vat_amount": number (celková DPH),
  "total": number (celkem s DPH),
  "rounding": number (zaokrouhlení, obvykle 0),
  "variable_symbol": "VS (nejčastěji shodné s external_number)",
  "constant_symbol": "KS",
  "specific_symbol": "SS",
  "partner_bank_account": "číslo účtu/kód banky (např. 123456789/0100)",
  "partner_iban": "IBAN",
  "partner_bic": "BIC/SWIFT",
  "payment_method": "bank_transfer" | "cash" | "card" | null,
  "paid_by_card": true | false | null (true, pokud doklad uvádí, že už je ZAPLACENO kartou — např. "Paid on … with VISA", "paid by card", "Zaplaceno kartou", "Receipt"/účtenka s kartou; jinak null),
  "date_paid": "YYYY-MM-DD" | null (datum úhrady, je-li na dokladu uvedeno — "Date paid", "Paid on"),
  "vat_regime": "standard" | "reverse_charge" | "eu_goods" | "non_vat_payer",
  "confidence": number 0-1 (odhad, jak jistě jsi tyto hodnoty extrahoval)
}

Pokyny:
- Pokud je typ dokumentu "faktura daňový doklad", type = "received" (přijatá) pokud my (HolyOS, IČO 25883259 nebo podobné) jsme odběratel, jinak "issued".
- POZOR: Pro "received" je "supplier" = kdo nám fakturu vystavil.
- DODAVATEL (supplier) = právní subjekt v bloku označeném „Dodavatel", „Prodávající", „Vystavil", „Supplier", „Seller", „Od" — má IČO/DIČ a u něj bývá „Bankovní spojení / Číslo účtu". NIKDY nepoužij jako jméno dodavatele nadpis nebo popisek jako „Koncový zákazník", „Zákazník", „Odběratel", „Příjemce", „Bill to", „Ship to" — to je strana, které je faktura určena, ne dodavatel.
- Logo nebo obchodní značka v záhlaví (např. DATART, Alza, Tesco) NEMUSÍ být právním dodavatelem. Jméno dodavatele vždy vezmi z bloku „Dodavatel" s IČO (např. „HP TRONIC Zlín, spol. s r.o."), ne z loga.
- Prázdný rámeček „Koncový zákazník" (bez jména) znamená, že odběratel není uveden → customer.name = null. Nesmíš ho zaměnit za dodavatele.
- partner_bank_account = „Číslo účtu" z bloku dodavatele ve tvaru číslo/kód banky (např. 4582802/0800), partner_iban = IBAN téhož dodavatele. Pokud je uveden, VŽDY je vyplň.
- Pokud vidíš "Dobropis", použij credit_note_*.
- Pokud vidíš "Zálohová faktura" nebo "Proforma", použij proforma_*.
- Čísla vrat jako number, ne jako string. Formát "1 234,56" = 1234.56.
- Pokud si nejsi jistý některým polem, vrať null a v confidence to zohledni.
- Vrať POUZE JSON, žádný komentář před ani po.`;

async function extractHeader(filePath, options = {}) {
  const { model = MODEL_SONNET } = options;
  const client = getClient();
  const file = readFileForClaude(filePath);

  const startedAt = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: 'Vracíš pouze validní JSON objekt, bez markdown kódových bloků.',
    messages: [{
      role: 'user',
      content: [
        { type: file.type, source: { type: 'base64', media_type: file.media_type, data: file.data } },
        { type: 'text', text: await withTextLayer(filePath, HEADER_PROMPT) },
      ],
    }],
  });

  const text = (response.content.find(c => c.type === 'text') || {}).text || '';
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch (err) {
    throw new Error(`Claude vrátil nevalidní JSON v Pass 1: ${err.message}\n---\n${text.slice(0, 500)}`);
  }

  return {
    pass: 1,
    pass_type: 'claude_vision_header',
    model,
    data: parsed,
    confidence: Number(parsed.confidence || 0.5),
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
    duration_ms: Date.now() - startedAt,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// PASS 2 — Položky
// ────────────────────────────────────────────────────────────────────────────

const ITEMS_PROMPT = `Jsi expert na extrakci dat z českých faktur. Vrať POLOŽKY faktury jako JSON array.

Každá položka má tuto strukturu:
{
  "line_order": number (pořadí řádku na faktuře, 1-based),
  "description": "Popis produktu / služby",
  "quantity": number (množství),
  "unit": "ks" | "hod" | "m" | "kg" | "l" | ... (jednotka),
  "unit_price": number (cena za jednotku BEZ DPH),
  "vat_rate": number (% DPH, nejčastěji 0, 12, 15, 21),
  "subtotal": number (quantity × unit_price, bez DPH),
  "vat_amount": number (DPH v Kč pro tento řádek),
  "total": number (subtotal + vat_amount, s DPH),
  "note": string | null
}

Vrať JSON objekt:
{
  "items": [ ...položky... ],
  "confidence": number 0-1
}

Pokyny:
- Zachovej pořadí řádků podle faktury.
- Pokud je zobrazená cena s DPH, spočítej unit_price dopočtem (cena / (1 + vat_rate/100)).
- Pokud řádek má množství 1 a jen celkovou cenu, použij quantity=1 a unit_price = tu cenu.
- Vrať POUZE JSON.`;

async function extractItems(filePath, options = {}) {
  const { model = MODEL_SONNET } = options;
  const client = getClient();
  const file = readFileForClaude(filePath);

  const startedAt = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system: 'Vracíš pouze validní JSON objekt, bez markdown kódových bloků.',
    messages: [{
      role: 'user',
      content: [
        { type: file.type, source: { type: 'base64', media_type: file.media_type, data: file.data } },
        { type: 'text', text: await withTextLayer(filePath, ITEMS_PROMPT) },
      ],
    }],
  });

  const text = (response.content.find(c => c.type === 'text') || {}).text || '';
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch (err) {
    throw new Error(`Claude vrátil nevalidní JSON v Pass 2: ${err.message}\n---\n${text.slice(0, 500)}`);
  }

  return {
    pass: 2,
    pass_type: 'claude_vision_lines',
    model,
    data: parsed,
    confidence: Number(parsed.confidence || 0.5),
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
    duration_ms: Date.now() - startedAt,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// PASS 6 (fallback) — Opus re-read pro low-confidence faktury
// ────────────────────────────────────────────────────────────────────────────

const REREAD_PROMPT = `Předchozí extrakce z této faktury měla nízkou důvěru. Přečti fakturu ZNOVU a vrať kompletní data.

Porovnej s těmito předchozími daty a oprav nesrovnalosti:
PREVIOUS: {{previous_json}}

Vrať stejnou strukturu jako hlavička + items v jednom objektu:
{
  "header": { ...všechna pole z Pass 1... },
  "items": [ ...položky... ],
  "confidence": number 0-1,
  "discrepancies": [ "popis rozdílů oproti předchozím datům" ]
}

Buď extra pečlivý na:
- DODAVATELE: blok „Dodavatel" (i když je popisek světle šedý, vyblklý nebo je doklad sken) obsahuje obchodní jméno, IČO a DIČ vystavitele — vždy je přečti (např. „O2 Czech Republic a.s., IČO 60193336"). Rukou psané poznámky na dokladu (např. „Placeno hotově, pokladna hala, obj. 4410") nejsou dodavatel; z nich pouze urči způsob úhrady (payment_method = cash).
- Přesné čtení čísel (0 vs O, 1 vs l, 5 vs S)
- Správné datum (CZ formát DD.MM.YYYY)
- VS/KS/SS — může být víc symbolů, vyber ten hlavní
- Je-li dokument dobropis, total má být záporné

Vrať POUZE JSON.`;

async function rereadWithOpus(filePath, previousData) {
  const client = getClient();
  const file = readFileForClaude(filePath);

  const prompt = REREAD_PROMPT.replace('{{previous_json}}', JSON.stringify(previousData));

  const startedAt = Date.now();
  const response = await client.messages.create({
    model: MODEL_OPUS,
    max_tokens: 6000,
    system: 'Vracíš pouze validní JSON objekt, bez markdown kódových bloků.',
    messages: [{
      role: 'user',
      content: [
        { type: file.type, source: { type: 'base64', media_type: file.media_type, data: file.data } },
        { type: 'text', text: await withTextLayer(filePath, prompt) },
      ],
    }],
  });

  const text = (response.content.find(c => c.type === 'text') || {}).text || '';
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch (err) {
    throw new Error(`Opus vrátil nevalidní JSON: ${err.message}`);
  }

  return {
    pass: 6,
    pass_type: 'claude_opus_reread',
    model: MODEL_OPUS,
    data: parsed,
    confidence: Number(parsed.confidence || 0.5),
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
    duration_ms: Date.now() - startedAt,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────────────────────────────

function stripCodeFences(text) {
  // Claude občas vrátí ```json\n{...}\n``` i přes system prompt
  return text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
}

module.exports = {
  extractHeader,
  extractItems,
  rereadWithOpus,
  readFileForClaude,
  extractPdfText,
  MODEL_SONNET, MODEL_OPUS, MODEL_HAIKU,
};
