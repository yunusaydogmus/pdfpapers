'use strict';

const router = require('express').Router();
const { contactLimiter }  = require('../middleware/rateLimit');
const { contactSchema, validate } = require('../utils/validators');
const { db }              = require('../config/db');
const { sendContactEmail } = require('../services/mailer');
const logger              = require('../utils/logger');

const getClientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || req.ip;

router.post('/', contactLimiter, contactSchema, validate, async (req, res, next) => {
  const { name, email, company, subject, message } = req.body;
  const ip = getClientIp(req);

  try {
    await db.run(
      `INSERT INTO contacts (name, email, company, subject, message, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [name, email, company || null, subject, message, ip]
    );

    sendContactEmail({ name, email, company, subject, message, ipAddress: ip })
      .catch(err => logger.error('Email contact échoué', { error: err.message }));

    return res.json({ success: true, message: 'Message envoyé ! Nous vous répondrons dans les 24h.' });

  } catch (err) { next(err); }
});

module.exports = router;
