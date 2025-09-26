require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-in-production';
// Office location configuration (defaults to Presidency University, Bangalore)
const OFFICE_ID = 'default-office';
const OFFICE_NAME = process.env.OFFICE_NAME || 'Presidency University, Bangalore';
const OFFICE_LAT = parseFloat(process.env.OFFICE_LAT || '13.1373');
const OFFICE_LNG = parseFloat(process.env.OFFICE_LNG || '77.5680');
const OFFICE_RADIUS = parseInt(process.env.OFFICE_RADIUS || '150', 10); // meters

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialize SQLite database
const db = new sqlite3.Database('attendance.db');

// Middleware to verify JWT token (must be defined before routes use it)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Authorization middleware for role-based access
function authorizeRoles(allowedRoles = []) {
  return (req, res, next) => {
    try {
      const role = req.user?.role?.toLowerCase?.();
      if (!role) return res.status(403).json({ error: 'Role not found in token' });
      if (allowedRoles.length && !allowedRoles.includes(role)) {
        return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
      }
      next();
    } catch (e) {
      return res.status(403).json({ error: 'Authorization failed' });
    }
  };
}

// Create tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'student',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Attendance records table
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
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

  // Office locations table
  db.run(`CREATE TABLE IF NOT EXISTS office_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    radius INTEGER DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default office location
  db.run(`INSERT OR IGNORE INTO office_locations (id, name, latitude, longitude, radius) 
          VALUES (?, ?, ?, ?, ?)`,
    [OFFICE_ID, OFFICE_NAME, OFFICE_LAT, OFFICE_LNG, OFFICE_RADIUS]
  );
});

// Public endpoint to get the default office (Presidency University) coordinates
app.get('/api/office', (req, res) => {
  db.get('SELECT * FROM office_locations WHERE id = ?', [OFFICE_ID], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'Failed to load office' });
    res.json(row);
  });
});

// Faculty view: attendance status for all users for a given date
app.get('/api/faculty/attendance/status', authenticateToken, authorizeRoles(['faculty']), (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const sql = `
    SELECT u.id as userId, u.username, u.email, u.role,
           a.check_in_time as checkInTime, a.check_out_time as checkOutTime
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id AND a.date = ?
    ORDER BY u.username COLLATE NOCASE ASC`;
  db.all(sql, [date], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch faculty status' });
    const result = rows.map(r => ({
      userId: r.userId,
      username: r.username,
      email: r.email,
      role: r.role,
      checkedIn: !!r.checkInTime,
      checkedOut: !!r.checkOutTime,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
      date
    }));
    res.json(result);
  });
});

// -------- Location Management (CRUD + Nearest) --------
// List locations
app.get('/api/locations', authenticateToken, (req, res) => {
  db.all('SELECT * FROM office_locations ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch locations' });
    res.json(rows);
  });
});

// Create location (admin only)
app.post('/api/locations', authenticateToken, authorizeRoles(['admin']), (req, res) => {
  const { name, latitude, longitude, radius } = req.body;
  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'name, latitude, longitude are required' });
  }
  const id = uuidv4();
  db.run(
    `INSERT INTO office_locations (id, name, latitude, longitude, radius) VALUES (?, ?, ?, ?, ?)`,
    [id, name, latitude, longitude, radius || 100],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create location' });
      res.status(201).json({ id, name, latitude, longitude, radius: radius || 100 });
    }
  );
});

// Update location (admin only)
app.put('/api/locations/:id', authenticateToken, authorizeRoles(['admin']), (req, res) => {
  const { id } = req.params;
  const { name, latitude, longitude, radius } = req.body;
  db.run(
    `UPDATE office_locations SET name = COALESCE(?, name), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), radius = COALESCE(?, radius) WHERE id = ?`,
    [name, latitude, longitude, radius, id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update location' });
      if (this.changes === 0) return res.status(404).json({ error: 'Location not found' });
      res.json({ message: 'Location updated' });
    }
  );
});

// Delete location (admin only)
app.delete('/api/locations/:id', authenticateToken, authorizeRoles(['admin']), (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM office_locations WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to delete location' });
    if (this.changes === 0) return res.status(404).json({ error: 'Location not found' });
    res.json({ message: 'Location deleted' });
  });
});

// Nearest locations
app.get('/api/locations/nearest', authenticateToken, (req, res) => {
  const { lat, lng, limit } = req.query;
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  const max = parseInt(limit || '5', 10);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return res.status(400).json({ error: 'lat and lng are required numeric query params' });
  }
  db.all('SELECT * FROM office_locations', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch locations' });
    const withDistance = rows.map(r => ({
      ...r,
      distance: Math.round(calculateDistance(latitude, longitude, r.latitude, r.longitude))
    }));
    withDistance.sort((a, b) => a.distance - b.distance);
    res.json(withDistance.slice(0, max));
  });
});

// -------- Employee (User) Management --------
// List users (faculty/admin can view, admin can manage all)
app.get('/api/employees', authenticateToken, authorizeRoles(['admin', 'faculty']), (req, res) => {
  db.all('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch users' });
    res.json(rows);
  });
});

// Create user (admin)
app.post('/api/employees', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
    const normalizedRole = (role || 'student').toLowerCase();
    if (!['student', 'faculty', 'admin'].includes(normalizedRole)) return res.status(400).json({ error: 'Invalid role' });
    const hashed = await bcrypt.hash(password, 10);
    const id = uuidv4();
    db.run('INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)', [id, username, email, hashed, normalizedRole], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'Username or email exists' });
        return res.status(500).json({ error: 'Failed to create user' });
      }
      res.status(201).json({ id, username, email, role: normalizedRole });
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (admin)
app.put('/api/employees/:id', authenticateToken, authorizeRoles(['admin']), async (req, res) => {
  const { id } = req.params;
  const { username, email, password, role } = req.body;
  const updates = [];
  const params = [];
  if (username) { updates.push('username = ?'); params.push(username); }
  if (email) { updates.push('email = ?'); params.push(email); }
  if (role) { updates.push('role = ?'); params.push(role.toLowerCase()); }
  if (password) {
    try {
      const hashed = await bcrypt.hash(password, 10);
      updates.push('password = ?');
      params.push(hashed);
    } catch (e) { return res.status(500).json({ error: 'Failed to hash password' }); }
  }
  if (!updates.length) return res.status(400).json({ error: 'No updates provided' });
  params.push(id);
  db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
    if (err) return res.status(500).json({ error: 'Failed to update user' });
    if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User updated' });
  });
});

// Delete user (admin)
app.delete('/api/employees/:id', authenticateToken, authorizeRoles(['admin']), (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to delete user' });
    if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  });
});


// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Routes

// Serve the main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// User registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const normalizedRole = (role || 'student').toLowerCase();
    if (!['student', 'faculty', 'admin'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role. Use student or faculty.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    db.run(
      'INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [userId, username, email, hashedPassword, normalizedRole],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username or email already exists' });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }
        
        const token = jwt.sign({ userId, username, email, role: normalizedRole }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: userId, username, email, role: normalizedRole } });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get(
    'SELECT * FROM users WHERE username = ? OR email = ?',
    [username, username],
    async (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    }
  );
});

// Check in
app.post('/api/checkin', authenticateToken, authorizeRoles(['student']), (req, res) => {
  const { latitude, longitude, locationName } = req.body;
  const userId = req.user.userId;
  const today = new Date().toISOString().split('T')[0];

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Location coordinates are required' });
  }

  // Check if user already checked in today
  db.get(
    'SELECT * FROM attendance WHERE user_id = ? AND date = ? AND check_in_time IS NOT NULL',
    [userId, today],
    (err, existingRecord) => {
      if (err) {
        return res.status(500).json({ error: 'Check-in failed' });
      }

      if (existingRecord) {
        return res.status(400).json({ error: 'Already checked in today' });
      }

      // Verify location is within radius of the nearest office location
      db.all('SELECT * FROM office_locations', [], (err, rows) => {
        if (err) {
          return res.status(500).json({ error: 'Location verification failed' });
        }
        if (!rows || !rows.length) {
          return res.status(500).json({ error: 'No office locations configured' });
        }
        // Find nearest office
        let nearest = null;
        let minDist = Number.POSITIVE_INFINITY;
        for (const r of rows) {
          const d = calculateDistance(latitude, longitude, r.latitude, r.longitude);
          if (d < minDist) { minDist = d; nearest = r; }
        }
        const allowed = nearest?.radius ?? 100;
        if (minDist > allowed) {
          return res.status(400).json({
            error: 'You are not within the office location radius',
            distance: Math.round(minDist),
            allowedRadius: allowed
          });
        }

        // Create attendance record
        const attendanceId = uuidv4();
        const checkInTime = new Date().toISOString();

        db.run(
          `INSERT INTO attendance (id, user_id, check_in_time, latitude, longitude, location_name, date) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [attendanceId, userId, checkInTime, latitude, longitude, nearest?.name || locationName || 'Office', today],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Check-in failed' });
            }

            res.json({
              message: 'Checked in successfully',
              checkInTime,
              location: nearest?.name || locationName || 'Office',
              distance: Math.round(minDist)
            });
          }
        );
      });
    }
  );
});

// Check out
app.post('/api/checkout', authenticateToken, authorizeRoles(['student']), (req, res) => {
  const { latitude, longitude } = req.body;
  const userId = req.user.userId;
  const today = new Date().toISOString().split('T')[0];

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Location coordinates are required' });
  }

  // Find today's attendance record
  db.get(
    'SELECT * FROM attendance WHERE user_id = ? AND date = ? AND check_in_time IS NOT NULL AND check_out_time IS NULL',
    [userId, today],
    (err, record) => {
      if (err) {
        return res.status(500).json({ error: 'Check-out failed' });
      }

      if (!record) {
        return res.status(400).json({ error: 'No check-in record found for today' });
      }

      const checkOutTime = new Date().toISOString();

      db.run(
        'UPDATE attendance SET check_out_time = ? WHERE id = ?',
        [checkOutTime, record.id],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Check-out failed' });
          }

          res.json({ 
            message: 'Checked out successfully',
            checkOutTime,
            totalHours: ((new Date(checkOutTime) - new Date(record.check_in_time)) / (1000 * 60 * 60)).toFixed(2)
          });
        }
      );
    }
  );
});

// Get attendance records
app.get('/api/attendance', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { startDate, endDate } = req.query;

  let query = 'SELECT * FROM attendance WHERE user_id = ?';
  let params = [userId];

  if (startDate && endDate) {
    query += ' AND date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  query += ' ORDER BY date DESC, check_in_time DESC';

  db.all(query, params, (err, records) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch attendance records' });
    }

    res.json(records);
  });
});

// Attendance summary (total hours) over a date range
app.get('/api/attendance/summary', authenticateToken, (req, res) => {
  const userId = req.query.userId || req.user.userId;
  const { startDate, endDate } = req.query;

  let query = `SELECT date, check_in_time, check_out_time FROM attendance WHERE user_id = ?`;
  const params = [userId];
  if (startDate && endDate) {
    query += ' AND date BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to compute summary' });
    let totalMs = 0;
    rows.forEach(r => {
      if (r.check_in_time && r.check_out_time) {
        totalMs += (new Date(r.check_out_time) - new Date(r.check_in_time));
      }
    });
    res.json({
      userId,
      startDate: startDate || null,
      endDate: endDate || null,
      totalHours: +(totalMs / (1000 * 60 * 60)).toFixed(2),
      daysCount: rows.length
    });
  });
});

// Get today's status
app.get('/api/status', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const today = new Date().toISOString().split('T')[0];

  db.get(
    'SELECT * FROM attendance WHERE user_id = ? AND date = ?',
    [userId, today],
    (err, record) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch status' });
      }

      const status = {
        date: today,
        checkedIn: !!record?.check_in_time,
        checkedOut: !!record?.check_out_time,
        checkInTime: record?.check_in_time,
        checkOutTime: record?.check_out_time,
        location: record?.location_name
      };

      res.json(status);
    }
  );
});

// Start server
app.listen(PORT, () => {
  console.log(`Attendance tracking server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to access the application`);
});
