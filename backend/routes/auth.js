'use strict';

/**
 * Routes d'authentification.
 *
 * POST /api/auth/register      — Inscription
 * POST /api/auth/login         — Connexion
 * POST /api/auth/logout        — Déconnexion
 * POST /api/auth/refresh       — Renouveler l'access token
 * GET  /api/auth/me            — Profil utilisateur courant
 * POST /api/auth/revoke-all    — Révoquer toutes les sessions (protégé)
 */

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { getStmts, getDB } = require('../config/db');
const { BCRYPT_ROUNDS, JWT_REFRESH_SECRET, IS_PROD } = require('../config/constants');
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

// ── Helpers ───────────────────────────────────────────────────────

const getClientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  req.ip;

const getUserAgent = (req) =>
  (req.headers['user-agent'] || '').slice(0, 255); // Tronquer à 255 chars

// Profil utilisateur sans le mot de passe
const safeUser = (user) => ({
  id:        user.id,
  firstName: user.first_name,
  lastName:  user.last_name,
  email:     user.email,
  plan:      user.plan,
  createdAt: user.created_at,
});

// Créer et persister un refresh token, retourner le raw
const issueRefreshToken = (userId, req) => {
  const { raw, hash }  = generateRefreshToken();
  const tokenId        = uuidv4();
  const expiresAt      = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  getStmts().createRefreshToken.run({
    id:        tokenId,
    userId,
    tokenHash: hash,
    expiresAt,
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
  });

  return raw;
};

// ── POST /api/auth/register ───────────────────────────────────────
router.post(
  '/register',
  authSlowDown,
  authLimiter,
  registerSchema,
  validate,
  async (req, res, next) => {
    const { firstName, lastName, email, password } = req.body;
    const stmts = getStmts();

    try {
      // Vérifier si l'email existe déjà
      const existing = stmts.findUserByEmail.get(email);
      if (existing) {
        // Délai constant pour éviter l'énumération d'emails
        await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
        return res.status(409).json({
          success: false,
          error: 'Un compte existe déjà avec cet email.',
        });
      }

      // Hacher le mot de passe
      const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

      // Créer l'utilisateur
      const userId = uuidv4();
      stmts.createUser.run({
        id:        userId,
        firstName,
        lastName,
        email:     email.toLowerCase(),
        password:  hashedPassword,
      });

      // Charger l'utilisateur créé
      const user = stmts.findUserById.get(userId);

      // Émettre les tokens
      const accessToken  = generateAccessToken(user);
      const refreshRaw   = issueRefreshToken(userId, req);

      setAuthCookies(res, accessToken, refreshRaw);

      logger.info('Inscription réussie', { userId, email: logger.safe({ email }).email });

      return res.status(201).json({
        success: true,
        message: 'Compte créé avec succès.',
        user: safeUser(user),
      });

    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/auth/login ──────────────────────────────────────────
router.post(
  '/login',
  authSlowDown,
  authLimiter,
  loginSchema,
  validate,
  async (req, res, next) => {
    const { email, password } = req.body;
    const stmts    = getStmts();
    const ip       = getClientIp(req);

    try {
      // Vérifier les échecs récents (brute-force DB-level)
      const ipFailures    = stmts.countRecentIpFailures.get(ip);
      const emailFailures = stmts.countRecentFailures.get(email.toLowerCase());

      if (ipFailures.count >= 20 || emailFailures.count >= 10) {
        return res.status(429).json({
          success: false,
          error: 'Trop de tentatives. Réessayez dans 15 minutes.',
        });
      }

      // Chercher l'utilisateur (délai constant anti-timing attack)
      const user = stmts.findUserByEmail.get(email.toLowerCase());

      // Comparer le mot de passe (même si l'utilisateur n'existe pas)
      const dummyHash = '$2a$12$invalidhashforcomparisononlyXXXXXXXXXXXXXXXXXXXXXXX';
      const isValid   = await bcrypt.compare(password, user?.password || dummyHash);

      if (!user || !isValid) {
        // Enregistrer l'échec
        stmts.recordAttempt.run({
          email:     email.toLowerCase(),
          ipAddress: ip,
          success:   0,
        });

        logger.warn('Tentative de connexion échouée', { ip });

        // Même message pour email inconnu ET mot de passe incorrect (anti-énumération)
        return res.status(401).json({
          success: false,
          error: 'Email ou mot de passe incorrect.',
        });
      }

      // Vérifier si le compte est banni
      if (user.is_banned) {
        return res.status(403).json({
          success: false,
          error: 'Votre compte a été suspendu. Contactez le support.',
        });
      }

      // Enregistrer le succès
      stmts.recordAttempt.run({
        email:     email.toLowerCase(),
        ipAddress: ip,
        success:   1,
      });

      // Émettre les tokens
      const accessToken = generateAccessToken(user);
      const refreshRaw  = issueRefreshToken(user.id, req);

      setAuthCookies(res, accessToken, refreshRaw);

      logger.info('Connexion réussie', { userId: user.id });

      return res.json({
        success: true,
        message: 'Connexion réussie.',
        user: safeUser(user),
      });

    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/auth/logout ─────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const refreshRaw = req.cookies?.pp_refresh;

  if (refreshRaw) {
    const hash = crypto.createHash('sha256').update(refreshRaw).digest('hex');
    try { getStmts().revokeRefreshToken.run(hash); } catch { /* silencieux */ }
  }

  clearAuthCookies(res);

  return res.json({ success: true, message: 'Déconnexion réussie.' });
});

// ── POST /api/auth/refresh ────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  const refreshRaw = req.cookies?.pp_refresh;

  if (!refreshRaw) {
    return res.status(401).json({ success: false, error: 'Token de rafraîchissement manquant.' });
  }

  try {
    // Vérifier la signature JWT
    let payload;
    try {
      payload = jwt.verify(refreshRaw, JWT_REFRESH_SECRET, {
        algorithms: ['HS256'],
        issuer:     'pdfpapers',
        audience:   'pdfpapers-client',
      });
    } catch {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, error: 'Token invalide ou expiré.' });
    }

    // Chercher en DB
    const hash  = crypto.createHash('sha256').update(refreshRaw).digest('hex');
    const token = getStmts().findRefreshToken.get(hash);

    if (!token) {
      // Token non trouvé → possible vol de token → révoquer toutes les sessions
      if (payload?.sub) {
        getStmts().revokeAllUserTokens.run(payload.sub);
        logger.warn('Possible vol de refresh token — sessions révoquées', { userId: payload.sub });
      }
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        error: 'Session invalide. Veuillez vous reconnecter.',
      });
    }

    // Rotation : révoquer l'ancien token, en créer un nouveau
    getStmts().revokeRefreshToken.run(hash);

    const user        = getStmts().findUserById.get(token.user_id);
    if (!user || user.is_banned) {
      clearAuthCookies(res);
      return res.status(403).json({ success: false, error: 'Compte suspendu.' });
    }

    const newAccess  = generateAccessToken(user);
    const newRefresh = issueRefreshToken(user.id, req);

    setAuthCookies(res, newAccess, newRefresh);

    return res.json({
      success: true,
      user: safeUser(user),
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = getStmts().findUserById.get(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
  }
  return res.json({ success: true, user: safeUser(user) });
});

// ── POST /api/auth/revoke-all ─────────────────────────────────────
router.post('/revoke-all', requireAuth, (req, res) => {
  getStmts().revokeAllUserTokens.run(req.user.id);
  clearAuthCookies(res);
  logger.info('Toutes les sessions révoquées', { userId: req.user.id });
  return res.json({ success: true, message: 'Toutes vos sessions ont été fermées.' });
});

module.exports = router;
