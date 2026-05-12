// HolyOS — One-shot: vloží/aktualizuje šablonu prádlomat nameplate (100×80 mm, ZPL)
// Použití: node scripts/add-template-pradlomat.js
//
// Idempotentní: pokud šablona s code="pradlomat_nameplate" existuje, aktualizuje
// její body+rozměry; jinak vytvoří novou.
//
// Náhled v UI: Tiskárny → Šablony etiket → Upravit → Labelary renderuje preview
// Tisk:        POST /api/print { template: "pradlomat_nameplate", data: {...}, copies: N }

require('dotenv').config({ override: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CODE = 'pradlomat_nameplate';

// 100 × 80 mm @ 203 DPI (8 dot/mm) = 800 × 640 dots
const ZPL = `^XA
^CI28
^PW800
^LL640
^MNN
^LH0,0

^FO0,0^GB800,640,3^FS

^FO25,25^GB100,110,3^FS
^FO52,38^A0N,60,60^FDB^FS
^FO35,98^A0N,20,20^FDSERIES^FS

^FO160,30^A0N,34,34^FDBEST SERIES s.r.o.^FS
^FO160,75^A0N,22,22^FDZámostní 1155/27^FS
^FO160,103^A0N,22,22^FD710 00 Ostrava^FS
^FO160,131^A0N,22,22^FDCzech Republic^FS

^FO690,40^GB80,55,3^FS
^FO700,48^A0N,40,40^FDCE^FS

^FO0,165^GB800,3,3^FS

^FO25,185^A0N,20,20^FDNázev^FS
^FO25,212^A0N,16,16^FDProduct Name^FS
^FO230,195^A0N,60,60^FD{{product_name}}^FS

^FO0,285^GB800,3,3^FS

^FO400,285^GB3,355,3^FS
^FO0,405^GB800,2,2^FS
^FO0,525^GB800,2,2^FS

^FO25,300^A0N,18,18^FDTyp^FS
^FO25,323^A0N,16,16^FDType^FS
^FO160,318^A0N,34,34^FD{{type}}^FS

^FO420,300^A0N,18,18^FDDatum výroby^FS
^FO420,323^A0N,16,16^FDProduction Date^FS
^FO600,318^A0N,34,34^FD{{date}}^FS

^FO25,418^A0N,18,18^FDČíslo^FS
^FO25,441^A0N,16,16^FDS/N^FS
^FO160,438^A0N,34,34^FD{{serial}}^FS

^FO420,418^A0N,18,18^FDPříkon^FS
^FO420,441^A0N,16,16^FDInput Power^FS
^FO600,438^A0N,34,34^FD{{power}}^FS

^FO25,538^A0N,18,18^FDJmen. napětí^FS
^FO25,561^A0N,16,16^FDRated Voltage^FS
^FO160,558^A0N,34,34^FD{{voltage}}^FS

^FO420,538^A0N,18,18^FDHmotnost^FS
^FO420,561^A0N,16,16^FDWeight^FS
^FO600,558^A0N,34,34^FD{{weight}}^FS

^XZ
`;

(async () => {
  const dbHost = (process.env.DATABASE_URL || '').match(/@([^:/]+)/)?.[1] || '?';
  console.log('Připojuji se k DB hostu: ' + dbHost);

  const existing = await prisma.labelTemplate.findUnique({ where: { code: CODE } });
  const data = {
    code:        CODE,
    name:        'Prádlomat — výrobní štítek',
    language:    'ZPL',
    width_mm:    100,
    height_mm:   80,
    body:        ZPL,
    description: 'Hlavní výrobní nameplate AL218 prádlomatu (100×80 mm). ' +
                 'Placeholdery: product_name, type, date, serial, power, voltage, weight. ' +
                 'Volání: POST /api/print { template: "pradlomat_nameplate", data: { ... }, copies: 1 }',
    is_active:   true,
  };

  if (existing) {
    const updated = await prisma.labelTemplate.update({
      where: { id: existing.id },
      data,
    });
    console.log('AKTUALIZOVÁNO id=' + updated.id);
    console.log(JSON.stringify({ id: updated.id, code: updated.code, name: updated.name,
      width_mm: updated.width_mm, height_mm: updated.height_mm }, null, 2));
  } else {
    const created = await prisma.labelTemplate.create({ data });
    console.log('VLOŽENO id=' + created.id);
    console.log(JSON.stringify({ id: created.id, code: created.code, name: created.name,
      width_mm: created.width_mm, height_mm: created.height_mm }, null, 2));
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('CHYBA:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
