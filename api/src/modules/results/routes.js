const express = require('express');
const validate = require('../../lib/validate');
const results = require('./service');
const polls = require('../polls/service');

const router = express.Router();

router.get('/polls/:pollId/results', async (req, res) => {
  const { value, hit } = await results.getResults(validate.uuid(req.params.pollId, 'pollId'));
  res.set('X-Cache', hit ? 'HIT' : 'MISS').json(value);
});

// Server-Sent Events: the browser opens this once and receives a
// "results" event every second.
router.get('/polls/:pollId/stream', async (req, res) => {
  const pollId = validate.uuid(req.params.pollId, 'pollId');
  await polls.getPoll(pollId); // 404 before opening the stream

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell Nginx not to buffer this response
  });
  res.write('retry: 2000\n\n'); // reconnect after 2 s if the connection drops

  const unsubscribe = results.hub.subscribe(pollId, res);
  req.on('close', unsubscribe);
});

module.exports = router;
