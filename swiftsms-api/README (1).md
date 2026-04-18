# 🚀 SwiftSMS — Complete Production Setup

Two repos. Two platforms. One SMS business.

```
RENDER  → runs your backend API (server.js)
VERCEL  → hosts your frontend dashboard (index.html)
```

---

## 📁 REPO 1: Backend (Upload to Render)
### GitHub repo name: `swiftsms-api`

```
swiftsms-api/          ← Upload ALL these to GitHub
├── server.js          ← Main API server with Twilio
├── package.json       ← All npm dependencies
├── .env.example       ← Template (safe to upload)
├── .gitignore         ← Hides your .env from GitHub
├── render.yaml        ← Render auto-config
└── README.md
```

**DO NOT upload:** `.env` (your Twilio secrets live here — gitignore hides it)

---

## 📁 REPO 2: Frontend (Upload to Vercel)
### GitHub repo name: `swiftsms-dashboard`

```
swiftsms-dashboard/    ← Upload ALL these to GitHub
├── index.html         ← Full dashboard UI
└── vercel.json        ← Vercel auto-config
```

No secrets here — it's just HTML. Safe to upload as-is.

---

## ⚡ STEP 1 — Get Twilio Credentials

1. Go to **console.twilio.com** (you're already there!)
2. On left sidebar: **Account Info** at bottom
3. Copy:
   - **Account SID** → starts with `AC...`
   - **Auth Token** → click eye icon to reveal
4. Go to **Phone Numbers → Manage → Buy a number**
   - Cost: ~$1/month
   - Choose any US number
   - Copy the number (e.g. `+15551234567`)

---

## ⚡ STEP 2 — Create Backend GitHub Repo

```bash
# On your computer, create folder
mkdir swiftsms-api
cd swiftsms-api

# Copy these files into it:
# server.js, package.json, .env.example, .gitignore, render.yaml

# Create .env file (NOT uploaded to GitHub)
cp .env.example .env
# Edit .env and fill in your Twilio values

# Push to GitHub
git init
git add .
git commit -m "SwiftSMS API v1"
# Go to github.com → New repo → swiftsms-api
git remote add origin https://github.com/YOUR_USERNAME/swiftsms-api.git
git branch -M main
git push -u origin main
```

---

## ⚡ STEP 3 — Deploy Backend on Render

1. Go to **render.com** → Sign in
2. Click **"New +"** → **"Web Service"**
3. Click **"Connect a repository"** → select `swiftsms-api`
4. Settings:
   - **Name:** swiftsms-api
   - **Region:** Oregon (US West)
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **"Advanced"** → **"Add Environment Variable"**
   Add these one by one:

   | Key | Value |
   |-----|-------|
   | `TWILIO_ACCOUNT_SID` | ACxxxxxxxxxxxxxxxxxx |
   | `TWILIO_AUTH_TOKEN` | your_auth_token |
   | `TWILIO_FROM_NUMBER` | +1XXXXXXXXXX |
   | `RENDER_EXTERNAL_URL` | (leave blank for now) |
   | `DEMO_API_KEY` | sms_anything_secret_here |
   | `NODE_ENV` | production |

6. Click **"Create Web Service"**
7. Wait ~3 minutes for deploy
8. Copy your URL: `https://swiftsms-api.onrender.com`
9. Go back to Render → Environment → Add:
   - `RENDER_EXTERNAL_URL` = `https://swiftsms-api.onrender.com`
   - Click **"Save Changes"** (this enables keep-alive!)

---

## ⚡ STEP 4 — Create Frontend GitHub Repo

```bash
mkdir swiftsms-dashboard
cd swiftsms-dashboard

# Copy these files:
# index.html, vercel.json

git init
git add .
git commit -m "SwiftSMS Dashboard"
# Go to github.com → New repo → swiftsms-dashboard
git remote add origin https://github.com/YOUR_USERNAME/swiftsms-dashboard.git
git branch -M main
git push -u origin main
```

---

## ⚡ STEP 5 — Deploy Frontend on Vercel

1. Go to **vercel.com** → Sign in with GitHub
2. Click **"Add New Project"**
3. Import `swiftsms-dashboard` repo
4. Settings:
   - **Framework:** Other
   - No environment variables needed
5. Click **"Deploy"**
6. Your dashboard is live at: `https://swiftsms-dashboard.vercel.app`

---

## ⚡ STEP 6 — Connect Dashboard to Backend

1. Open your Vercel dashboard URL
2. In the yellow config bar at top:
   - **API URL:** `https://swiftsms-api.onrender.com`
   - **Key:** your DEMO_API_KEY value
3. Click **Connect**
4. Dashboard loads your account info ✅

---

## ⚡ STEP 7 — List on RapidAPI

1. Go to **rapidapi.com/provider** → Sign up free
2. Click **"Add New API"**
3. Fill in:
   - **Name:** SwiftSMS — Bulk SMS API
   - **Category:** Communication
   - **Base URL:** `https://swiftsms-api.onrender.com`
4. Add endpoints:
   - `POST /sms/send`
   - `POST /sms/send-bulk`
   - `GET /sms/status/{id}`
   - `GET /account/info`
   - `GET /account/usage`
   - `GET /plans`
5. Set pricing tiers
6. Publish!

---

## 🔐 Security Checklist

- [x] `.env` never uploaded (protected by `.gitignore`)
- [x] Helmet.js security headers
- [x] CORS enabled for all origins (needed for RapidAPI)
- [x] Rate limiting: 300 req/15min per IP
- [x] SMS rate limit: 60/minute per API key
- [x] Input sanitization on all fields
- [x] Error messages don't leak internals

---

## 💰 Profit Summary

| | You Pay | You Charge | Profit |
|--|---------|-----------|--------|
| Per SMS | $0.0075 | $0.018 | $0.0105 |
| 1,000 SMS | $7.50 | $18 | $10.50 |
| Starter plan | — | $9/mo | $9/mo |
| Pro plan | — | $29/mo | $29/mo |
| Business plan | — | $99/mo | $99/mo |

---

## 🔮 Keep-Alive Explained

The server pings itself every 10 minutes at `/ping` so Render never puts it to sleep. This is automatic — just make sure `RENDER_EXTERNAL_URL` is set in your Render environment variables.
