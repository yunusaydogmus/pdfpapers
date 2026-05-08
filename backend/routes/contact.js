'use strict';

/**
 * Route du formulaire de contact.
 * POST /api/contact
 *
 * Sécurité :
 *  - Rate limiting strict (5 messages / 15 min / IP)
 *  - Validation et sanitisation des données
 *  - Enregistrement en DB (audit + anti-spam)
 *  - Envoi email Nodemailer
 */

const router = require('express').Router();
const { contactLimiter } = require('../middleware/rateLimit');
const { contactSchema, validate } = require('../utils/validators');
const { getStmts } = require('../config/db');
const { sendContactEmail } = require('../services/mailer');
const logger = require('../utils/logger');

const getClientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress ||
  req.ip;

// ── POST /api/contact ─────────────────────────────────────────────
router.post(
  '/',
  contactLimiter,
  contactSchema,
  validate,
  async (req, res, next) => {
    const { name, email, company, subject, message } = req.body;
    const ip = getClientIp(req);

    try {
      // Enregistrer en base de données (audit)
      getStmts().createContact.run({
        name,
        email,
        company:   company || null,
        subject,
        message,
        ipAddress: ip,
      });

      // Envoyer l'email (asynchrone, non bloquant pour la réponse)
      sendContactEmail({ name, email, company, subject, message, ipAddress: ip })
        .catch(err => logger.error('Email contact échoué silencieusement', { error: err.message }));

      logger.info('Message de contact reçu', { subject, ip });

      return res.json({
        success: true,
        message: 'Message envoyé avec succès ! Nous vous répondrons dans les 24h.',
      });

    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
