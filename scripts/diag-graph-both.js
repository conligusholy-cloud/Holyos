// Otestuje obě Graph cesty:
//   A) Mail.ReadWrite na faktury@ inbox (stará pipeline z Fáze 3)
//   B) Mail.Send jménem tomas.holy@ (nová pipeline z Fáze 6)
// Pokud A projde a B selže → propagace nové permission ještě nedoběhla.
// Pokud obě selžou → propagace je univerzální (delete+recreate restartoval timer).

require('dotenv').config({ override: true });
const msGraph = require('../services/ms-graph-client');

(async () => {
  const stamp = new Date().toLocaleTimeString('cs-CZ');
  console.log(`[${stamp}] Diagnostika obou Graph cest:\n`);

  // A) Mail.ReadWrite — list 1 zprávy z faktury@
  process.stdout.write('A) Mail.ReadWrite (faktury@ inbox) ... ');
  try {
    const msgs = await msGraph.listUnreadMessages('faktury@bestseries.cz', { top: 1, includeAttachments: false });
    console.log(`✓ OK (${msgs.length} zpráva v inboxu)`);
  } catch (e) {
    console.log(`✗ ${e.message}`);
  }

  // B) Mail.Send — pošli si test sám sobě
  process.stdout.write('B) Mail.Send (z tomas.holy@) ........... ');
  try {
    await msGraph.sendMailAs('tomas.holy@bestseries.cz', {
      to: 'tomas.holy@bestseries.cz',
      subject: '[HolyOS test] Graph send-as ping',
      textBody: `Test odeslán v ${stamp} z scripts/diag-graph-both.js`,
    });
    console.log('✓ OK (e-mail odeslán)');
  } catch (e) {
    console.log(`✗ ${e.message}`);
  }
})();
