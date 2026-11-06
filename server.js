const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = { users: {}, usedImageHashes: [], withdrawals: [], reports: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: {}, usedImageHashes: [], withdrawals: [], reports: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// 1. OFFICIAL GOOGLE ADMOB SSV CALLBACK ROUTE (Returns 200 OK to AdMob)
app.all('/api/admob/ssv', (req, res) => {
  const { user_id, reward_amount } = req.query;
  console.log(`[ADMOB SSV] Received verification/reward ping from Google. User: ${user_id}`);
  if (user_id) {
    const db = loadDB();
    if (db.users[user_id]) {
      db.users[user_id].diamonds += parseInt(reward_amount) || 1;
      saveDB(db);
    }
  }
  return res.status(200).send("OK");
});

// 2. VPN & Proxy Security Middleware
app.use((req, res, next) => {
  if (req.headers['x-vpn-detected'] === 'true') {
    const userEmail = req.headers['x-user-email'];
    if (userEmail) {
      const db = loadDB();
      if (db.users[userEmail]) {
        db.users[userEmail].isBanned = true;
        db.users[userEmail].banReason = "VPN/Proxy connection detected.";
        saveDB(db);
      }
    }
    return res.status(403).json({ success: false, banned: true, message: "VPN prohibited." });
  }
  next();
});

// 3. User Login / Registration
app.post('/api/auth/login', (req, res) => {
  const { email, name } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: "Valid Gmail required." });
  }

  const db = loadDB();
  if (!db.users[email]) {
    db.users[email] = {
      email,
      name: name || email.split('@')[0],
      coins: 0,
      diamonds: 0,
      completedOffers: 0,
      dailyClaimed: false,
      isBanned: false
    };
    saveDB(db);
  }

  const user = db.users[email];
  if (user.isBanned) return res.status(403).json({ success: false, banned: true });

  res.json({ success: true, user });
});

// 4. Fetch User Profile
app.get('/api/user', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ success: false, message: "User not found." });
  res.json({ success: true, user });
});

// 5. Daily Check-in Bonus
app.post('/api/daily-checkin', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ success: false });

  user.coins += 50;
  user.dailyClaimed = true;
  saveDB(db);
  res.json({ success: true, coins: user.coins });
});

// 6. Screenshot Upload & Verification
app.post('/api/offer/submit-screenshot', (req, res) => {
  const email = req.headers['x-user-email'];
  const { screenshotBase64 } = req.body;
  const db = loadDB();
  const user = db.users[email];

  if (!user) return res.status(400).json({ success: false, message: "No active user." });

  const hash = crypto.createHash('sha256').update(screenshotBase64).digest('hex');
  if (db.usedImageHashes.includes(hash)) {
    user.isBanned = true;
    user.banReason = "Fraud Detected: Duplicate screenshot reused.";
    saveDB(db);
    return res.status(403).json({ success: false, banned: true, banReason: user.banReason });
  }

  db.usedImageHashes.push(hash);
  saveDB(db);
  res.json({ success: true, message: "Screenshot verified!" });
});

// 7. Wallet Withdrawals
app.post('/api/wallet/withdraw', (req, res) => {
  const email = req.headers['x-user-email'];
  const { method, amountRs, coinsRequired, destination } = req.body;
  const db = loadDB();
  const user = db.users[email];

  if (!user || user.coins < coinsRequired) {
    return res.status(400).json({ success: false, message: "Insufficient coins." });
  }

  user.coins -= coinsRequired;
  db.withdrawals.push({ email, method, amountRs, coinsDeducted: coinsRequired, destination, date: new Date().toISOString() });
  saveDB(db);

  res.json({ success: true, newCoins: user.coins });
});

// 8. Support Issue Report
app.post('/api/support/report', (req, res) => {
  const { subject, description } = req.body;
  const email = req.headers['x-user-email'];
  const db = loadDB();
  db.reports.push({ email, subject, description, date: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true, message: "Report submitted." });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
