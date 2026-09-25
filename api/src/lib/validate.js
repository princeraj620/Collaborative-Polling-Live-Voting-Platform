const { badRequest } = require('./errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = ['general', 'tech', 'food', 'travel', 'sports', 'entertainment', 'lifestyle'];

function uuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw badRequest(`${field} must be a valid UUID`);
  return value;
}

function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !EMAIL_RE.test(value)) {
    throw badRequest('A valid email is required');
  }
  return value.trim().toLowerCase();
}

function name(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80) {
    throw badRequest('name must be 1-80 characters');
  }
  return value.trim();
}

function region(value, regions) {
  if (value === undefined || value === null || value === '') return null;
  if (!regions.includes(value)) throw badRequest(`region must be one of: ${regions.join(', ')}`);
  return value;
}

function newPoll(body) {
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (question.length < 5 || question.length > 200) throw badRequest('question must be 5-200 characters');

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > 500) throw badRequest('description must be at most 500 characters');

  if (!Array.isArray(body.options)) throw badRequest('options must be an array');
  const options = body.options.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (options.length < 2 || options.length > 6) throw badRequest('a poll needs 2-6 options');
  if (options.some((o) => o.length < 1 || o.length > 60)) throw badRequest('each option must be 1-60 characters');
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw badRequest('options must be different');

  const durationMinutes = Number(body.durationMinutes ?? 60);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 43200) {
    throw badRequest('durationMinutes must be a whole number from 1 to 43200 (30 days)');
  }

  const visibility = body.visibility ?? 'public';
  if (!['public', 'unlisted'].includes(visibility)) throw badRequest('visibility must be public or unlisted');

  const category = body.category ?? 'general';
  if (!CATEGORIES.includes(category)) throw badRequest(`category must be one of: ${CATEGORIES.join(', ')}`);

  return { question, description, options, durationMinutes, visibility, category };
}

module.exports = { uuid, email, name, region, newPoll, CATEGORIES };
