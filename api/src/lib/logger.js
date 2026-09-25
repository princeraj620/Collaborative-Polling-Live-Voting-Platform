// Minimal structured (JSON-lines) logger. One line per event makes logs
// easy to grep locally and easy to ship to a log pipeline later.
const config = require('../config');

function write(level, msg, fields) {
  const line = {
    ts: new Date().toISOString(),
    level,
    instance: config.instanceId,
    msg,
    ...fields,
  };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

module.exports = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
