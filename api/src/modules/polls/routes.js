const express = require('express');
const config = require('../../config');
const validate = require('../../lib/validate');
const rateLimit = require('../../middleware/rateLimit');
const { requireAuth, optionalAuth } = require('../../middleware/auth');
const polls = require('./service');

const router = express.Router();

router.get('/polls', async (req, res) => {
  const result = await polls.listPolls({
    sort: String(req.query.sort || 'trending'),
    q: String(req.query.q || ''),
    page: req.query.page,
  });
  res.set('X-Read-From', result.readFrom).set('X-Cache', result.cache).json(result);
});

router.get('/polls/mine', requireAuth, async (req, res) => {
  // ?ryw=off turns read-your-writes off for this request (demo switch).
  const readYourWrites = req.query.ryw === 'off' ? false : config.postgres.readYourWrites;
  const result = await polls.listMine(req.user.id, { readYourWrites });
  res.set('X-Read-From', result.readFrom).json({ ...result, readYourWrites });
});

router.get('/polls/:pollId', optionalAuth, async (req, res) => {
  const { poll, readFrom } = await polls.getPoll(validate.uuid(req.params.pollId, 'pollId'), req.user?.id);
  res.set('X-Read-From', readFrom).json({ poll });
});

router.post('/polls', requireAuth, rateLimit('create-poll', config.rateLimit.createPoll), async (req, res) => {
  const poll = await polls.createPoll(req.user, validate.newPoll(req.body));
  res.status(201).set('X-Read-From', 'primary').json({ poll });
});

router.get('/categories', (_req, res) => res.json({ categories: validate.CATEGORIES, regions: config.regions }));

module.exports = router;
