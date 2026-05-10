import jwt from 'jsonwebtoken';
import { one } from './db.js';

const secret = process.env.JWT_SECRET || 'traveloop-local-development-secret';

export function sign(user) {
  return jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '7d' });
}

export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.traveloop_session;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, secret);
    const user = one('SELECT id, name, email, photo_url, language, saved_destinations, role, staff_status, privilege_notes, email_verified, blocked FROM users WHERE id = ?', [payload.id]);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    if (user.blocked) return res.status(403).json({ error: 'This account has been blocked.' });
    user.saved_destinations = JSON.parse(user.saved_destinations || '[]');
    user.email_verified = Boolean(user.email_verified);
    user.blocked = Boolean(user.blocked);
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid session' });
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin privileges required' });
  next();
}
