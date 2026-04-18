// ================================================================
// SwiftSMS API — Final Production Server
// Render (backend) + Vercel (frontend dashboard)
// ================================================================
require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto    = require('crypto');
const twilio    = require('twilio');

const app = express();

// ================================================================
// TWILIO CLIENT
// ================================================================
let twilioClient = null;

function getTwilioClient() {
  if (!twilioClient) {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials missing in environment variables.');
    }
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return twilioClient;
}

const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;

// ================================================================
// MIDDLEWARE
// ================================================================
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: '*', // Allow Vercel frontend + RapidAPI
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limit — per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Try again in 15 minutes.' }
}));

// Per-API-key rate limit for SMS sending
const smsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  message: { success: false, error: 'SMS rate limit exceeded. Max 60/minute.' }
});

// ================================================================
// IN-MEMORY DATABASE
// For production upgrade to MongoDB:
//   npm install mongoose
//   mongoose.connect(process.env.MONGO_URI)
// ================================================================
const DB = {
  users:    {},
  messages: [],
};

// ================================================================
// PLANS
// ================================================================
const PLANS = {
  free:     { credits: 10,    priceUSD: 0,  rateLimit: 5    },
  starter:  { credits: 500,   priceUSD: 9,  rateLimit: 50   },
  pro:      { credits: 5000,  priceUSD: 29, rateLimit: 500  },
  business: { credits: 50000, priceUSD: 99, rateLimit: 5000 },
};

// Seed demo user
const DEMO_API_KEY = process.env.DEMO_API_KEY || 'sms_demo_key_000000';
DB.users[DEMO_API_KEY] = {
  id:        'user_demo',
  name:      'Demo User',
  email:     'demo@swiftsms.dev',
  plan:      'pro',
  credits:   5000,
  used:      0,
  createdAt: new Date().toISOString(),
};

// ================================================================
// KEEP-ALIVE — Prevents Render free tier from sleeping
// Pings itself every 10 minutes
// ================================================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_URL;

function startKeepAlive() {
  if (!RENDER_URL) {
    console.log('⚠️  RENDER_EXTERNAL_URL not set — keep-alive disabled');
    return;
  }
  setInterval(async () => {
    try {
      const res = await fetch(`${RENDER_URL}/ping`);
      console.log(`[KeepAlive] Pinged at ${new Date().toISOString()} — status: ${res.status}`);
    } catch (err) {
      console.warn('[KeepAlive] Ping failed:', err.message);
    }
  }, 10 * 60 * 1000); // every 10 minutes

  console.log(`✅ Keep-alive started → pinging ${RENDER_URL}/ping every 10 min`);
}

// ================================================================
// HELPERS
// ================================================================
function generateApiKey() {
  return 'sms_' + crypto.randomBytes(24).toString('hex');
}

function isValidPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone.replace(/\s/g, ''));
}

function formatPhone(phone) {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
}

function countSegments(text) {
  return Math.max(1, Math.ceil(text.length / 160));
}

function logMessage(entry) {
  DB.messages.push(entry);
  if (DB.messages.length > 10000) DB.messages.shift();
}

function sanitize(str, maxLen = 200) {
  return String(str || '').trim().substring(0, maxLen);
}

// ================================================================
// MIDDLEWARE: Auth
// ================================================================
function auth(req, res, next) {
  const key =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    req.query.api_key;

  if (!key) {
    return res.status(401).json({
      success: false,
      error: 'Missing API key. Send header: x-api-key: YOUR_KEY'
    });
  }
  const user = DB.users[key];
  if (!user) {
    return res.status(403).json({ success: false, error: 'Invalid API key.' });
  }
  req.user   = user;
  req.apiKey = key;
  next();
}

// ================================================================
// MIDDLEWARE: Credits Check
// ================================================================
function hasCredits(req, res, next) {
  if (req.user.credits <= 0) {
    return res.status(402).json({
      success: false,
      error: 'No credits remaining. Please upgrade your plan.',
      credits_remaining: 0,
    });
  }
  next();
}

// ================================================================
// CORE: Send via Twilio
// ================================================================
async function sendViaTwilio(to, message) {
  const client = getTwilioClient();
  const result = await client.messages.create({
    body: message,
    from: TWILIO_FROM,
    to,
  });
  return {
    messageId: result.sid,
    status:    result.status,
    to:        result.to,
  };
}

// ================================================================
// ROUTES
// ================================================================

// Ping — for keep-alive (never sleeps)
app.get('/ping', (req, res) => {
  res.json({ pong: true, time: new Date().toISOString() });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    name:      'SwiftSMS API',
    version:   '1.0.0',
    status:    'operational',
    timestamp: new Date().toISOString(),
    twilio:    !!process.env.TWILIO_ACCOUNT_SID,
    endpoints: {
      'POST /account/create':  'Create account & API key',
      'GET  /account/info':    'Account details (auth required)',
      'GET  /account/usage':   'Message history (auth required)',
      'POST /sms/send':        'Send single SMS (auth required)',
      'POST /sms/send-bulk':   'Bulk SMS up to 100 (auth required)',
      'GET  /sms/status/:id':  'Delivery status (auth required)',
      'GET  /plans':           'View pricing plans',
      'GET  /ping':            'Keep-alive ping',
    }
  });
});

// ----------------------------------------------------------------
// Create Account
// ----------------------------------------------------------------
app.post('/account/create', (req, res) => {
  const { name, email, plan = 'free' } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      success: false, error: '"name" and "email" are required.'
    });
  }
  if (!PLANS[plan]) {
    return res.status(400).json({
      success: false,
      error: `Invalid plan. Choose: ${Object.keys(PLANS).join(', ')}`
    });
  }
  const emailLower = sanitize(email).toLowerCase();
  const exists = Object.values(DB.users).find(u => u.email === emailLower);
  if (exists) {
    return res.status(409).json({
      success: false, error: 'Email already registered.'
    });
  }

  const apiKey = generateApiKey();
  DB.users[apiKey] = {
    id:        'user_' + crypto.randomBytes(8).toString('hex'),
    name:      sanitize(name),
    email:     emailLower,
    plan,
    credits:   PLANS[plan].credits,
    used:      0,
    createdAt: new Date().toISOString(),
  };

  return res.status(201).json({
    success:  true,
    message:  'Account created!',
    api_key:  apiKey,
    plan,
    credits:  PLANS[plan].credits,
    warning:  'Save your API key — it will NOT be shown again!',
  });
});

// ----------------------------------------------------------------
// Account Info
// ----------------------------------------------------------------
app.get('/account/info', auth, (req, res) => {
  const plan = PLANS[req.user.plan];
  res.json({
    success: true,
    account: {
      id:                req.user.id,
      name:              req.user.name,
      email:             req.user.email,
      plan:              req.user.plan,
      credits_remaining: req.user.credits,
      credits_used:      req.user.used,
      rate_limit:        `${plan.rateLimit} SMS/min`,
      member_since:      req.user.createdAt,
    }
  });
});

// ----------------------------------------------------------------
// Usage History
// ----------------------------------------------------------------
app.get('/account/usage', auth, (req, res) => {
  const userMessages = DB.messages
    .filter(m => m.userId === req.user.id)
    .slice(-100)
    .reverse();

  res.json({
    success:           true,
    total_sent:        req.user.used,
    credits_remaining: req.user.credits,
    recent_messages:   userMessages,
  });
});

// ----------------------------------------------------------------
// Send Single SMS
// ----------------------------------------------------------------
app.post('/sms/send', auth, hasCredits, smsRateLimit, async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({
      success: false, error: '"to" and "message" are required.'
    });
  }

  const formattedTo = formatPhone(String(to));
  if (!isValidPhone(formattedTo)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid phone number. Use E.164 format: +1234567890'
    });
  }

  const msg = sanitize(message, 1600);
  if (msg.length === 0) {
    return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
  }

  const segments      = countSegments(msg);
  const creditsNeeded = segments;

  if (req.user.credits < creditsNeeded) {
    return res.status(402).json({
      success: false,
      error: `Need ${creditsNeeded} credits, you have ${req.user.credits}.`
    });
  }

  try {
    const result = await sendViaTwilio(formattedTo, msg);

    req.user.credits -= creditsNeeded;
    req.user.used    += creditsNeeded;

    const entry = {
      id:           result.messageId,
      userId:       req.user.id,
      to:           formattedTo,
      message:      msg,
      segments,
      credits_used: creditsNeeded,
      status:       result.status,
      timestamp:    new Date().toISOString(),
    };
    logMessage(entry);

    return res.json({
      success:           true,
      message_id:        result.messageId,
      to:                formattedTo,
      segments,
      credits_used:      creditsNeeded,
      credits_remaining: req.user.credits,
      status:            result.status,
      timestamp:         entry.timestamp,
    });
  } catch (err) {
    console.error('Twilio send error:', err.code, err.message);
    return res.status(502).json({
      success: false,
      error:   err.message || 'SMS delivery failed.',
      code:    err.code || null,
    });
  }
});

// ----------------------------------------------------------------
// Send Bulk SMS
// ----------------------------------------------------------------
app.post('/sms/send-bulk', auth, hasCredits, async (req, res) => {
  const { recipients, message } = req.body;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({
      success: false, error: '"recipients" must be a non-empty array.'
    });
  }
  if (recipients.length > 100) {
    return res.status(400).json({
      success: false, error: 'Max 100 recipients per request.'
    });
  }
  if (!message) {
    return res.status(400).json({ success: false, error: '"message" is required.' });
  }

  const msg           = sanitize(message, 1600);
  const segments      = countSegments(msg);
  const totalCredits  = recipients.length * segments;

  if (req.user.credits < totalCredits) {
    return res.status(402).json({
      success: false,
      error: `Need ${totalCredits} credits, you have ${req.user.credits}.`
    });
  }

  const results    = [];
  let successCount = 0;
  let failCount    = 0;

  for (const phone of recipients) {
    const formatted = formatPhone(String(phone));
    if (!isValidPhone(formatted)) {
      results.push({ to: phone, status: 'failed', error: 'Invalid phone number' });
      failCount++;
      continue;
    }
    try {
      const result = await sendViaTwilio(formatted, msg);
      logMessage({
        id:           result.messageId,
        userId:       req.user.id,
        to:           formatted,
        message:      msg,
        segments,
        credits_used: segments,
        status:       'sent',
        timestamp:    new Date().toISOString(),
      });
      results.push({ to: formatted, status: 'sent', message_id: result.messageId });
      successCount++;
    } catch (err) {
      results.push({ to: formatted, status: 'failed', error: err.message });
      failCount++;
    }
  }

  const creditsUsed    = successCount * segments;
  req.user.credits    -= creditsUsed;
  req.user.used       += creditsUsed;

  return res.json({
    success:           true,
    total:             recipients.length,
    delivered:         successCount,
    failed:            failCount,
    credits_used:      creditsUsed,
    credits_remaining: req.user.credits,
    results,
  });
});

// ----------------------------------------------------------------
// Message Status
// ----------------------------------------------------------------
app.get('/sms/status/:id', auth, async (req, res) => {
  const msgId = req.params.id;
  const local = DB.messages.find(
    m => m.id === msgId && m.userId === req.user.id
  );
  if (!local) {
    return res.status(404).json({ success: false, error: 'Message not found.' });
  }
  try {
    const client    = getTwilioClient();
    const twilioMsg = await client.messages(msgId).fetch();
    local.status    = twilioMsg.status;
    return res.json({
      success:    true,
      id:         msgId,
      to:         local.to,
      message:    local.message,
      status:     twilioMsg.status,
      sent_at:    local.timestamp,
      error_code: twilioMsg.errorCode || null,
    });
  } catch {
    return res.json({ success: true, ...local });
  }
});

// ----------------------------------------------------------------
// Plans
// ----------------------------------------------------------------
app.get('/plans', (req, res) => {
  res.json({
    success: true,
    plans: Object.entries(PLANS).map(([name, p]) => ({
      name,
      price_usd:     p.priceUSD,
      credits:       p.credits,
      rate_limit:    `${p.rateLimit} SMS/min`,
      price_per_sms: p.priceUSD === 0
        ? 'free'
        : `$${(p.priceUSD / p.credits).toFixed(4)}`,
    }))
  });
});

// ----------------------------------------------------------------
// 404
// ----------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error:   `${req.method} ${req.path} not found.`,
    hint:    'GET / for all endpoints',
  });
});

// ----------------------------------------------------------------
// Error handler
// ----------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ================================================================
// START
// ================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║        SwiftSMS API — Production Ready       ║
║  Port   : ${PORT}                               ║
║  Twilio : ${process.env.TWILIO_ACCOUNT_SID ? '✅ Connected' : '❌ Missing .env values'}             ║
║  Mode   : ${process.env.NODE_ENV || 'development'}                        ║
╚══════════════════════════════════════════════╝
  `);
  startKeepAlive();
});

module.exports = app;
