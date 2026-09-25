const jwt = require('jsonwebtoken');
const config = require('../config');
const { unauthorized } = require('../lib/errors');

// Stateless auth: the JWT carries everything we need, so any API instance can
// serve any request. No sticky sessions required at the load balancer.
function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    return next();
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtTtl,
  });
}

// Like requireAuth, but anonymous requests are allowed (req.user stays unset).
function optionalAuth(req, res, next) {
  if (!req.get('authorization')) return next();
  return requireAuth(req, res, next);
}

module.exports = { requireAuth, optionalAuth, signToken };
