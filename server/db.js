import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'traveloop.sqlite');
const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });
const raw = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

function persist() {
  fs.writeFileSync(dbPath, Buffer.from(raw.export()));
}

function normalize(sql) {
  return sql;
}

export const db = {
  exec(sql) {
    raw.exec(normalize(sql));
    persist();
  },
  prepare(sql) {
    const statement = raw.prepare(normalize(sql));
    const paramsFrom = (args) => args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return {
      get(...args) {
        const params = paramsFrom(args);
        statement.bind(params);
        const row = statement.step() ? statement.getAsObject() : undefined;
        statement.free();
        return row;
      },
      all(...args) {
        const params = paramsFrom(args);
        statement.bind(params);
        const rows = [];
        while (statement.step()) rows.push(statement.getAsObject());
        statement.free();
        return rows;
      },
      run(...args) {
        const params = paramsFrom(args);
        raw.run(normalize(sql), params);
        const result = {
          lastInsertRowid: raw.exec('SELECT last_insert_rowid() AS id')[0]?.values?.[0]?.[0],
          changes: raw.getRowsModified()
        };
        persist();
        return result;
      }
    };
  }
};

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      photo_url TEXT,
      language TEXT DEFAULT 'en',
      saved_destinations TEXT DEFAULT '[]',
      role TEXT DEFAULT 'traveler',
      staff_status TEXT DEFAULT 'active',
      privilege_notes TEXT DEFAULT 'Can plan trips and manage personal travel data.',
      email_verified INTEGER DEFAULT 0,
      blocked INTEGER DEFAULT 0,
      reset_token TEXT,
      reset_token_expires TEXT,
      verification_token TEXT,
      last_login_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      cover_photo TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_public INTEGER DEFAULT 0,
      share_slug TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      region TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      type TEXT NOT NULL,
      cost REAL DEFAULT 0,
      duration_hours REAL DEFAULT 1,
      image_url TEXT,
      description TEXT,
      popularity INTEGER DEFAULT 70
    );

    CREATE TABLE IF NOT EXISTS trip_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      stop_id INTEGER NOT NULL,
      activity_id INTEGER,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'activity',
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT DEFAULT '09:00',
      cost REAL DEFAULT 0,
      duration_hours REAL DEFAULT 1,
      notes TEXT,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (stop_id) REFERENCES stops(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL UNIQUE,
      total_budget REAL DEFAULT 2500,
      transport REAL DEFAULT 0,
      stay REAL DEFAULT 0,
      activities REAL DEFAULT 0,
      meals REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      packed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      stop_id INTEGER,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (stop_id) REFERENCES stops(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      destination TEXT NOT NULL,
      caption TEXT NOT NULL,
      hashtags TEXT DEFAULT '',
      image_url TEXT NOT NULL,
      status TEXT DEFAULT 'published',
      likes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS community_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date TEXT NOT NULL,
      split_with TEXT DEFAULT '[]',
      receipt_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      invoice_number TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending',
      tax_rate REAL DEFAULT 5,
      discount REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      region TEXT NOT NULL,
      image_url TEXT NOT NULL,
      featured INTEGER DEFAULT 0,
      cost_index INTEGER DEFAULT 60,
      popularity INTEGER DEFAULT 70
    );

    CREATE TABLE IF NOT EXISTS feedback_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);
    CREATE INDEX IF NOT EXISTS idx_stops_trip_id ON stops(trip_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_trip_id ON expenses(trip_id);
    CREATE INDEX IF NOT EXISTS idx_posts_status_created ON community_posts(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);
  const columns = raw.exec('PRAGMA table_info(users)')[0]?.values?.map((column) => column[1]) || [];
  const addColumn = (name, definition) => {
    if (!columns.includes(name)) raw.run(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  };
  addColumn('role', "TEXT DEFAULT 'traveler'");
  addColumn('staff_status', "TEXT DEFAULT 'active'");
  addColumn('privilege_notes', "TEXT DEFAULT 'Can plan trips and manage personal travel data.'");
  addColumn('email_verified', 'INTEGER DEFAULT 0');
  addColumn('blocked', 'INTEGER DEFAULT 0');
  addColumn('reset_token', 'TEXT');
  addColumn('reset_token_expires', 'TEXT');
  addColumn('verification_token', 'TEXT');
  addColumn('last_login_at', 'TEXT');
  persist();
}

export const one = (sql, params = []) => db.prepare(sql).get(params);
export const all = (sql, params = []) => db.prepare(sql).all(params);
export const run = (sql, params = []) => db.prepare(sql).run(params);

export function toBool(row, keys = ['is_public', 'packed']) {
  if (!row) return row;
  const copy = { ...row };
  keys.forEach((key) => {
    if (key in copy) copy[key] = Boolean(copy[key]);
  });
  return copy;
}
