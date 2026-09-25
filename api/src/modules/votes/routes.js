const express = require('express');
const config = require('../../config');
const validate = require('../../lib/validate');
const rateLimit = require('../../middleware/rateLimit');
const { requireAuth } = require('../../middleware/auth');
const votes = require('./service');

const router = express.Router();

router.post('/polls/:pollId/votes', requireAuth, rateLimit('votes', config.rateLimit.votes), async (req, res) => {
  const result = await votes.castVote(req.user, validate.uuid(req.params.pollId, 'pollId'), req.body);
  // 201 = new vote counted, 200 = the same vote was already counted (safe retry)
  res.status(result.status === 'COUNTED' ? 201 : 200).json(result);
});

router.get('/polls/:pollId/my-vote', requireAuth, async (req, res) => {
  const result = await votes.getMyVote(
    req.user,
    validate.uuid(req.params.pollId, 'pollId'),
    String(req.query.consistency || 'strong'),
    req.query.region ? String(req.query.region) : null,
  );
  res.set('X-Read-Preference', result.readPreference).json(result);
});

module.exports = router;
