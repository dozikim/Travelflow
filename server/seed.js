import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { activities as activitySeed } from './catalog.js';
import { db, migrate, one, run } from './db.js';

migrate();

const passwordHash = await bcrypt.hash('traveloop123', 10);
const adminHash = await bcrypt.hash('admin12345', 10);
let admin = one('SELECT * FROM users WHERE email = ?', ['admin@traveloop.test']);
if (!admin) {
  const createdAdmin = run('INSERT INTO users (name, email, password_hash, language, saved_destinations, role, staff_status, privilege_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    'Ava Admin',
    'admin@traveloop.test',
    adminHash,
    'en',
    JSON.stringify(['Paris', 'Rome', 'Kyoto']),
    'admin',
    'active',
    'Full admin access: manage staff, view analytics, moderate users, and inspect all travel operations.'
  ]);
  admin = one('SELECT * FROM users WHERE id = ?', [createdAdmin.lastInsertRowid]);
}
run('UPDATE users SET email_verified = 1, blocked = 0 WHERE email = ?', ['admin@traveloop.test']);

const staffSeed = [
  ['James Operations', 'james.staff@traveloop.test', 'staff', 'Can manage community posts, invoices, and trip support queues.'],
  ['Cristina Support', 'cristina.staff@traveloop.test', 'staff', 'Can help users with itinerary edits, checklist support, and billing questions.']
];
for (const [name, email, role, privilege] of staffSeed) {
  if (!one('SELECT * FROM users WHERE email = ?', [email])) {
    run('INSERT INTO users (name, email, password_hash, language, saved_destinations, role, staff_status, privilege_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      name,
      email,
      passwordHash,
      'en',
      '[]',
      role,
      'active',
      privilege
    ]);
  }
  run('UPDATE users SET email_verified = 1, blocked = 0 WHERE email = ?', [email]);
}

let user = one('SELECT * FROM users WHERE email = ?', ['mira@traveloop.test']);
if (!user) {
  const created = run('INSERT INTO users (name, email, password_hash, language, saved_destinations, role, staff_status, privilege_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    'Mira Shah',
    'mira@traveloop.test',
    passwordHash,
    'en',
    JSON.stringify(['Lisbon', 'Kyoto']),
    'traveler',
    'active',
    'Traveler access: create trips, manage personal itineraries, budgets, notes, and packing lists.'
  ]);
  user = one('SELECT * FROM users WHERE id = ?', [created.lastInsertRowid]);
}
run('UPDATE users SET email_verified = 1, blocked = 0 WHERE email = ?', ['mira@traveloop.test']);

let trip = one('SELECT * FROM trips WHERE user_id = ? AND name = ?', [user.id, 'Autumn Portugal Loop']);
if (!trip) {
  const createdTrip = run('INSERT INTO trips (user_id, name, description, cover_photo, start_date, end_date, is_public, share_slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    user.id,
    'Autumn Portugal Loop',
    'Slow mornings, coastal trains, tile workshops, and neighborhood dinners.',
    'https://images.unsplash.com/photo-1548707309-dcebeab9ea9b?auto=format&fit=crop&w=1400&q=80',
    '2026-10-04',
    '2026-10-12',
    1,
    crypto.randomBytes(5).toString('hex')
  ]);
  trip = one('SELECT * FROM trips WHERE id = ?', [createdTrip.lastInsertRowid]);
  run('INSERT INTO budgets (trip_id, total_budget, transport, stay, activities, meals) VALUES (?, ?, ?, ?, ?, ?)', [trip.id, 3200, 820, 1100, 620, 470]);

  const lisbon = run('INSERT INTO stops (trip_id, city, country, region, start_date, end_date, position, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [trip.id, 'Lisbon', 'Portugal', 'Europe', '2026-10-04', '2026-10-08', 0, 'Base in Alfama.']);
  const porto = run('INSERT INTO stops (trip_id, city, country, region, start_date, end_date, position, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [trip.id, 'Porto', 'Portugal', 'Europe', '2026-10-08', '2026-10-12', 1, 'Train north after breakfast.']);
  run('INSERT INTO trip_activities (trip_id, stop_id, title, type, scheduled_date, scheduled_time, cost, duration_hours, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [trip.id, lisbon.lastInsertRowid, 'Tile atelier walk', 'culture', '2026-10-05', '10:00', 42, 2.5, 'Book small group.']);
  run('INSERT INTO trip_activities (trip_id, stop_id, title, type, scheduled_date, scheduled_time, cost, duration_hours, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [trip.id, porto.lastInsertRowid, 'Douro tasting afternoon', 'food', '2026-10-09', '15:00', 88, 4, 'Riverfront pickup.']);
  ['Passport', 'Travel insurance', 'Linen shirts', 'USB-C charger', 'Walking shoes'].forEach((label, index) => run('INSERT INTO checklist_items (trip_id, category, label, packed) VALUES (?, ?, ?, ?)', [trip.id, index < 2 ? 'documents' : index === 3 ? 'electronics' : 'clothing', label, index === 0 ? 1 : 0]));
  run('INSERT INTO notes (trip_id, body) VALUES (?, ?)', [trip.id, 'Try to keep the first morning intentionally unscheduled.']);
}

if (one('SELECT COUNT(*) as count FROM activities').count === 0) {
  const insert = db.prepare('INSERT INTO activities (name, city, country, type, cost, duration_hours, image_url, description, popularity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  activitySeed.forEach(([name, city, country, type, cost, duration, description], index) => insert.run(name, city, country, type, cost, duration, 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', description, 85 + index));
}

const destinations = [
  ['Paris', 'France', 'Europe', 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=80', 1, 76, 98],
  ['Maldives', 'Maldives', 'Asia', 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?auto=format&fit=crop&w=1200&q=80', 1, 84, 96],
  ['Dubai', 'United Arab Emirates', 'Middle East', 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1200&q=80', 1, 88, 93],
  ['Zermatt', 'Switzerland', 'Europe', 'https://images.unsplash.com/photo-1500043357865-c6b8827edf10?auto=format&fit=crop&w=1200&q=80', 1, 92, 91],
  ['Tokyo', 'Japan', 'Asia', 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=80', 1, 80, 97]
];
for (const destination of destinations) {
  if (!one('SELECT id FROM destinations WHERE city = ?', [destination[0]])) {
    run('INSERT INTO destinations (city, country, region, image_url, featured, cost_index, popularity) VALUES (?, ?, ?, ?, ?, ?, ?)', destination);
  }
}

const communityPosts = [
  ['Paris', 'Sunset walk from Trocadero to the Seine. The Eiffel Tower view is worth the slow route.', '#paris #citywalk', 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=900&q=80'],
  ['Maldives', 'A reef morning, coconut lunch, and a boat ride that felt impossibly calm.', '#maldives #beach', 'https://images.unsplash.com/photo-1573843981267-be1999ff37cd?auto=format&fit=crop&w=900&q=80'],
  ['Tokyo', 'Neon lanes after ramen in Shinjuku. Save this for a late-night itinerary stop.', '#tokyo #neon', 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=900&q=80']
];
for (const [destination, caption, hashtags, image] of communityPosts) {
  if (!one('SELECT id FROM community_posts WHERE caption = ?', [caption])) {
    run('INSERT INTO community_posts (user_id, destination, caption, hashtags, image_url, likes) VALUES (?, ?, ?, ?, ?, ?)', [user.id, destination, caption, hashtags, image, 12]);
  }
}

if (trip && one('SELECT COUNT(*) count FROM expenses WHERE trip_id = ?', [trip.id]).count === 0) {
  [
    ['hotel', 'Lisbon boutique hotel', 900, '2026-10-04'],
    ['transport', 'Delhi to Lisbon flight', 1200, '2026-10-03'],
    ['food', 'Fado supper club', 78, '2026-10-05'],
    ['activities', 'Tile atelier walk', 42, '2026-10-05']
  ].forEach(([category, description, amount, date]) => run('INSERT INTO expenses (trip_id, user_id, category, description, amount, expense_date, split_with) VALUES (?, ?, ?, ?, ?, ?, ?)', [trip.id, user.id, category, description, amount, date, JSON.stringify(['Mira'])]));
}

if (trip && !one('SELECT id FROM invoices WHERE trip_id = ?', [trip.id])) {
  run('INSERT INTO invoices (trip_id, user_id, invoice_number, tax_rate, discount) VALUES (?, ?, ?, ?, ?)', [trip.id, user.id, `INV-${Date.now().toString(36).toUpperCase()}`, 5, 50]);
}

console.log('Seeded Traveloop. Demo login: mira@traveloop.test / traveloop123. Admin login: admin@traveloop.test / admin12345');
