'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { db }  = require('../config/db');
const { BCRYPT_ROUNDS } = require('../config/constants');
const {
  requireAuth,
  generateAccessToken,
  generateRefreshToken,
  setAuthCookies,
  clearAuthCookies,
} = require('../middleware/auth');
const { authLimiter, authSlowDown } = require('../middleware/rateLimit');
const { registerSchema, loginSchema, validate } = require('../utils/validators');
const logger  = require('../utils/logger');
const jwt     = require('jsonwebtoken');
const { JWT_REFRESH_SECRET } = require('../config/constants');

// ── Helpers ───────────────────────────────────────────────────────
const getClientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || req.ip;

const getUserAgent = (req) =>
  (req.headers['user-agent'] || '').slice(0, 255);

const safeUser = (user) => ({
  id:        user.id,
  firstName: user.first_name,
  lastName:  user.last_name,
  email:     user.email,
  plan:      user.plan,
  createdAt: user.created_at,
});

const issueRefreshToken = async (userId, req) => {
  const { raw, hash } = generateRefreshToken();
  const tokenId       = uuidv4();
  const expiresAt     = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenId, userId, hash, expiresAt, getClientIp(req), getUserAgent(req)]
  );
  return raw;
};

// ── POST /api/auth/register ───────────────────────────────────────
router.post('/register', authSlowDown, authLimiter, registerSchema, validate, async (req, res, next) => {
  const { firstName, lastName, email, password } = req.body;

  try {
    const existing = await db.get(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing) {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
      return res.status(409).json({ success: false, error: 'Un compte existe déjà avec cet email.' });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = uuidv4();

    await db.run(
      `INSERT INTO users (id, first_name, last_name, email, password)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, firstName, lastName, email.toLowerCase(), hashedPassword]
    );

    const user = await db.get(
      'SELECT id, first_name, last_name, email, plan, is_verified, is_banned, created_at FROM users WHERE id = $1',
      [userId]
    );

    const accessToken = generateAccessToken(user);
    const refreshRaw  = await issueRefreshToken(userId, req);
    setAuthCookies(res, accessToken, refreshRaw);

    logger.info('Inscription réussie', { userId });

    return res.status(201).json({ success: true, message: 'Compte créé avec succès.', user: safeUser(user) });

  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', authSlowDown, authLimiter, loginSchema, validate, async (req, res, next) => {
  const { email, password } = req.body;
  const ip = getClientIp(req);

  try {
    // Vérifier brute-force
    const [ipFail, emailFail] = await Promise.all([
      db.get(
        `SELECT COUNT(*) AS count FROM login_attempts
         WHERE ip_address = $1 AND success = 0 AND created_at > NOW() - INTERVAL '15 minutes'`,
        [ip]
      ),
      db.get(
        `SELECT COUNT(*) AS count FROM login_attempts
         WHERE email = $1 AND success = 0 AND created_at > NOW() - INTERVAL '15 minutes'`,
        [email.toLowerCase()]
      ),
    ]);

    if (parseInt(ipFail?.count || 0) >= 20 || parseInt(emailFail?.count || 0) >= 10) {
      return res.status(429).json({ success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }

    const user = await db.get(
      `SELECT id, first_name, last_name, email, password, plan, is_verified, is_banned, created_at
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    const dummyHash = '$2a$12$invalidhashforcomparisononlyXXXXXXXXXXXXXXXXXXXXXXX';
    const isValid   = await bcrypt.compare(password, user?.password || dummyHash);

    if (!user || !isValid) {
      await db.run(
        'INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)',
        [email.toLowerCase(), ip, 0]
      );
      return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect.' });
    }

    if (user.is_banned) {
      return res.status(403).json({ success: false, error: 'Votre compte a été suspendu.' });
    }

    await db.run(
      'INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)',
      [email.toLowerCase(), ip, 1]
    );

    const accessToken = generateAccessToken(user);
    const refreshRaw  = await issueRefreshToken(user.id, req);
    setAuthCookies(res, accessToken, refreshRaw);

    logger.info('Connexion réussie', { userId: user.id });

    return res.json({ success: true, message: 'Connexion réussie.', user: safeUser(user) });

  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ─────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const refreshRaw = req.cookies?.pp_refresh;
  if (refreshRaw) {
    const hash = crypto.createHash('sha256').update(refreshRaw).digest('hex');
    try { await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = $1', [hash]); } catch {}
  }
  clearAuthCookies(res);
  return res.json({ success: true, message: 'Déconnexion réussie.' });
});

// ── POST /api/auth/refresh ────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  const refreshRaw = req.cookies?.pp_refresh;
  if (!refreshRaw) return res.status(401).json({ success: false, error: 'Token manquant.' });

  try {
    let payload;
    try {
      payload = jwt.verify(refreshRaw, JWT_REFRESH_SECRET, {
        algorithms: ['HS256'], issuer: 'pdfpapers', audience: 'pdfpapers-client',
      });
    } catch {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, error: 'Token invalide ou expiré.' });
    }

    const hash  = crypto.createHash('sha256').update(refreshRaw).digest('hex');
    const token = await db.get(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked = 0 AND expires_at > NOW()',
      [hash]
    );

    if (!token) {
      if (payload?.sub) {
        await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = $1', [payload.sub]);
        logger.warn('Possible vol de token — sessions révoquées', { userId: payload.sub });
      }
      clearAuthCookies(res);
      return res.status(401).json({ success: false, error: 'Session invalide. Reconnectez-vous.' });
    }

    await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = $1', [hash]);

    const user = await db.get(
      'SELECT id, first_name, last_name, email, plan, is_verified, is_banned, created_at FROM users WHERE id = $1',
      [token.user_id]
    );

    if (!user || user.is_banned) {
      clearAuthCookies(res);
      return res.status(403).json({ success: false, error: 'Compte suspendu.' });
    }

    const newAccess  = generateAccessToken(user);
    const newRefresh = await issueRefreshToken(user.id, req);
    setAuthCookies(res, newAccess, newRefresh);

    return res.json({ success: true, user: safeUser(user) });

  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await db.get(
      'SELECT id, first_name, last_name, email, plan, is_verified, is_banned, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    return res.json({ success: true, user: safeUser(user) });
  } catch (err) { next(err); }
});

// ── POST /api/auth/revoke-all ─────────────────────────────────────
router.post('/revoke-all', requireAuth, async (req, res, next) => {
  try {
    await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = $1', [req.user.id]);
    clearAuthCookies(res);
    return res.json({ success: true, message: 'Toutes vos sessions ont été fermées.' });
  } catch (err) { next(err); }
});

module.exports = router;
