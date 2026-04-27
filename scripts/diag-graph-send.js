// Diagnostika: zkusí poslat zkušební e-mail přes Graph send-as.
// Spuštění: node scripts/diag-graph-send.js [from] [to]
// Defaultně: from = tomas.holy@bestseries.cz, to = tomas.holy@bestseries.cz
require('dotenv').config({ override: true });
const msGraph = require('../services/ms-graph-client');

(async () => {
  const from = process.argv[2] || 'tomas.holy@bestseries.cz';
  const to = process.argv[3] || 'tomas.holy@bestseries.cz';

  console.log(`Test Graph sendMailAs: from=${from} → to=${to}`);
  console.log(`isConfigured() = ${msGraph.isConfigured()}`);

  try {
    await msGraph.sendMailAs(from, {
      to,
      subject: '[HolyOS test] Graph send-as ping',
      textBody: 'Tohle je testovací e-mail z scripts/diag-graph-send.js — ověřuje, že EXO Application Access Policy povolila Mail.Send.',
    });
    console.log('✓ Odesláno. Podívej se v Outlooku v Sent Items a v Inboxu.');
  } catch (e) {
    console.error('✗ Selhalo:');
    console.error(e.message);
    process.exit(1);
  }
})();
