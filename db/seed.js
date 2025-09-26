// Simple DB seed/reset script for SQLite
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('attendance.db');

const args = process.argv.slice(2);
const isReset = args.includes('--reset');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function main() {
  try {
    if (isReset) {
      console.log('Resetting database...');
      await run('DROP TABLE IF EXISTS attendance');
      await run('DROP TABLE IF EXISTS users');
      await run('DROP TABLE IF EXISTS office_locations');
    }

    // Create tables (same as server.js)
    await run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(`CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      check_in_time DATETIME,
      check_out_time DATETIME,
      latitude REAL,
      longitude REAL,
      location_name TEXT,
      status TEXT DEFAULT 'present',
      date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS office_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius INTEGER DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert default office location from env
    const name = process.env.OFFICE_NAME || 'Presidency University, Bangalore';
    const lat = parseFloat(process.env.OFFICE_LAT || '13.1373');
    const lng = parseFloat(process.env.OFFICE_LNG || '77.5680');
    const radius = parseInt(process.env.OFFICE_RADIUS || '150', 10);

    await run(
      `INSERT OR IGNORE INTO office_locations (id, name, latitude, longitude, radius)
       VALUES ('default-office', ?, ?, ?, ?)`,
      [name, lat, lng, radius]
    );

    // Also add a friendly-named ID for convenience
    await run(
      `INSERT OR IGNORE INTO office_locations (id, name, latitude, longitude, radius)
       VALUES ('presidency-university', ?, ?, ?, ?)`,
      [name, lat, lng, radius]
    );

    // Seed admin if provided
    const adminUser = process.env.SEED_ADMIN_USERNAME;
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPass = process.env.SEED_ADMIN_PASSWORD;

    if (adminUser && adminEmail && adminPass) {
      const existing = await get('SELECT id FROM users WHERE username = ? OR email = ?', [adminUser, adminEmail]);
      if (!existing) {
        const hashed = await bcrypt.hash(adminPass, 10);
        const { v4: uuidv4 } = require('uuid');
        const id = uuidv4();
        await run('INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)', [id, adminUser, adminEmail, hashed, 'admin']);
        console.log('Seeded admin user:', adminUser);
      } else {
        console.log('Admin user already exists, skipping seed');
      }
    }

    // Seed 100 student users (idempotent via INSERT OR IGNORE on unique username/email)
    console.log('Seeding 100 student accounts...');
    const defaultStudentPassword = process.env.SEED_STUDENT_PASSWORD || 'Student@123';
    const studentHash = await bcrypt.hash(defaultStudentPassword, 10);
    const { v4: uuidv4_2 } = require('uuid');
    for (let i = 1; i <= 100; i++) {
      const idx = i.toString().padStart(3, '0');
      const u = `student${idx}`;
      const e = `student${idx}@example.com`;
      // Insert OR IGNORE by trying to insert; if unique violation is ignored, proceed
      try {
        await run('INSERT OR IGNORE INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)', [uuidv4_2(), u, e, studentHash, 'student']);
      } catch (e) {
        // ignore individual failures to keep process going
      }
    }

    console.log('Database seed completed.');
    process.exit(0);
  } catch (err) {
    console.error('Database seed failed:', err.message);
    process.exit(1);
  }
}

main();
