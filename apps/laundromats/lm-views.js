// Laundromats — náhrada apps/bs2/views.js pro převzaté aplikace lokalit (lm-location-app.js).
// BS2 layout({ title, nav, active, body }) → vzhled Laundromats s navigací webu .
'use strict';
const LM = require('./lm-layout');
const ACTIVE = { anal: 'hledat', loc: 'zhodnotit' };
function layout(o) {
  return LM.layout({ title: o.title, body: o.body, active: ACTIVE[o.active] || o.active || '', absolute: false });
}
module.exports = { esc: LM.esc, layout };
