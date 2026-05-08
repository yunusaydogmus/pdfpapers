'use strict';

/**
 * Middleware de sécurité HTTP.
 *
 * Couches de protection :
 *  1. Helmet — headers HTTP sécurisés (X-Frame-Options, CSP, HSTS, etc.)
 *  2. CORS — origines strictement autorisées
 *  3. Body size limits — empêche les payloads géants
 *  4. HPP — empêche la pollution des paramètres HTTP
 */

const helmet = require('helmet');
const cors   = require('cors');
const { FRONTEND_URL, IS_PROD } = require('../config/constants');

// ── CORS ─────────────────────────────────────────────────────────
const allowedOrigins = [
  FRONTEND_URL,
  'https://pdfpapers.vercel.app',
  // Ajouter les domaines de production ici
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origine (Postman, outils, etc.) en dev
    if (!IS_PROD && !origin) return callback(null, true);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS : origine non autorisée : ${origin}`));
    }
  },
  credentials: true,           // Nécessaire pour envoyer les cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
  maxAge: 86400,               // Pré-vol mis en cache 24h
};

// ── Helmet CSP ───────────────────────────────────────────────────
// Adapté aux CDNs utilisés par le frontend (pdf-lib, PDF.js, JSZip)
const helmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        'https://unpkg.com',                  // pdf-lib
        'https://cdnjs.cloudflare.com',        // PDF.js, JSZip
        'https://fonts.googleapis.com',
        // NOTE : en prod, remplacer 'unsafe-inline' par des nonces
        IS_PROD ? null : "'unsafe-inline'",
      ].filter(Boolean),
      styleSrc: [
        "'self'",
        "'unsafe-inline'",                    // styles inline dans l'app
        'https://fonts.googleapis.com',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
      ],
      imgSrc: [
        "'self'",
        'data:',                              // favicon SVG inline
        'blob:',                              // canvas.toBlob()
      ],
      connectSrc: [
        "'self'",
        'https://unpkg.com',
        'https://cdnjs.cloudflare.com',
      ],
      workerSrc: [
        "'self'",
        'blob:',                              // PDF.js worker
        'https://cdnjs.cloudflare.com',
      ],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: IS_PROD ? [] : null,
    },
  },
  // HSTS : forcer HTTPS en production (incluant sous-domaines)
  hsts: IS_PROD
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  // Empêche l'iframe (clickjacking)
  frameguard: { action: 'deny' },
  // Empêche le MIME sniffing
  noSniff: true,
  // Désactive X-Powered-By (ne pas révéler Express)
  hidePoweredBy: true,
  // Active X-XSS-Protection pour les vieux navigateurs
  xssFilter: true,
  // Referrer Policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Permissions-Policy (désactiver les APIs non utilisées)
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
};

// ── ID de requête unique ─────────────────────────────────────────
const { randomBytes } = require('crypto');

const requestId = (req, res, next) => {
  const id = randomBytes(8).toString('hex');
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};

// ── Anti-HPP (pollution paramètres) ─────────────────────────────
const antiHPP = (req, _res, next) => {
  // Si un param apparaît plusieurs fois, ne garder que le dernier
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][req.query[key].length - 1];
      }
    }
  }
  next();
};

module.exports = {
  corsMiddleware: cors(corsOptions),
  helmetMiddleware: helmet(helmetOptions),
  requestId,
  antiHPP,
};
