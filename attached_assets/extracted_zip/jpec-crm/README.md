# JPEC CRM

A custom CRM built for the **University of Iowa John Pappajohn Entrepreneurial Center (JPEC)**.

## Features

- **Events** — Track registrations vs. actual attendance, attendee demographics (Student/Mentor/Alumni/Donor), event tiers, and conversion rates
- **Mentors** — Full mentor database with skills, capacity tracking, interaction logging, and star ratings
- **Startups** — Founder profiles, news/milestone updates, account manager assignment, needs tracking
- **Matching** — AI-style mentor-startup matching based on skill/need overlap scoring
- **Annual Reports** — Aggregated stats by year: events by tier, affiliation breakdown, mentor engagement, startup activity
- **Settings** — User management for JPEC staff (admin only)

---

## Deploying on Replit

### 1. Upload Files

Create a new **Node.js** Repl and upload all project files, preserving the folder structure:

```
jpec-crm/
├── server.js
├── package.json
├── .replit
└── public/
    └── index.html
```

### 2. Install Dependencies

Replit will automatically run `npm install` on first start. If it doesn't, open the Shell and run:

```bash
npm install
```

### 3. Run the App

Click the **Run** button. Replit will execute `npm start` (i.e., `node server.js`).

The app will be available at your Replit project URL.

---

## Default Login Credentials

| Email | Password | Role |
|-------|----------|------|
| admin@jpec.uiowa.edu | jpec2026 | Admin |
| harry@jpec.uiowa.edu | jpec2026 | Staff |
| dana@jpec.uiowa.edu | jpec2026 | Staff |

> **Important:** Change these passwords after your first login via the Settings page.

---

## Admin Capabilities

- Create, edit, and delete user accounts
- Full access to all CRM modules
- View annual reports

Staff users have full read/write access to all modules but cannot manage other user accounts.

---

## Data Storage

Data is stored in a **SQLite database** (`jpec.db`) created automatically on first run. The database persists on Replit's filesystem across restarts.

> **Note:** On Replit's free tier, the filesystem may reset occasionally. For production use, consider upgrading to a paid Replit plan or exporting your data regularly.

---

## Event Tiers

| Tier | Description |
|------|-------------|
| Signature | Major flagship events (e.g., Pitch Competitions) |
| Core | Regular programming events |
| Community | Open community / networking events |
| Partner | Co-hosted or partner organization events |

---

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via better-sqlite3)
- **Auth:** express-session + bcryptjs
- **Frontend:** React 18 (CDN) + Tailwind CSS (CDN) — no build step required

---

## Support

Built for JPEC by the Cowork AI assistant. For issues or feature requests, contact your account manager.
