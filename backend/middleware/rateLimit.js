'use strict';

/**
 * Rate limiting par type de route.
 *
 * Stratégie :
 *  - auth      : 10 tentatives / 15 min / IP (anti brute-force)
 *  - pdf tools : 30 requêtes / 15 min / IP
 *  - contact   : 5 messages / 15 min / IP
 *  - global    : 200 requêtes / 15 min / IP (fail-safe)
 *  - slow-down : ralentissement progressif avant blocage complet
 */

const rateLimit  = require('express-rate-limit');
const slowDown   = require('express-slow-down');
const { RATE_WINDOW_MS, RATE_AUTH_MAX, RATE_PDF_MAX, RATE_CONTACT_MAX } = require('../config/constants');

// ── Réponse d'erreur standardisée ────────────────────────────────
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    success: false,
    error: 'Trop de requêtes. Veuillez patienter avant de réessayer.',
    retryAfter: Math.ceil(res.getHeader('Retry-After') || 60),
  });
};

// ── Auth : très restrictif ────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: RATE_AUTH_MAX,
  message: rateLimitHandler,
  handler: rateLimitHandler,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Compter TOUTES les requêtes auth
  keyGenerator: (req) => {
    // Clé = IP + email (double protection)
    const ip    = req.ip || req.connection.remoteAddress;
    const email = req.body?.email?.toLowerCase?.() || '';
    return `${ip}:${email}`;
  },
});

// ── Auth : slowdown AVANT le blocage complet ──────────────────────
const authSlowDown = slowDown({
  windowMs: RATE_WINDOW_MS,
  delayAfter: 3,         // Commencer à ralentir après 3 requêtes
  delayMs: (hits) => hits * 500, // +500ms par requête supplémentaire
});

// ── PDF tools ─────────────────────────────────────────────────────
const pdfLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: RATE_PDF_MAX,
  handler: rateLimitHandler,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Les utilisateurs authentifiés ont une limite plus haute
  keyGenerator: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    return req.user ? `user:${req.user.id}` : `ip:${ip}`;
  },
  skip: (req) => {
    // Utilisateurs Pro/Team : pas de limite
    return req.user?.plan === 'pro' || req.user?.plan === 'team';
  },
});

// ── Formulaire de contact ─────────────────────────────────────────
const contactLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: RATE_CONTACT_MAX,
  handler: rateLimitHandler,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// ── Global fail-safe ──────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: 200,
  handler: rateLimitHandler,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => {
    // Ne pas limiter les fichiers statiques
    return req.path.startsWith('/assets/') || req.path.endsWith('.html');
  },
});

module.exports = {
  authLimiter,
  authSlowDown,
  pdfLimiter,
  contactLimiter,
  globalLimiter,
};
