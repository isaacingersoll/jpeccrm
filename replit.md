# JPEC CRM

## Overview

A custom CRM application built for the **University of Iowa John Pappajohn Entrepreneurial Center (JPEC)**. The system manages events, mentors, startups, mentor-startup matching, annual reports, and user settings for JPEC staff.

Key functional areas:
- **Events** — Registration tracking, attendance, attendee demographics, event tiers, conversion rates
- **Mentors** — Database with skills, capacity tracking, interaction logging, star ratings
- **Startups** — Founder profiles, news/milestone updates, account manager assignment, needs tracking
- **Matching** — Mentor-startup matching based on skill/need overlap scoring
- **Annual Reports** — Aggregated yearly statistics
- **Settings** — User management (admin only)

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Current Architecture: Monolithic Single-Page Application

The application is a monolithic Express.js server that serves a single-page React frontend from `public/index.html`.

**Backend:**
- **Framework:** Express.js (v4) running on Node.js
- **Entry point:** `server.js`
- **Database:** sql.js (SQLite compiled to WebAssembly) with file persistence at `jpec.db`
- **Authentication:** express-session with cookie-based sessions (7-day expiry)
- **Password hashing:** bcryptjs
- **API pattern:** REST API endpoints protected by session-based auth middleware
- **Data persistence:** The SQLite database is exported to a file on disk after writes via a `saveDb()` helper

**Frontend:**
- **Framework:** React 18 loaded via CDN (UMD build), with Babel standalone for in-browser JSX transformation
- **Styling:** Tailwind CSS loaded via CDN (`cdn.tailwindcss.com`)
- **Architecture:** Entire frontend is a single `public/index.html` file with all React components defined inline in a `<script type="text/babel">` block
- **No build step** for the frontend — everything runs client-side with CDN dependencies

**Database design:**
- SQLite via sql.js (in-memory with file sync)
- Helper functions `dbGet(sql, params)` and `dbAll(sql, params)` abstract prepared statement usage
- Database file path configurable via `DB_PATH` environment variable

**Authentication flow:**
- Session-based auth with `req.session.userId`
- `auth` middleware returns 401 if no session exists
- Default login credentials exist (referenced in README table, content truncated)

### Build Script (Unused/Future)

There is a `script/build.ts` file that references Vite, esbuild, and many dependencies not present in `package.json` (like drizzle-orm, passport, pg, stripe, openai, etc.). This appears to be scaffolding from a template or planned migration and is **not currently active**. The current app runs purely from `server.js` and `public/index.html` with no build step.

### Key Design Decisions

1. **sql.js instead of native SQLite** — Chosen for portability (no native compilation needed), works in Replit without system dependencies. Trade-off: entire DB lives in memory and must be manually synced to disk.

2. **Single HTML file frontend** — All React components, styles, and logic in one file using CDN-loaded React and Babel. This avoids a build step but makes the codebase harder to maintain as it grows.

3. **No ORM** — Raw SQL queries via sql.js prepared statements. Simple and direct but requires manual query construction.

4. **Session secret** — Falls back to a hardcoded default (`'jpec-crm-iowa-2026'`). Should be set via `SESSION_SECRET` environment variable in production.

## External Dependencies

### Runtime Dependencies (package.json)
| Package | Purpose |
|---------|---------|
| `express` (v4) | HTTP server and routing |
| `express-session` (v1) | Session management for auth |
| `bcryptjs` (v2) | Password hashing |
| `sql.js` (v1) | SQLite database engine (WASM-based) |

### CDN Dependencies (loaded in index.html)
| Resource | Purpose |
|----------|---------|
| React 18 (UMD) | UI framework |
| ReactDOM 18 (UMD) | React DOM rendering |
| Babel Standalone | In-browser JSX/ES6+ transpilation |
| Tailwind CSS CDN | Utility-first CSS framework |

### Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Server port |
| `DB_PATH` | `./jpec.db` | SQLite database file location |
| `SESSION_SECRET` | `'jpec-crm-iowa-2026'` | Session encryption secret |

### External Services
- No external APIs or third-party services are currently integrated
- No external database — all data stored in local SQLite file