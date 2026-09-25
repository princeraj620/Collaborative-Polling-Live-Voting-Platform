const express = require('express');
const config = require('../../config');
const db = require('../../db/pg');
const validate = require('../../lib/validate');
const rateLimit = require('../../middleware/rateLimit');
const { requireAuth, signToken } = require('../../middleware/auth');

const router = express.Router();

// Demo sign-in (email + name). Proper authentication is Project 5's topic.
router.post('/auth/login', rateLimit('login', config.rateLimit.login, (req) => req.ip), async (req, res) => {
  const email = validate.email(req.body?.email);
  const name = validate.name(req.body?.name ?? email.split('@')[0]);
  const { rows } = await db.primary.query(
    `INSERT INTO users (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, email, name`,
    [email, name],
  );
  res.json({ token: signToken(rows[0]), user: rows[0] });
});

router.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
