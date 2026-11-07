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

// 1. Google AdMob SSV Route (Returns 200 OK to AdMob)
app.all('/api/admob/ssv', (req, res) => {
  const { user_id, reward_amount } = req.query;
  console.log(`[ADMOB SSV] Ping received for user: ${user_id}`);
  if (user_id) {
    const db = loadDB();
    if (db.users[user_id]) {
      db.users[user_id].diamonds += parseInt(reward_amount) || 1;
      saveDB(db);
    }
  }
  return res.status(200).send("OK");
});

// 2. User Authentication (Synced with Google Sign-In)
app.post('/api/auth/login', (req, res) => {
  const { email, name, avatar } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: "Valid Gmail required." });
  }

  const db = loadDB();
  if (!db.users[email]) {
    db.users[email] = {
      email,
      name: name || email.split('@')[0],
      avatar: avatar || "",
      coins: 0,
      diamonds: 0,
      completedOffers: 0,
      dailyClaimed: false
    };
    saveDB(db);
  } else if (avatar) {
    db.users[email].avatar = avatar;
    saveDB(db);
  }

  res.json({ success: true, user: db.users[email] });
});

// 3. Fetch User
app.get('/api/user', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ success: false, message: "User not found." });
  res.json({ success: true, user });
});

// 4. Daily Streak Bonus
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

// 5. Offer Completion
app.post('/api/offer/claim-reward', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];
  if (!user) return res.status(404).json({ success: false });

  user.coins += 1000;
  user.diamonds = 0;
  user.completedOffers = (user.completedOffers || 0) + 1;
  saveDB(db);
  res.json({ success: true, user });
});

// 6. Wallet Withdrawal with Instant ntfy Push Alert
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

  // Send Push Alert to your ntfy app
  fetch('https://ntfy.sh/quizpe_alerts_7891', {
    method: 'POST',
    body: `🚨 NEW WITHDRAWAL REQUEST!\n\n👤 User: ${email}\n💰 Method: ${method}\n💵 Amount: ₹${amountRs}\n🏦 Send To: ${destination}`
  }).catch(e => console.log('ntfy alert error:', e));

  res.json({ success: true, newCoins: user.coins, message: `Payout of ₹${amountRs} submitted!` });
});

// 7. Instant Test Notification Endpoint (Tap in browser to test ntfy)
app.get('/api/test-alert', (req, res) => {
  fetch('https://ntfy.sh/quizpe_alerts_7891', {
    method: 'POST',
    body: '🎉 Test Notification! Your QuizPe alert system is working 100%!'
  });
  res.send("Alert sent! Check your ntfy app now.");
});

// 8. Report an Issue
app.post('/api/support/report', (req, res) => {
  const { subject, description } = req.body;
  const email = req.headers['x-user-email'];
  const db = loadDB();
  db.reports.push({ email, subject, description, date: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true, message: "Report submitted." });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server active on port ${PORT}`);
});
