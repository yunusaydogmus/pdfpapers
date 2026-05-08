'use strict';

/**
 * Schémas de validation express-validator pour toutes les routes.
 * Centralisation pour éviter les oublis et faciliter les audits.
 */

const { body, param, query } = require('express-validator');

// ── Auth ─────────────────────────────────────────────────────────

const registerSchema = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('Le prénom est requis.')
    .isLength({ min: 2, max: 50 }).withMessage('Prénom : 2 à 50 caractères.')
    .matches(/^[\p{L}\s\-']+$/u).withMessage('Prénom invalide.'),

  body('lastName')
    .trim()
    .notEmpty().withMessage('Le nom est requis.')
    .isLength({ min: 2, max: 50 }).withMessage('Nom : 2 à 50 caractères.')
    .matches(/^[\p{L}\s\-']+$/u).withMessage('Nom invalide.'),

  body('email')
    .trim()
    .notEmpty().withMessage('L\'email est requis.')
    .isEmail().withMessage('Email invalide.')
    .normalizeEmail()
    .isLength({ max: 254 }).withMessage('Email trop long.'),

  body('password')
    .notEmpty().withMessage('Le mot de passe est requis.')
    .isLength({ min: 8, max: 128 }).withMessage('Mot de passe : 8 à 128 caractères.')
    .matches(/[A-Z]/).withMessage('Le mot de passe doit contenir au moins une majuscule.')
    .matches(/[0-9]/).withMessage('Le mot de passe doit contenir au moins un chiffre.'),
];

const loginSchema = [
  body('email')
    .trim()
    .notEmpty().withMessage('L\'email est requis.')
    .isEmail().withMessage('Email invalide.')
    .normalizeEmail()
    .isLength({ max: 254 }),

  body('password')
    .notEmpty().withMessage('Le mot de passe est requis.')
    .isLength({ max: 128 }),
];

// ── Contact ──────────────────────────────────────────────────────

const contactSchema = [
  body('name')
    .trim()
    .notEmpty().withMessage('Le nom est requis.')
    .isLength({ min: 2, max: 100 }).withMessage('Nom : 2 à 100 caractères.'),

  body('email')
    .trim()
    .notEmpty().withMessage('L\'email est requis.')
    .isEmail().withMessage('Email invalide.')
    .normalizeEmail()
    .isLength({ max: 254 }),

  body('company')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Entreprise : max 100 caractères.'),

  body('subject')
    .trim()
    .notEmpty().withMessage('Le sujet est requis.')
    .isIn([
      'question-generale',
      'probleme-technique',
      'facturation',
      'demande-fonctionnalite',
      'partenariat',
      'autre',
    ]).withMessage('Sujet invalide.'),

  body('message')
    .trim()
    .notEmpty().withMessage('Le message est requis.')
    .isLength({ min: 10, max: 2000 }).withMessage('Message : 10 à 2000 caractères.'),
];

// ── PDF tools ────────────────────────────────────────────────────

const VALID_TOOLS = [
  'word-en-pdf', 'excel-en-pdf', 'ppt-en-pdf', 'html-en-pdf',
  'pdf-en-word', 'pdf-en-excel', 'pdf-en-ppt',
  'ocr-pdf', 'fusionner-pdf', 'diviser-pdf', 'compresser-pdf',
  'faire-pivoter-pdf', 'supprimer-pages-pdf', 'extraire-pages-pdf',
  'reorganiser-pages-pdf', 'filigrane-pdf', 'numeroter-pages-pdf',
  'proteger-pdf', 'deverrouiller-pdf', 'jpg-en-pdf', 'pdf-en-jpg', 'pdf-en-png',
];

const pdfToolSchema = [
  param('tool')
    .trim()
    .notEmpty()
    .isIn(VALID_TOOLS).withMessage('Outil PDF invalide.'),
];

// ── Helper : extrait les erreurs de validation ───────────────────
const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      errors: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

module.exports = {
  registerSchema,
  loginSchema,
  contactSchema,
  pdfToolSchema,
  validate,
  VALID_TOOLS,
};
