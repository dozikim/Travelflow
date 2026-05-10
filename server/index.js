import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { activities as activitySeed, cities } from './catalog.js';
import { adminOnly, auth, sign } from './auth.js';
import { all, db, migrate, one, run, toBool } from './db.js';

migrate();

if (one('SELECT COUNT(*) as count FROM activities').count === 0) {
  const insert = db.prepare('INSERT INTO activities (name, city, country, type, cost, duration_hours, image_url, description, popularity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  activitySeed.forEach(([name, city, country, type, cost, duration, description], index) => {
    insert.run(name, city, country, type, cost, duration, cities[index % cities.length].image, description, 80 + (index % 18));
  });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

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

app.post('/api/auth/signup', async (req, res) => {
  const parsed = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Use a valid name, email, and 8+ character password.' });
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  try {
    const result = run('INSERT INTO users (name, email, password_hash, role, staff_status, privilege_notes) VALUES (?, ?, ?, ?, ?, ?)', [parsed.data.name, parsed.data.email.toLowerCase(), passwordHash, 'traveler', 'active', 'Can plan trips and manage personal travel data.']);
    const user = one('SELECT id, name, email, photo_url, language, saved_destinations, role, staff_status, privilege_notes FROM users WHERE id = ?', [result.lastInsertRowid]);
    user.saved_destinations = [];
    res.json({ token: sign(user), user });
  } catch {
    res.status(409).json({ error: 'An account with this email already exists.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Email and password are required.' });
  const record = one('SELECT * FROM users WHERE email = ?', [parsed.data.email.toLowerCase()]);
  if (!record || !(await bcrypt.compare(parsed.data.password, record.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
  const user = { id: record.id, name: record.name, email: record.email, photo_url: record.photo_url, language: record.language, saved_destinations: JSON.parse(record.saved_destinations || '[]'), role: record.role || 'traveler', staff_status: record.staff_status || 'active', privilege_notes: record.privilege_notes || 'Can plan trips and manage personal travel data.' };
  res.json({ token: sign(user), user });
});

app.post('/api/auth/forgot', (req, res) => {
  res.json({ message: `If ${req.body.email || 'that email'} exists, a reset link has been queued.` });
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
  const user = one('SELECT id, name, email, photo_url, language, saved_destinations, role, staff_status, privilege_notes FROM users WHERE id = ?', [req.user.id]);
  user.saved_destinations = JSON.parse(user.saved_destinations || '[]');
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
  res.json({
    tripsCreated: one('SELECT COUNT(*) count FROM trips').count,
    users: one('SELECT COUNT(*) count FROM users').count,
    topCities: all('SELECT city, COUNT(*) count FROM stops GROUP BY city ORDER BY count DESC LIMIT 8'),
    topActivities: all('SELECT title, COUNT(*) count FROM trip_activities GROUP BY title ORDER BY count DESC LIMIT 8')
  });
});

app.get('/api/admin/staff', auth, adminOnly, (req, res) => {
  const staff = all(`
    SELECT users.id, users.name, users.email, users.photo_url, users.role, users.staff_status, users.privilege_notes,
      COUNT(trips.id) trip_count
    FROM users LEFT JOIN trips ON trips.user_id = users.id
    GROUP BY users.id
    ORDER BY CASE users.role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, users.name
  `);
  res.json(staff);
});

app.put('/api/admin/staff/:id', auth, adminOnly, (req, res) => {
  const role = ['admin', 'staff', 'traveler'].includes(req.body.role) ? req.body.role : 'traveler';
  const status = ['active', 'suspended'].includes(req.body.staff_status) ? req.body.staff_status : 'active';
  run('UPDATE users SET role = ?, staff_status = ?, privilege_notes = ? WHERE id = ?', [
    role,
    status,
    req.body.privilege_notes || '',
    req.params.id
  ]);
  res.json(one('SELECT id, name, email, photo_url, role, staff_status, privilege_notes FROM users WHERE id = ?', [req.params.id]));
});

const port = process.env.PORT || 4100;
app.listen(port, () => console.log(`Traveloop API listening on http://localhost:${port}`));
