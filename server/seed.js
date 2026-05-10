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

console.log('Seeded Traveloop. Demo login: mira@traveloop.test / traveloop123. Admin login: admin@traveloop.test / admin12345');
