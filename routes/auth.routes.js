// =============================================================================
// HolyOS — Auth routes
// =============================================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const { generateToken, requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/auth/setup — zkontroluje jestli existují uživatelé
router.get('/setup', async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    res.json({ needsSetup: count === 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/setup — vytvoří prvního admin uživatele (jen pokud žádný neexistuje)
router.post('/setup', async (req, res, next) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) {
      return res.status(400).json({ error: 'Uživatelé již existují. Použijte /api/auth/login.' });
    }

    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Chybí username nebo password' });
    }

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        username,
        password_hash: hash,
        display_name: displayName || username,
        role: 'admin',
        is_super_admin: true,
      },
    });

    const token = generateToken(user);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        isSuperAdmin: user.is_super_admin,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Chybí jméno nebo heslo' });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { person: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }

    const token = generateToken(user);

    // Nastav cookie i vrať v body (podpora obou přístupů)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        isSuperAdmin: user.is_super_admin,
        person: user.person ? {
          id: user.person.id,
          firstName: user.person.first_name,
          lastName: user.person.last_name,
          photoUrl: user.person.photo_url,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me — aktuální uživatel
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users — seznam uživatelů (admin)
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        is_super_admin: true,
        created_at: true,
      },
      orderBy: { username: 'asc' },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/users — vytvořit uživatele (admin)
router.post('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, password, displayName, role, isSuperAdmin } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Chybí username nebo password' });
    }

    const hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        password_hash: hash,
        display_name: displayName || username,
        role: role || 'user',
        is_super_admin: isSuperAdmin || false,
      },
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        is_super_admin: true,
        created_at: true,
      },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/users/:id — upravit uživatele (admin)
router.put('/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { displayName, role, isSuperAdmin, password } = req.body;

    const data = {};
    if (displayName !== undefined) data.display_name = displayName;
    if (role !== undefined) data.role = role;
    if (isSuperAdmin !== undefined) data.is_super_admin = isSuperAdmin;
    if (password) data.password_hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data,
      select: {
        id: true,
        username: true,
        display_name: true,
        role: true,
        is_super_admin: true,
      },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/users/:id (admin)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.user.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
