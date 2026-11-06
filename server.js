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

// VPN / Security Middleware
app.use((req, res, next) => {
  if (req.headers['x-vpn-detected'] === 'true') {
    const userEmail = req.headers['x-user-email'];
    if (userEmail) {
      const db = loadDB();
      if (db.users[userEmail]) {
        db.users[userEmail].isBanned = true;
        db.users[userEmail].banReason = "VPN/Proxy connection detected. Permanent suspension.";
        saveDB(db);
      }
    }
    return res.status(403).json({
      success: false,
      banned: true,
      message: "SECURITY LOCK: VPN/Proxy usage is prohibited."
    });
  }
  next();
});

// 1. Login / Register
app.post('/api/auth/login', (req, res) => {
  const { email, name } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: "Valid Gmail address required." });
  }

  const db = loadDB();
  if (!db.users[email]) {
    db.users[email] = {
      email,
      name: name || email.split('@')[0],
      coins: 0,
      diamonds: 0,
      dailyClaimed: false,
      isBanned: false,
      banReason: "",
      activeOffer: null
    };
    saveDB(db);
  }

  const user = db.users[email];
  if (user.isBanned) {
    return res.status(403).json({ success: false, banned: true, banReason: user.banReason });
  }

  res.json({ success: true, user });
});

// 2. Fetch User
app.get('/api/user', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];

  if (!user) return res.status(404).json({ success: false, message: "User not found." });
  if (user.isBanned) return res.status(403).json({ success: false, banned: true, banReason: user.banReason });

  res.json({ success: true, user });
});

// 3. Daily Bonus
app.post('/api/daily-checkin', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];

  if (!user || user.isBanned) return res.status(403).json({ success: false, banned: true });
  if (user.dailyClaimed) return res.status(400).json({ success: false, message: "Already claimed today!" });

  user.coins += 50;
  user.dailyClaimed = true;
  saveDB(db);
  res.json({ success: true, coins: user.coins });
});

// 4. Quiz Diamond Reward
app.post('/api/quiz-reward', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];

  if (!user || user.isBanned) return res.status(403).json({ success: false, banned: true });

  user.diamonds += 1;
  saveDB(db);
  res.json({ success: true, diamonds: user.diamonds });
});

// 5. Start Dynamic App Task
app.post('/api/offer/start', (req, res) => {
  const email = req.headers['x-user-email'];
  const { appName, packageName, appIcon } = req.body;
  const db = loadDB();
  const user = db.users[email];

  if (!user || user.isBanned) return res.status(403).json({ success: false, banned: true });

  user.activeOffer = {
    appName: appName || "Lenskart : Eyeglasses & More",
    packageName: packageName || "com.lenskart.app",
    appIcon: appIcon || "fa-glasses",
    installedAt: Date.now(),
    milestones: {
      step1_install: { title: "Initial Install Reward", desc: "Install app and meet usage requirement", coins: 100, status: "approved" },
      step2_screenshot: { title: "Immediate", desc: "Sign up in the app & take a screenshot & upload screenshot", coins: 350, status: "pending_upload", screenshotProof: null },
      step3_3h: { title: "After 3h 6m", desc: "Use app for 1 more minutes", coins: 100, status: "locked" },
      step4_5h: { title: "After 4h 53m", desc: "Use app for 1 more minutes", coins: 100, status: "locked" },
      step5_10h: { title: "After 9h 53m", desc: "Use app for 1 more minutes", coins: 25, status: "locked" },
      step6_24h: { title: "After 24h 53m", desc: "Use app for 5 more minutes", coins: 200, status: "locked" },
      step7_bonus: { title: "🎁 Bonus • After 30h 0m", desc: "Use app for 12 more minutes", coins: 150, status: "locked" }
    }
  };

  user.coins += 100; // Immediate 100 coins for initial install
  saveDB(db);
  res.json({ success: true, activeOffer: user.activeOffer, newCoins: user.coins });
});

// 6. Submit Screenshot Proof
app.post('/api/offer/submit-screenshot', (req, res) => {
  const email = req.headers['x-user-email'];
  const { screenshotBase64 } = req.body;
  const db = loadDB();
  const user = db.users[email];

  if (!user || !user.activeOffer) return res.status(400).json({ success: false, message: "No active offer." });

  const hash = crypto.createHash('sha256').update(screenshotBase64).digest('hex');
  if (db.usedImageHashes.includes(hash)) {
    user.isBanned = true;
    user.banReason = "Fraud Detected: Attempted to submit a duplicate screenshot.";
    saveDB(db);
    return res.status(403).json({ success: false, banned: true, banReason: user.banReason });
  }

  db.usedImageHashes.push(hash);
  user.activeOffer.milestones.step2_screenshot.status = "pending_review";
  user.activeOffer.milestones.step2_screenshot.screenshotProof = hash;
  saveDB(db);

  res.json({ success: true, message: "Screenshot submitted for review!" });
});

// 7. Admin Screenshot Approval (+350 Coins)
app.post('/api/offer/approve-screenshot', (req, res) => {
  const email = req.headers['x-user-email'];
  const db = loadDB();
  const user = db.users[email];

  if (user && user.activeOffer && user.activeOffer.milestones.step2_screenshot.status === "pending_review") {
    user.activeOffer.milestones.step2_screenshot.status = "approved";
    user.coins += 350;
    saveDB(db);
    return res.json({ success: true, coins: user.coins });
  }
  res.status(400).json({ success: false });
});

// 8. Claim Milestone
app.post('/api/offer/claim-milestone', (req, res) => {
  const email = req.headers['x-user-email'];
  const { milestoneKey } = req.body;
  const db = loadDB();
  const user = db.users[email];

  if (!user || !user.activeOffer) return res.status(400).json({ success: false });

  const m = user.activeOffer.milestones[milestoneKey];
  if (m && m.status !== "approved") {
    m.status = "approved";
    user.coins += m.coins;
    saveDB(db);
    return res.json({ success: true, coins: user.coins });
  }
  res.status(400).json({ success: false });
});

// 9. Wallet Withdrawal
app.post('/api/wallet/withdraw', (req, res) => {
  const email = req.headers['x-user-email'];
  const { method, amountRs, coinsRequired, destination } = req.body;
  const db = loadDB();
  const user = db.users[email];

  if (!user || user.isBanned) return res.status(403).json({ success: false, banned: true });
  if (user.coins < coinsRequired) {
    return res.status(400).json({ success: false, message: `Insufficient coins. Need ${coinsRequired} coins.` });
  }

  user.coins -= coinsRequired;
  db.withdrawals.push({ email, method, amountRs, coinsDeducted: coinsRequired, destination, date: new Date().toISOString() });
  saveDB(db);

  res.json({ success: true, newCoins: user.coins, message: `Payout of ₹${amountRs} submitted!` });
});

// 10. Issue Report
app.post('/api/support/report', (req, res) => {
  const { subject, description } = req.body;
  const email = req.headers['x-user-email'];
  const db = loadDB();
  db.reports.push({ email, subject, description, date: new Date().toISOString() });
  saveDB(db);
  res.json({ success: true, message: "Report submitted." });
});

app.listen(PORT, () => {
  console.log(`Server active on port ${PORT}`);
});
