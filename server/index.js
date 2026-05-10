import 'dotenv/config';
import bcrypt from 'bcryptjs';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import morgan from 'morgan';
import { z } from 'zod';
import { activities as activitySeed, cities } from './catalog.js';
import { adminOnly, auth, sign } from './auth.js';
import { all, db, migrate, one, run, toBool } from './db.js';
import { apiLimiter, audit, authLimiter, captchaChallenge, createCsrfToken, csrfProtection, emailSchema, passwordSchema, safeText, safeUrl, sanitizeBody, validate } from './security.js';

migrate();

if (one('SELECT COUNT(*) as count FROM activities').count === 0) {
  const insert = db.prepare('INSERT INTO activities (name, city, country, type, cost, duration_hours, image_url, description, popularity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  activitySeed.forEach(([name, city, country, type, cost, duration, description], index) => {
    insert.run(name, city, country, type, cost, duration, cities[index % cities.length].image, description, 80 + (index % 18));
  });
}

const app = express();
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
const allowedOrigins = new Set([process.env.PUBLIC_APP_URL || 'http://localhost:5173', 'http://localhost:5173', 'http://127.0.0.1:5173']);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(apiLimiter);
app.use(sanitizeBody);
app.use(csrfProtection);

app.get('/api/security/csrf', (req, res) => {
  res.json({ csrfToken: createCsrfToken(req, res) });
});

app.get('/api/security/captcha', (req, res) => {
  const challenge = captchaChallenge();
  res.cookie('traveloop_captcha', challenge.answer, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000
  });
  res.json({ question: challenge.question });
});

const tripSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().default(''),
  cover_photo: z.string().optional().default(''),
  start_date: z.string().min(8),
  end_date: z.string().min(8)
});

const publicTrip = (trip) => {
  if (!trip) return null;
  const stops = all('SELECT * FROM stops WHERE trip_id = ? ORDER BY position, start_date', [trip.id]);
  const activities = all('SELECT * FROM trip_activities WHERE trip_id = ? ORDER BY scheduled_date, scheduled_time', [trip.id]);
  const budget = one('SELECT * FROM budgets WHERE trip_id = ?', [trip.id]);
  return { ...toBool(trip, ['is_public']), stops, activities, budget };
};

const setSessionCookie = (res, token) => {
  res.cookie('traveloop_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

app.post('/api/auth/signup', authLimiter, validate(z.object({ name: safeText(2, 80), email: emailSchema, password: passwordSchema })), async (req, res) => {
  const verificationToken = crypto.randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  try {
    const result = run('INSERT INTO users (name, email, password_hash, role, staff_status, privilege_notes, verification_token) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.body.name, req.body.email, passwordHash, 'traveler', 'active', 'Can plan trips and manage personal travel data.', verificationToken]);
    const user = one('SELECT id, name, email, photo_url, language, saved_destinations, role, staff_status, privilege_notes, email_verified, blocked FROM users WHERE id = ?', [result.lastInsertRowid]);
    user.saved_destinations = [];
    user.email_verified = Boolean(user.email_verified);
    user.blocked = Boolean(user.blocked);
    audit(user.id, 'auth.signup', 'user', user.id);
    const token = sign(user);
    setSessionCookie(res, token);
    res.json({ token, user });
  } catch {
    res.status(409).json({ error: 'An account with this email already exists.' });
  }
});

app.post('/api/auth/login', authLimiter, validate(z.object({ email: emailSchema, password: z.string().min(1).max(120), captcha: z.string().min(1) })), async (req, res) => {
  if (req.cookies?.traveloop_captcha !== req.body.captcha) return res.status(400).json({ error: 'CAPTCHA answer is incorrect.' });
  const record = one('SELECT * FROM users WHERE email = ?', [req.body.email]);
  if (!record || !(await bcrypt.compare(req.body.password, record.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
  if (record.blocked) return res.status(403).json({ error: 'This account has been blocked.' });
  run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [record.id]);
  const user = { id: record.id, name: record.name, email: record.email, photo_url: record.photo_url, language: record.language, saved_destinations: JSON.parse(record.saved_destinations || '[]'), role: record.role || 'traveler', staff_status: record.staff_status || 'active', privilege_notes: record.privilege_notes || 'Can plan trips and manage personal travel data.', email_verified: Boolean(record.email_verified), blocked: Boolean(record.blocked) };
  audit(user.id, 'auth.login', 'user', user.id);
  const token = sign(user);
  setSessionCookie(res, token);
  res.json({ token, user });
});

app.post('/api/auth/forgot', authLimiter, validate(z.object({ email: emailSchema })), (req, res) => {
  const user = one('SELECT id FROM users WHERE email = ?', [req.body.email]);
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    run("UPDATE users SET reset_token = ?, reset_token_expires = datetime('now', '+30 minutes') WHERE id = ?", [token, user.id]);
    audit(user.id, 'auth.password_reset_requested', 'user', user.id);
  }
  res.json({ message: `If ${req.body.email} exists, a reset link has been queued.` });
});

app.post('/api/auth/reset', authLimiter, validate(z.object({ token: z.string().min(20), password: passwordSchema })), async (req, res) => {
  const user = one("SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > datetime('now')", [req.body.token]);
  if (!user) return res.status(400).json({ error: 'Reset link is invalid or expired.' });
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [passwordHash, user.id]);
  audit(user.id, 'auth.password_reset_completed', 'user', user.id);
  res.json({ ok: true });
});

app.get('/api/auth/verify/:token', (req, res) => {
  const user = one('SELECT id FROM users WHERE verification_token = ?', [req.params.token]);
  if (!user) return res.status(400).json({ error: 'Verification token is invalid.' });
  run('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?', [user.id]);
  audit(user.id, 'auth.email_verified', 'user', user.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', auth, (req, res) => {
  audit(req.user.id, 'auth.logout', 'user', req.user.id);
  res.clearCookie('traveloop_session');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.put('/api/me', auth, (req, res) => {
  const saved = JSON.stringify(req.body.saved_destinations || req.user.saved_destinations || []);
  run('UPDATE users SET name = ?, photo_url = ?, email = ?, language = ?, saved_destinations = ? WHERE id = ?', [
    req.body.name || req.user.name,
    req.body.photo_url || '',
    req.body.email || req.user.email,
    req.body.language || 'en',
    saved,
    req.user.id
  ]);
  const user = one('SELECT id, name, email, photo_url, language, saved_destinations, role, staff_status, privilege_notes, email_verified, blocked FROM users WHERE id = ?', [req.user.id]);
  user.saved_destinations = JSON.parse(user.saved_destinations || '[]');
  user.email_verified = Boolean(user.email_verified);
  user.blocked = Boolean(user.blocked);
  res.json(user);
});

app.delete('/api/me', auth, (req, res) => {
  run('DELETE FROM users WHERE id = ?', [req.user.id]);
  res.json({ ok: true });
});

app.get('/api/dashboard', auth, (req, res) => {
  const trips = all('SELECT * FROM trips WHERE user_id = ? ORDER BY updated_at DESC LIMIT 4', [req.user.id]).map((trip) => toBool(trip, ['is_public']));
  const budget = one('SELECT COALESCE(SUM(total_budget),0) total, COALESCE(SUM(transport + stay + activities + meals),0) spent FROM budgets JOIN trips ON trips.id = budgets.trip_id WHERE trips.user_id = ?', [req.user.id]);
  res.json({ trips, recommended: cities.slice(0, 4), budget });
});

app.get('/api/cities', auth, (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const region = String(req.query.region || 'all');
  res.json(cities.filter((c) => (!q || `${c.city} ${c.country}`.toLowerCase().includes(q)) && (region === 'all' || c.region === region)));
});

app.get('/api/activities', auth, (req, res) => {
  const type = String(req.query.type || 'all');
  const q = String(req.query.q || '').toLowerCase();
  res.json(all('SELECT * FROM activities ORDER BY popularity DESC').filter((a) => (type === 'all' || a.type === type) && (!q || `${a.name} ${a.city} ${a.description}`.toLowerCase().includes(q))));
});

app.get('/api/community/posts', auth, (req, res) => {
  const offset = Math.max(0, Number(req.query.offset || 0));
  const q = String(req.query.q || '').toLowerCase();
  const posts = all(`
    SELECT community_posts.*, users.name author, users.photo_url author_photo,
      (SELECT COUNT(*) FROM community_comments WHERE community_comments.post_id = community_posts.id) comment_count
    FROM community_posts JOIN users ON users.id = community_posts.user_id
    WHERE community_posts.status = 'published'
    ORDER BY community_posts.created_at DESC
    LIMIT 12 OFFSET ?
  `, [offset]).filter((post) => !q || `${post.destination} ${post.caption} ${post.hashtags}`.toLowerCase().includes(q));
  res.json(posts);
});

app.post('/api/community/posts', auth, validate(z.object({ destination: safeText(2, 100), caption: safeText(2, 600), hashtags: z.string().max(180).optional().default(''), image_url: safeUrl })), (req, res) => {
  const result = run('INSERT INTO community_posts (user_id, destination, caption, hashtags, image_url) VALUES (?, ?, ?, ?, ?)', [req.user.id, req.body.destination, req.body.caption, req.body.hashtags, req.body.image_url]);
  audit(req.user.id, 'community.post_created', 'community_post', result.lastInsertRowid);
  res.status(201).json(one('SELECT * FROM community_posts WHERE id = ?', [result.lastInsertRowid]));
});

app.post('/api/community/posts/:id/like', auth, (req, res) => {
  run('UPDATE community_posts SET likes = likes + 1 WHERE id = ? AND status = ?', [req.params.id, 'published']);
  res.json(one('SELECT id, likes FROM community_posts WHERE id = ?', [req.params.id]));
});

app.get('/api/community/posts/:id/comments', auth, (req, res) => {
  res.json(all('SELECT community_comments.*, users.name author FROM community_comments JOIN users ON users.id = community_comments.user_id WHERE post_id = ? ORDER BY community_comments.created_at DESC', [req.params.id]));
});

app.post('/api/community/posts/:id/comments', auth, validate(z.object({ body: safeText(1, 300) })), (req, res) => {
  const result = run('INSERT INTO community_comments (post_id, user_id, body) VALUES (?, ?, ?)', [req.params.id, req.user.id, req.body.body]);
  audit(req.user.id, 'community.comment_created', 'community_comment', result.lastInsertRowid);
  res.status(201).json(one('SELECT * FROM community_comments WHERE id = ?', [result.lastInsertRowid]));
});

app.get('/api/trips', auth, (req, res) => {
  const trips = all(`
    SELECT trips.*, COUNT(stops.id) destination_count
    FROM trips LEFT JOIN stops ON stops.trip_id = trips.id
    WHERE trips.user_id = ?
    GROUP BY trips.id
    ORDER BY trips.updated_at DESC
  `, [req.user.id]).map((trip) => toBool(trip, ['is_public']));
  res.json(trips);
});

app.post('/api/trips', auth, (req, res) => {
  const parsed = tripSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Trip name and dates are required.' });
  const result = run('INSERT INTO trips (user_id, name, description, cover_photo, start_date, end_date, share_slug) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    req.user.id,
    parsed.data.name,
    parsed.data.description,
    parsed.data.cover_photo,
    parsed.data.start_date,
    parsed.data.end_date,
    crypto.randomBytes(5).toString('hex')
  ]);
  run('INSERT INTO budgets (trip_id, total_budget, transport, stay, activities, meals) VALUES (?, 2500, 700, 850, 450, 320)', [result.lastInsertRowid]);
  ['Documents', 'Layers for weather', 'Comfortable walking shoes'].forEach((label, index) => run('INSERT INTO checklist_items (trip_id, category, label) VALUES (?, ?, ?)', [result.lastInsertRowid, index === 0 ? 'documents' : 'clothing', label]));
  res.status(201).json(publicTrip(one('SELECT * FROM trips WHERE id = ?', [result.lastInsertRowid])));
});

app.get('/api/trips/:id', auth, (req, res) => {
  const trip = one('SELECT * FROM trips WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(publicTrip(trip));
});

app.put('/api/trips/:id', auth, (req, res) => {
  const trip = one('SELECT * FROM trips WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  run('UPDATE trips SET name = ?, description = ?, cover_photo = ?, start_date = ?, end_date = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
    req.body.name || trip.name,
    req.body.description ?? trip.description,
    req.body.cover_photo ?? trip.cover_photo,
    req.body.start_date || trip.start_date,
    req.body.end_date || trip.end_date,
    req.body.is_public === undefined ? trip.is_public : Number(Boolean(req.body.is_public)),
    req.params.id
  ]);
  res.json(publicTrip(one('SELECT * FROM trips WHERE id = ?', [req.params.id])));
});

app.delete('/api/trips/:id', auth, (req, res) => {
  run('DELETE FROM trips WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/trips/:id/copy', auth, (req, res) => {
  const source = one('SELECT * FROM trips WHERE share_slug = ? AND is_public = 1', [req.params.id]);
  if (!source) return res.status(404).json({ error: 'Public trip not found' });
  const created = run('INSERT INTO trips (user_id, name, description, cover_photo, start_date, end_date, share_slug) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.user.id, `${source.name} copy`, source.description, source.cover_photo, source.start_date, source.end_date, crypto.randomBytes(5).toString('hex')]);
  const newId = created.lastInsertRowid;
  all('SELECT * FROM stops WHERE trip_id = ?', [source.id]).forEach((s) => run('INSERT INTO stops (trip_id, city, country, region, start_date, end_date, position, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [newId, s.city, s.country, s.region, s.start_date, s.end_date, s.position, s.notes]));
  res.json(publicTrip(one('SELECT * FROM trips WHERE id = ?', [newId])));
});

app.get('/api/public/:slug', (req, res) => {
  const trip = one('SELECT * FROM trips WHERE share_slug = ? AND is_public = 1', [req.params.slug]);
  if (!trip) return res.status(404).json({ error: 'Public trip not found' });
  res.json(publicTrip(trip));
});

app.post('/api/trips/:id/stops', auth, (req, res) => {
  const trip = one('SELECT * FROM trips WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const result = run('INSERT INTO stops (trip_id, city, country, region, start_date, end_date, position, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.params.id, req.body.city, req.body.country, req.body.region || '', req.body.start_date, req.body.end_date, req.body.position || 0, req.body.notes || '']);
  res.status(201).json(one('SELECT * FROM stops WHERE id = ?', [result.lastInsertRowid]));
});

app.put('/api/stops/:id', auth, (req, res) => {
  const stop = one('SELECT stops.* FROM stops JOIN trips ON trips.id = stops.trip_id WHERE stops.id = ? AND trips.user_id = ?', [req.params.id, req.user.id]);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  run('UPDATE stops SET city = ?, country = ?, region = ?, start_date = ?, end_date = ?, position = ?, notes = ? WHERE id = ?', [req.body.city || stop.city, req.body.country || stop.country, req.body.region ?? stop.region, req.body.start_date || stop.start_date, req.body.end_date || stop.end_date, req.body.position ?? stop.position, req.body.notes ?? stop.notes, req.params.id]);
  res.json(one('SELECT * FROM stops WHERE id = ?', [req.params.id]));
});

app.delete('/api/stops/:id', auth, (req, res) => {
  run('DELETE FROM stops WHERE id IN (SELECT stops.id FROM stops JOIN trips ON trips.id = stops.trip_id WHERE stops.id = ? AND trips.user_id = ?)', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/trips/:id/activities', auth, (req, res) => {
  const result = run('INSERT INTO trip_activities (trip_id, stop_id, activity_id, title, type, scheduled_date, scheduled_time, cost, duration_hours, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.params.id, req.body.stop_id, req.body.activity_id || null, req.body.title, req.body.type || 'activity', req.body.scheduled_date, req.body.scheduled_time || '09:00', req.body.cost || 0, req.body.duration_hours || 1, req.body.notes || '']);
  res.status(201).json(one('SELECT * FROM trip_activities WHERE id = ?', [result.lastInsertRowid]));
});

app.delete('/api/trip-activities/:id', auth, (req, res) => {
  run('DELETE FROM trip_activities WHERE id IN (SELECT trip_activities.id FROM trip_activities JOIN trips ON trips.id = trip_activities.trip_id WHERE trip_activities.id = ? AND trips.user_id = ?)', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.put('/api/trips/:id/budget', auth, (req, res) => {
  run('UPDATE budgets SET total_budget = ?, transport = ?, stay = ?, activities = ?, meals = ?, currency = ? WHERE trip_id = ?', [req.body.total_budget, req.body.transport, req.body.stay, req.body.activities, req.body.meals, req.body.currency || 'USD', req.params.id]);
  res.json(one('SELECT * FROM budgets WHERE trip_id = ?', [req.params.id]));
});

app.get('/api/trips/:id/expenses', auth, (req, res) => {
  const trip = one('SELECT id FROM trips WHERE id = ? AND (user_id = ? OR ? = ?)', [req.params.id, req.user.id, req.user.role, 'admin']);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(all('SELECT * FROM expenses WHERE trip_id = ? ORDER BY expense_date DESC, created_at DESC', [req.params.id]));
});

app.post('/api/trips/:id/expenses', auth, validate(z.object({ category: z.enum(['hotel', 'transport', 'food', 'activities', 'shopping', 'other']), description: safeText(2, 180), amount: z.number().positive().max(1000000), expense_date: z.string().min(8).max(20), split_with: z.array(z.string().max(80)).optional().default([]), receipt_url: z.string().url().optional().or(z.literal('')).default('') })), (req, res) => {
  const trip = one('SELECT id FROM trips WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const result = run('INSERT INTO expenses (trip_id, user_id, category, description, amount, expense_date, split_with, receipt_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.params.id, req.user.id, req.body.category, req.body.description, req.body.amount, req.body.expense_date, JSON.stringify(req.body.split_with), req.body.receipt_url || '']);
  audit(req.user.id, 'expense.created', 'expense', result.lastInsertRowid);
  res.status(201).json(one('SELECT * FROM expenses WHERE id = ?', [result.lastInsertRowid]));
});

app.delete('/api/expenses/:id', auth, (req, res) => {
  const expense = one('SELECT expenses.* FROM expenses JOIN trips ON trips.id = expenses.trip_id WHERE expenses.id = ? AND (trips.user_id = ? OR ? = ?)', [req.params.id, req.user.id, req.user.role, 'admin']);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'expense.deleted', 'expense', req.params.id);
  res.json({ ok: true });
});

app.get('/api/invoices', auth, (req, res) => {
  const rows = all(`
    SELECT invoices.*, trips.name trip_name, users.name user_name,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE expenses.trip_id = invoices.trip_id), 0) subtotal
    FROM invoices
    JOIN trips ON trips.id = invoices.trip_id
    JOIN users ON users.id = invoices.user_id
    WHERE invoices.user_id = ? OR ? = 'admin'
    ORDER BY invoices.created_at DESC
  `, [req.user.id, req.user.role]);
  res.json(rows.map((row) => ({ ...row, tax: Math.round(row.subtotal * (row.tax_rate / 100)), total: Math.round(row.subtotal + row.subtotal * (row.tax_rate / 100) - row.discount) })));
});

app.post('/api/trips/:id/invoices', auth, (req, res) => {
  const trip = one('SELECT * FROM trips WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  let invoice = one('SELECT * FROM invoices WHERE trip_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!invoice) {
    const result = run('INSERT INTO invoices (trip_id, user_id, invoice_number, tax_rate, discount) VALUES (?, ?, ?, ?, ?)', [req.params.id, req.user.id, `INV-${Date.now().toString(36).toUpperCase()}`, 5, Number(req.body.discount || 0)]);
    invoice = one('SELECT * FROM invoices WHERE id = ?', [result.lastInsertRowid]);
    audit(req.user.id, 'invoice.created', 'invoice', invoice.id);
  }
  res.status(201).json(invoice);
});

app.get('/api/invoices/:id/pdf', auth, (req, res) => {
  const invoice = one(`
    SELECT invoices.*, trips.name trip_name, trips.start_date, trips.end_date, users.name user_name, users.email user_email
    FROM invoices JOIN trips ON trips.id = invoices.trip_id JOIN users ON users.id = invoices.user_id
    WHERE invoices.id = ? AND (invoices.user_id = ? OR ? = 'admin')
  `, [req.params.id, req.user.id, req.user.role]);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const expenses = all('SELECT * FROM expenses WHERE trip_id = ? ORDER BY category, expense_date', [invoice.trip_id]);
  const subtotal = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const tax = subtotal * (invoice.tax_rate / 100);
  const total = subtotal + tax - invoice.discount;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(res);
  doc.fontSize(24).fillColor('#0d5c63').text('TRAVELOOP', { continued: true }).fillColor('#263532').text(' Invoice', { align: 'right' });
  doc.moveDown().fontSize(12).text(`Invoice: ${invoice.invoice_number}`).text(`Trip: ${invoice.trip_name}`).text(`Traveler: ${invoice.user_name} (${invoice.user_email})`).text(`Dates: ${invoice.start_date} to ${invoice.end_date}`).text(`Generated: ${invoice.created_at}`);
  doc.moveDown().fontSize(14).text('Expense Summary', { underline: true });
  const startY = doc.y + 10;
  doc.fontSize(10).text('Category', 48, startY).text('Description', 140, startY).text('Date', 330, startY).text('Amount', 450, startY, { align: 'right' });
  let y = startY + 22;
  expenses.forEach((expense) => {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.text(expense.category, 48, y).text(expense.description, 140, y, { width: 170 }).text(expense.expense_date, 330, y).text(`$${Number(expense.amount).toFixed(2)}`, 450, y, { align: 'right' });
    y += 24;
  });
  doc.moveTo(48, y + 8).lineTo(560, y + 8).strokeColor('#d7c7ad').stroke();
  doc.fontSize(12).text(`Subtotal: $${subtotal.toFixed(2)}`, 360, y + 22, { align: 'right' }).text(`Tax (${invoice.tax_rate}%): $${tax.toFixed(2)}`, { align: 'right' }).text(`Discount: $${Number(invoice.discount).toFixed(2)}`, { align: 'right' }).fontSize(16).fillColor('#0d5c63').text(`Total: $${total.toFixed(2)}`, { align: 'right' });
  doc.end();
});

app.get('/api/trips/:id/checklist', auth, (req, res) => res.json(all('SELECT * FROM checklist_items WHERE trip_id = ? ORDER BY category, created_at', [req.params.id]).map((item) => toBool(item, ['packed']))));
app.post('/api/trips/:id/checklist', auth, (req, res) => {
  const result = run('INSERT INTO checklist_items (trip_id, category, label) VALUES (?, ?, ?)', [req.params.id, req.body.category || 'misc', req.body.label]);
  res.status(201).json(toBool(one('SELECT * FROM checklist_items WHERE id = ?', [result.lastInsertRowid]), ['packed']));
});
app.put('/api/checklist/:id', auth, (req, res) => {
  run('UPDATE checklist_items SET packed = ?, label = COALESCE(?, label), category = COALESCE(?, category) WHERE id = ?', [Number(Boolean(req.body.packed)), req.body.label || null, req.body.category || null, req.params.id]);
  res.json(toBool(one('SELECT * FROM checklist_items WHERE id = ?', [req.params.id]), ['packed']));
});
app.delete('/api/checklist/:id', auth, (req, res) => {
  run('DELETE FROM checklist_items WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/trips/:id/notes', auth, (req, res) => res.json(all('SELECT * FROM notes WHERE trip_id = ? ORDER BY created_at DESC', [req.params.id])));
app.post('/api/trips/:id/notes', auth, (req, res) => {
  const result = run('INSERT INTO notes (trip_id, stop_id, body) VALUES (?, ?, ?)', [req.params.id, req.body.stop_id || null, req.body.body]);
  res.status(201).json(one('SELECT * FROM notes WHERE id = ?', [result.lastInsertRowid]));
});
app.put('/api/notes/:id', auth, (req, res) => {
  run('UPDATE notes SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.body.body, req.params.id]);
  res.json(one('SELECT * FROM notes WHERE id = ?', [req.params.id]));
});
app.delete('/api/notes/:id', auth, (req, res) => {
  run('DELETE FROM notes WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/analytics', auth, adminOnly, (req, res) => {
  const revenue = one('SELECT COALESCE(SUM(amount),0) total FROM expenses').total;
  res.json({
    tripsCreated: one('SELECT COUNT(*) count FROM trips').count,
    users: one('SELECT COUNT(*) count FROM users').count,
    activeTrips: one("SELECT COUNT(*) count FROM trips WHERE end_date >= date('now')").count,
    invoices: one('SELECT COUNT(*) count FROM invoices').count,
    revenue,
    topCities: all('SELECT city, COUNT(*) count FROM stops GROUP BY city ORDER BY count DESC LIMIT 8'),
    topActivities: all('SELECT title, COUNT(*) count FROM trip_activities GROUP BY title ORDER BY count DESC LIMIT 8'),
    auditLogs: all('SELECT audit_logs.*, users.name actor_name FROM audit_logs LEFT JOIN users ON users.id = audit_logs.actor_user_id ORDER BY audit_logs.created_at DESC LIMIT 20')
  });
});

app.get('/api/admin/staff', auth, adminOnly, (req, res) => {
  const staff = all(`
    SELECT users.id, users.name, users.email, users.photo_url, users.role, users.staff_status, users.privilege_notes, users.blocked, users.email_verified,
      COUNT(trips.id) trip_count
    FROM users LEFT JOIN trips ON trips.user_id = users.id
    GROUP BY users.id
    ORDER BY CASE users.role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, users.name
  `);
  res.json(staff.map((user) => ({ ...user, blocked: Boolean(user.blocked), email_verified: Boolean(user.email_verified) })));
});

app.put('/api/admin/staff/:id', auth, adminOnly, (req, res) => {
  const role = ['admin', 'staff', 'traveler'].includes(req.body.role) ? req.body.role : 'traveler';
  const status = ['active', 'suspended'].includes(req.body.staff_status) ? req.body.staff_status : 'active';
  run('UPDATE users SET role = ?, staff_status = ?, privilege_notes = ?, blocked = ? WHERE id = ?', [
    role,
    status,
    req.body.privilege_notes || '',
    Number(Boolean(req.body.blocked)),
    req.params.id
  ]);
  audit(req.user.id, 'admin.user_updated', 'user', req.params.id, { role, status, blocked: Boolean(req.body.blocked) });
  res.json(one('SELECT id, name, email, photo_url, role, staff_status, privilege_notes, blocked, email_verified FROM users WHERE id = ?', [req.params.id]));
});

app.get('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const user = one('SELECT id, name, email, photo_url, language, role, staff_status, privilege_notes, blocked, email_verified, created_at, last_login_at FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, blocked: Boolean(user.blocked), email_verified: Boolean(user.email_verified), trips: all('SELECT id, name, start_date, end_date FROM trips WHERE user_id = ? ORDER BY updated_at DESC', [req.params.id]) });
});

app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Admins cannot delete their own account here.' });
  run('DELETE FROM users WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'admin.user_deleted', 'user', req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/trips', auth, adminOnly, (_req, res) => {
  res.json(all('SELECT trips.*, users.name user_name, users.email user_email FROM trips JOIN users ON users.id = trips.user_id ORDER BY trips.updated_at DESC LIMIT 100'));
});

app.delete('/api/admin/trips/:id', auth, adminOnly, (req, res) => {
  run('DELETE FROM trips WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'admin.trip_deleted', 'trip', req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/community', auth, adminOnly, (_req, res) => {
  res.json(all('SELECT community_posts.*, users.name author FROM community_posts JOIN users ON users.id = community_posts.user_id ORDER BY community_posts.created_at DESC'));
});

app.put('/api/admin/community/:id', auth, adminOnly, (req, res) => {
  const status = ['published', 'removed', 'flagged'].includes(req.body.status) ? req.body.status : 'published';
  run('UPDATE community_posts SET status = ? WHERE id = ?', [status, req.params.id]);
  audit(req.user.id, 'admin.community_status_updated', 'community_post', req.params.id, { status });
  res.json(one('SELECT * FROM community_posts WHERE id = ?', [req.params.id]));
});

app.get('/api/admin/destinations', auth, adminOnly, (_req, res) => res.json(all('SELECT * FROM destinations ORDER BY featured DESC, popularity DESC')));
app.post('/api/admin/destinations', auth, adminOnly, validate(z.object({ city: safeText(2, 80), country: safeText(2, 80), region: safeText(2, 80), image_url: safeUrl, featured: z.boolean().optional(), cost_index: z.number().min(1).max(100), popularity: z.number().min(1).max(100) })), (req, res) => {
  const result = run('INSERT INTO destinations (city, country, region, image_url, featured, cost_index, popularity) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.body.city, req.body.country, req.body.region, req.body.image_url, Number(Boolean(req.body.featured)), req.body.cost_index, req.body.popularity]);
  audit(req.user.id, 'admin.destination_created', 'destination', result.lastInsertRowid);
  res.status(201).json(one('SELECT * FROM destinations WHERE id = ?', [result.lastInsertRowid]));
});

app.get('/api/admin/settings', auth, adminOnly, (_req, res) => res.json(all('SELECT key, value, updated_at FROM system_settings ORDER BY key')));
app.put('/api/admin/settings/:key', auth, adminOnly, validate(z.object({ value: safeText(1, 1000) })), (req, res) => {
  run('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [req.params.key, req.body.value]);
  audit(req.user.id, 'admin.setting_updated', 'system_setting', req.params.key);
  res.json(one('SELECT key, value, updated_at FROM system_settings WHERE key = ?', [req.params.key]));
});

app.get('/api/admin/feedback', auth, adminOnly, (_req, res) => res.json(all('SELECT feedback_reports.*, users.name user_name FROM feedback_reports LEFT JOIN users ON users.id = feedback_reports.user_id ORDER BY feedback_reports.created_at DESC')));

const port = process.env.PORT || 4100;
app.listen(port, () => console.log(`Traveloop API listening on http://localhost:${port}`));
