'use strict';

/**
 * Middleware d'authentification JWT.
 *
 * Stratégie double token :
 *  - Access token  : JWT court (15min), transmis dans un header Authorization
 *                    OU cookie httpOnly 'pp_access'
 *  - Refresh token : JWT long (7j), UNIQUEMENT dans cookie httpOnly 'pp_refresh'
 *
 * Avantages cookies httpOnly vs localStorage :
 *  - Inaccessibles via JavaScript → immunité XSS complète
 *  - SameSite=Strict → protection CSRF native
 *  - Secure → HTTPS uniquement en production
 */

const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { JWT_ACCESS_SECRET, IS_PROD } = require('../config/constants');
const logger   = require('../utils/logger');

// ── Options des cookies ──────────────────────────────────────────
const COOKIE_BASE = {
  httpOnly: true,
  secure:   IS_PROD,            // HTTPS seulement en prod
  sameSite: IS_PROD ? 'strict' : 'lax',
  path:     '/',
};

const ACCESS_COOKIE_OPTS = {
  ...COOKIE_BASE,
  maxAge: 15 * 60 * 1000,       // 15 minutes
};

const REFRESH_COOKIE_OPTS = {
  ...COOKIE_BASE,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  path:   '/api/auth',           // Restrict au chemin de refresh uniquement
};

// ── Extraction du token ──────────────────────────────────────────
const extractToken = (req) => {
  // 1. Cookie httpOnly (préféré)
  if (req.cookies?.pp_access) return req.cookies.pp_access;
  // 2. Header Authorization: Bearer <token> (API clients)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
};

// ── Middleware : authentification obligatoire ─────────────────────
const requireAuth = (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentification requise.',
    });
  }

  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer:     'pdfpapers',
      audience:   'pdfpapers-client',
    });

    // Attacher l'utilisateur décodé à la requête
    req.user = {
      id:        payload.sub,
      email:     payload.email,
      firstName: payload.firstName,
      plan:      payload.plan,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Session expirée. Veuillez vous reconnecter.',
        code:  'TOKEN_EXPIRED',
      });
    }
    logger.warn('Token JWT invalide', { error: err.message, ip: req.ip });
    return res.status(401).json({
      success: false,
      error: 'Token invalide.',
    });
  }
};

// ── Middleware : authentification optionnelle ─────────────────────
// Ne bloque pas si pas de token, attache juste req.user si valide
const optionalAuth = (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer:     'pdfpapers',
      audience:   'pdfpapers-client',
    });
    req.user = {
      id:        payload.sub,
      email:     payload.email,
      firstName: payload.firstName,
      plan:      payload.plan,
    };
  } catch {
    // Silencieux : token invalide = utilisateur non connecté
  }
  next();
};

// ── Génération de tokens ──────────────────────────────────────────
const generateAccessToken = (user) => jwt.sign(
  {
    sub:       user.id,
    email:     user.email,
    firstName: user.first_name || user.firstName,
    plan:      user.plan,
  },
  JWT_ACCESS_SECRET,
  {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
    issuer:    'pdfpapers',
    audience:  'pdfpapers-client',
  }
);

// Le refresh token brut est un random 256 bits → on le hash pour stocker en DB
const generateRefreshToken = () => {
  const raw  = crypto.randomBytes(32).toString('hex'); // 256 bits
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
};

// ── Placement des cookies ─────────────────────────────────────────
const setAuthCookies = (res, accessToken, refreshTokenRaw) => {
  res.cookie('pp_access',  accessToken,    ACCESS_COOKIE_OPTS);
  res.cookie('pp_refresh', refreshTokenRaw, REFRESH_COOKIE_OPTS);
};

const clearAuthCookies = (res) => {
  res.clearCookie('pp_access',  { path: '/' });
  res.clearCookie('pp_refresh', { path: '/api/auth' });
};

module.exports = {
  requireAuth,
  optionalAuth,
  generateAccessToken,
  generateRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  REFRESH_COOKIE_OPTS,
};
