// =============================================================================
// HolyOS — Modul Obchod: helpery pro role a oprávnění
// =============================================================================
// Detekce, zda je přihlášený uživatel "vedoucí obchodu", admin/super admin nebo
// běžný obchodník. Používá se napříč routy v sales.routes.js k filtrování
// kontaktů a omezování zápisů (kdo smí přidělovat, nastavovat % provize atd.).
//
// Zdroj pravdy pro "vedoucí obchodu" je Person.role.name === 'Vedoucí obchodu'
// (HR Role model). Admin = User.role === 'admin' nebo User.is_super_admin.
//
// Public API:
//   resolveSalesRole(req) → Promise<{
//     viewerPersonId,        // id Person přihlášeného uživatele (nebo null)
//     isAdmin,               // admin / super-admin (User.role nebo is_super_admin)
//     isSalesLead,           // role.name === 'Vedoucí obchodu'
//     canManageSales,        // isAdmin || isSalesLead — má plný náhled + edit
//   }>

const { prisma } = require('../config/database');

const SALES_LEAD_ROLE_NAME = 'Vedoucí obchodu';

async function resolveSalesRole(req) {
  const user = req.user || {};
  const isAdmin = !!(user.isSuperAdmin || user.role === 'admin');
  const viewerPersonId = user.person ? user.person.id : null;

  let isSalesLead = false;
  if (viewerPersonId && user.person && user.person.role_id) {
    // Person mohl být do middleware načten bez .role — dohledáme name přímo
    const role = await prisma.role.findUnique({
      where: { id: user.person.role_id },
      select: { name: true },
    });
    if (role && role.name === SALES_LEAD_ROLE_NAME) {
      isSalesLead = true;
    }
  }

  return {
    viewerPersonId,
    isAdmin,
    isSalesLead,
    canManageSales: isAdmin || isSalesLead,
  };
}

// Filtr Prisma `where` pro běžné obchodníky: pouze kontakty, kde JE přihlášený
// obchodník přidělen A ZÁROVEŇ je počet přidělených obchodníků = 1 (žádné
// sdílené kontakty pro jednotlivce — ty vidí jen vedoucí/admin).
//
// Vrací `null` pokud má uživatel přístup ke všemu (admin/vedoucí). Jinak
// vrací `where` fragment, který se mergne do hlavní query.
//
// Pozn.: Prisma `_count` filtr v `where.assignments.every` neumí přímo
// porovnat délku — proto se používá `none: { person_id: { not: ... } }`
// (nesmí existovat jiný assignment, než ten přihlášeného uživatele).
function buildContactVisibilityFilter(roleCtx) {
  if (roleCtx.canManageSales) return null;
  if (!roleCtx.viewerPersonId) {
    // Bez Person.id obchodník nevidí nic
    return { id: -1 };
  }
  return {
    assignments: {
      some: { person_id: roleCtx.viewerPersonId },
      none: { person_id: { not: roleCtx.viewerPersonId } },
    },
  };
}

module.exports = {
  SALES_LEAD_ROLE_NAME,
  resolveSalesRole,
  buildContactVisibilityFilter,
};
