import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import xss from 'xss';
import { z } from 'zod';
import { run } from './db.js';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false
});

export function sanitizeValue(value) {
  if (typeof value === 'string') return xss(validator.trim(value), { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script'] });
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  return value;
}

export function sanitizeBody(req, _res, next) {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) req.query = sanitizeValue(req.query);
  next();
}

export function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    req.body = parsed.data;
    next();
  };
}

export const emailSchema = z.string().email().max(160).transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters.').max(120).regex(/[A-Z]/, 'Password needs one uppercase letter.').regex(/[0-9]/, 'Password needs one number.');
export const safeText = (min = 1, max = 500) => z.string().min(min).max(max);
export const safeUrl = z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Only http/https URLs are allowed.');

export function createCsrfToken(req, res) {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie('traveloop_csrf', token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 60 * 1000
  });
  req.csrfToken = token;
  return token;
}

export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies?.traveloop_csrf;
  const header = req.headers['x-csrf-token'];
  if (!cookie || !header || cookie !== header) return res.status(403).json({ error: 'Invalid CSRF token' });
  next();
}

export function captchaChallenge() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  return { question: `${a} + ${b}`, answer: String(a + b) };
}

export function audit(actorId, action, entityType, entityId = '', metadata = {}) {
  run('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [
    actorId || null,
    action,
    entityType,
    String(entityId || ''),
    JSON.stringify(metadata)
  ]);
}
