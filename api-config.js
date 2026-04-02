/* ============================================
   api-config.js — Konfigurace Factorify API
   ============================================

   DŮLEŽITÉ: Tento soubor obsahuje přístupový token.
   Nevkládejte ho do sdíleného repozitáře!

   Vyplňte svůj securityToken níže:
   ============================================ */

const FACTORIFY_CONFIG = {
  baseUrl: 'https://bs.factorify.cloud',
  securityToken: '', // <-- SEM VLOŽTE VÁŠ TOKEN (např. 'CARD:...')

  // API endpointy
  endpoints: {
    entities: '/api/metadata/entities',
    entityMeta: '/api/metadata/entity/', // + entityName
    query: '/api/query/',                // + entityName
  },

  // Výchozí hlavičky
  headers: {
    'Accept': 'application/json',
    'X-FySerialization': 'ui2',
  },

  // Entita pro pracoviště
  workstationEntity: 'Stage',
};
