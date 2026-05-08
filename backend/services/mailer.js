'use strict';

/**
 * Service d'envoi d'emails via Nodemailer.
 * Utilisé pour : formulaire de contact, vérification email (futur).
 */

const nodemailer = require('nodemailer');
const sanitize   = require('sanitize-html');
const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, CONTACT_RECEIVER } = require('../config/constants');
const logger     = require('../utils/logger');

// ── Transport ────────────────────────────────────────────────────
let transporter;

const getTransporter = () => {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: true, // Vérifier le certificat TLS
      minVersion: 'TLSv1.2',
    },
    pool:           true,   // Connexions réutilisées
    maxConnections: 3,
    maxMessages:    100,
    rateDelta:      1000,   // 1 email/seconde max
    rateLimit:      5,
  });

  return transporter;
};

// ── Sanitisation HTML pour les emails ────────────────────────────
const sanitizeForEmail = (text) => sanitize(text, {
  allowedTags: [],
  allowedAttributes: {},
}).slice(0, 2000); // Tronquer par sécurité

// ── Email de contact ─────────────────────────────────────────────
const sendContactEmail = async ({ name, email, company, subject, message, ipAddress }) => {
  if (!SMTP_USER || !SMTP_PASS || !CONTACT_RECEIVER) {
    logger.warn('Email de contact non envoyé : configuration SMTP manquante');
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const subjectLabels = {
    'question-generale':       'Question générale',
    'probleme-technique':      'Problème technique',
    'facturation':             'Facturation',
    'demande-fonctionnalite':  'Demande de fonctionnalité',
    'partenariat':             'Partenariat',
    'autre':                   'Autre',
  };

  const cleanName    = sanitizeForEmail(name);
  const cleanMessage = sanitizeForEmail(message);
  const cleanCompany = company ? sanitizeForEmail(company) : null;

  const mailOptions = {
    from:    `"PDFPapers Contact" <${SMTP_USER}>`,
    to:      CONTACT_RECEIVER,
    replyTo: email, // Répondre directement à l'expéditeur
    subject: `[PDFPapers Contact] ${subjectLabels[subject] || subject}`,
    text: [
      `Nouveau message reçu via le formulaire de contact PDFPapers`,
      ``,
      `Nom     : ${cleanName}`,
      `Email   : ${email}`,
      company ? `Société : ${cleanCompany}` : null,
      `Sujet   : ${subjectLabels[subject] || subject}`,
      `IP      : ${ipAddress}`,
      ``,
      `Message :`,
      `──────────────────────────────────`,
      cleanMessage,
      `──────────────────────────────────`,
    ].filter(l => l !== null).join('\n'),

    html: `
      <!DOCTYPE html>
      <html lang="fr">
      <body style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333">
        <div style="background:#16A34A;color:white;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">📬 Nouveau message — PDFPapers</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#6b7280;width:100px">Nom</td><td style="padding:8px 0;font-weight:600">${cleanName}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280">Email</td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
            ${cleanCompany ? `<tr><td style="padding:8px 0;color:#6b7280">Société</td><td style="padding:8px 0">${cleanCompany}</td></tr>` : ''}
            <tr><td style="padding:8px 0;color:#6b7280">Sujet</td><td style="padding:8px 0">${subjectLabels[subject] || subject}</td></tr>
          </table>
          <hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0">
          <p style="color:#6b7280;margin-bottom:8px;font-size:14px">Message :</p>
          <div style="background:#f9fafb;padding:16px;border-radius:6px;white-space:pre-wrap;font-size:14px;line-height:1.6">${cleanMessage}</div>
          <p style="color:#9ca3af;font-size:11px;margin-top:20px">IP : ${ipAddress}</p>
        </div>
      </body>
      </html>
    `,
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    logger.info('Email de contact envoyé', { messageId: info.messageId, to: CONTACT_RECEIVER });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logger.error('Erreur envoi email contact', { error: err.message });
    throw new Error('Impossible d\'envoyer l\'email. Réessayez plus tard.');
  }
};

// ── Vérification de la connexion SMTP au démarrage ────────────────
const verifyConnection = async () => {
  if (!SMTP_USER || !SMTP_PASS) {
    logger.warn('SMTP non configuré — emails désactivés');
    return false;
  }
  try {
    await getTransporter().verify();
    logger.info('Connexion SMTP vérifiée ✓');
    return true;
  } catch (err) {
    logger.warn('Connexion SMTP échouée', { error: err.message });
    return false;
  }
};

module.exports = { sendContactEmail, verifyConnection };
