const express = require('express');
const initSqlJs = require('sql.js');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'jpec.db');

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'jpec-crm-iowa-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const auth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Get one row
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const has = stmt.step();
  const row = has ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

// Get all rows
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Run a mutation and return lastInsertRowid; saves DB to disk
function dbRun(sql, params = []) {
  db.run(sql, params.length ? params : undefined);
  const res = db.exec('SELECT last_insert_rowid()');
  const lastInsertRowid = res[0]?.values[0]?.[0] ?? 0;
  saveDb();
  return { lastInsertRowid };
}

// ─── PARSERS ──────────────────────────────────────────────────────────────────
function parseSkills(m) { return { ...m, skills: JSON.parse(m.skills || '[]') }; }
function parseNeeds(s) { return { ...s, needs: JSON.parse(s.needs || '[]') }; }

// ─── INIT DB ──────────────────────────────────────────────────────────────────
async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('📂 Loaded existing database from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('🆕 Creating new database at', DB_PATH);
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT DEFAULT 'Workshop',
      tier INTEGER DEFAULT 2,
      description TEXT DEFAULT '',
      location TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      affiliation TEXT DEFAULT 'Student',
      registered INTEGER DEFAULT 1,
      attended INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mentors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      company TEXT DEFAULT '',
      industry TEXT DEFAULT '',
      skills TEXT DEFAULT '[]',
      hours_per_week REAL DEFAULT 2,
      stage_pref TEXT DEFAULT 'Any',
      account_manager TEXT DEFAULT '',
      linkedin TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mentor_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mentor_id INTEGER NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
      startup_id INTEGER REFERENCES startups(id),
      date TEXT NOT NULL,
      type TEXT DEFAULT 'Meeting',
      description TEXT DEFAULT '',
      rating INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS startups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      industry TEXT DEFAULT '',
      stage TEXT DEFAULT 'Idea',
      founded TEXT DEFAULT '',
      website TEXT DEFAULT '',
      account_manager TEXT DEFAULT '',
      needs TEXT DEFAULT '[]',
      funding REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      startup_id INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      linkedin TEXT DEFAULT '',
      role TEXT DEFAULT 'Co-Founder'
    );
    CREATE TABLE IF NOT EXISTS startup_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      startup_id INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      type TEXT DEFAULT 'Milestone',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mentor_id INTEGER NOT NULL REFERENCES mentors(id),
      startup_id INTEGER NOT NULL REFERENCES startups(id),
      status TEXT DEFAULT 'Pending',
      notes TEXT DEFAULT '',
      startup_rating INTEGER,
      mentor_rating INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS startup_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      startup_id INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      contact_name TEXT DEFAULT '',
      date TEXT NOT NULL,
      type TEXT DEFAULT 'Call',
      description TEXT DEFAULT '',
      event_id INTEGER REFERENCES events(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS employee_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      startup_id INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      employee_count INTEGER DEFAULT 0,
      jobs_created INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  try { db.run('ALTER TABLE startups ADD COLUMN employees INTEGER DEFAULT 0'); } catch(e) {}

  // Seed data if empty
  const userCount = dbGet('SELECT COUNT(*) as c FROM users', []);
  if (!userCount || userCount.c === 0) {
    seed();
  }
}

function seed() {
  // Users
  dbRun('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)', ['Admin', 'admin@jpec.uiowa.edu', bcrypt.hashSync('jpec2026', 10), 'admin']);
  dbRun('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)', ['Harry Blount', 'harry@jpec.uiowa.edu', bcrypt.hashSync('jpec2026', 10), 'staff']);
  dbRun('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)', ['Dana Larsen', 'dana@jpec.uiowa.edu', bcrypt.hashSync('jpec2026', 10), 'staff']);

  // Mentors
  const m1 = dbRun('INSERT INTO mentors (name,email,phone,bio,company,industry,skills,hours_per_week,stage_pref,account_manager,linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['Sarah Chen','sarah.chen@gmail.com','319-555-0101','Former CTO of two successful exits. Passionate about helping early-stage tech founders navigate product-market fit and build scalable engineering teams.','TechVentures LLC','Technology',JSON.stringify(['Product Development','Tech Strategy','Fundraising','Team Building','Product-Market Fit']),4,'Early Stage','Harry','linkedin.com/in/sarahchen']).lastInsertRowid;
  const m2 = dbRun('INSERT INTO mentors (name,email,phone,bio,company,industry,skills,hours_per_week,stage_pref,account_manager,linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['Michael Johnson','mjohnson@capitalgroup.com','319-555-0102','Investment banker turned angel investor. Expertise in financial modeling, cap table management, and preparing founders for investor conversations.','Capital Group','Finance',JSON.stringify(['Financial Planning','Fundraising','Investor Relations','Accounting','Cap Table','Financial Modeling']),3,'Any','Dana','linkedin.com/in/mjohnson']).lastInsertRowid;
  const m3 = dbRun('INSERT INTO mentors (name,email,phone,bio,company,industry,skills,hours_per_week,stage_pref,account_manager,linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['Lisa Rodriguez','lisa.r@brandhouse.co','319-555-0103','CMO with 15 years building consumer and B2B brands. Loves working with founders who have strong product but weak go-to-market strategy.','BrandHouse','Marketing',JSON.stringify(['Marketing','Brand Strategy','Social Media','PR','Customer Acquisition','Content Strategy']),5,'Any','Harry','linkedin.com/in/lisarodriguez']).lastInsertRowid;
  const m4 = dbRun('INSERT INTO mentors (name,email,phone,bio,company,industry,skills,hours_per_week,stage_pref,account_manager,linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['David Park','david@parklaw.com','319-555-0104','Startup attorney specializing in incorporation, IP, contracts, and early-stage compliance. Formerly in-house at a Series B startup.','Park & Associates','Legal',JSON.stringify(['Legal','Contracts','IP Protection','Compliance','Operations','Incorporation']),2,'Idea','Dana','linkedin.com/in/davidpark']).lastInsertRowid;
  const m5 = dbRun('INSERT INTO mentors (name,email,phone,bio,company,industry,skills,hours_per_week,stage_pref,account_manager,linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['Jennifer Williams','jwilliams@bdsolutions.com','319-555-0105','Business development executive with deep enterprise sales experience. Helps startups land their first 10 B2B customers and build repeatable sales motions.','BD Solutions','Business Development',JSON.stringify(['Sales','Business Development','Partnerships','Customer Acquisition','Enterprise','B2B Strategy']),4,'Growth Stage','Harry','linkedin.com/in/jenniferwilliams']).lastInsertRowid;
  const m6 = dbRun('INSERT INTO mentors (name,email,phone,bio,company,industry,skills,hours_per_week,stage_pref,account_manager,linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ['Robert Kim','rkim@operationsco.com','319-555-0106','COO background in manufacturing and logistics. Helps founders build scalable operations, manage vendors, and reduce burn without sacrificing quality.','OperationsCo','Operations',JSON.stringify(['Operations','Supply Chain','Process Improvement','Team Building','Financial Planning','Vendor Management']),3,'Growth Stage','Dana','linkedin.com/in/robertkim']).lastInsertRowid;

  // Startups
  const s1 = dbRun('INSERT INTO startups (name,description,industry,stage,founded,website,account_manager,needs,funding) VALUES (?,?,?,?,?,?,?,?,?)',
    ['AgriTech Iowa','Precision agriculture platform using soil sensors and AI to optimize crop yields for Midwest farmers. Currently in pilot with 3 farms in Johnson County.','AgTech','Pre-Launch','2024','agrtechiowa.com','Harry',JSON.stringify(['Fundraising','Marketing','Customer Acquisition']),50000]).lastInsertRowid;
  const s2 = dbRun('INSERT INTO startups (name,description,industry,stage,founded,website,account_manager,needs,funding) VALUES (?,?,?,?,?,?,?,?,?)',
    ['HealthSync','Patient communication platform that reduces no-shows by 40% through smart appointment reminders and personalized follow-ups. HIPAA compliant.','HealthTech','Early Stage','2023','healthsync.io','Dana',JSON.stringify(['Product Development','Investor Relations','Legal']),250000]).lastInsertRowid;
  const s3 = dbRun('INSERT INTO startups (name,description,industry,stage,founded,website,account_manager,needs,funding) VALUES (?,?,?,?,?,?,?,?,?)',
    ['EduLeap','AI tutoring platform for K-12 students that adapts lesson plans to individual learning styles. Proof of concept built. Seeking first school district pilot.','EdTech','Idea','2025','','Harry',JSON.stringify(['Marketing','Financial Planning','Product Development']),0]).lastInsertRowid;
  const s4 = dbRun('INSERT INTO startups (name,description,industry,stage,founded,website,account_manager,needs,funding) VALUES (?,?,?,?,?,?,?,?,?)',
    ['GreenOps','Sustainability operations software for mid-size manufacturers to track, report, and reduce their carbon footprint. SOC 2 compliant.','CleanTech','Growth Stage','2022','greenops.io','Dana',JSON.stringify(['Operations','Fundraising','Business Development','Enterprise']),1200000]).lastInsertRowid;
  const s5 = dbRun('INSERT INTO startups (name,description,industry,stage,founded,website,account_manager,needs,funding) VALUES (?,?,?,?,?,?,?,?,?)',
    ['BrewLocal','Marketplace connecting local craft breweries with independent distributors. Currently live in Iowa and Illinois with 28 brewery partners.','Marketplace','Early Stage','2024','brewlocal.com','Harry',JSON.stringify(['Sales','Marketing','Financial Planning']),175000]).lastInsertRowid;

  // Founders
  dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [s1,'Marcus Thompson','marcus@agrtechiowa.com','319-555-0201','Former agronomist with 10 years at John Deere. Built the first prototype on his family farm in Cedar Rapids.','linkedin.com/in/marcusthompson','CEO & Co-Founder']);
  dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [s1,'Priya Patel','priya@agrtechiowa.com','319-555-0202','ML engineer formerly at Google Brain. Handles all sensor integration and AI/prediction systems.','linkedin.com/in/priyapatel','CTO & Co-Founder']);
  dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [s2,'Dr. Amanda Ross','amanda@healthsync.io','319-555-0203','Family practice physician who spent 12 years playing phone tag with patients. Left her practice to solve the no-show crisis in primary care.','linkedin.com/in/dramandross','CEO & Founder']);
  dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [s3,'Tyler Nguyen','tyler@eduleap.ai','319-555-0204','Former high school math teacher and CS grad student. Saw firsthand how one-size-fits-all instruction fails 30% of students.','linkedin.com/in/tylernguyen','Founder & CEO']);
  dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [s4,'Sofia Martinez','sofia@greenops.io','319-555-0205','Sustainability consultant who kept building the same Excel dashboards for every manufacturer client. Decided to productize it.','linkedin.com/in/sofiamartinez','CEO & Co-Founder']);
  dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [s4,"James O'Brien",'james@greenops.io','319-555-0206','Full-stack developer with background in ERP and enterprise software integrations.','linkedin.com/in/jamesobrien','CTO & Co-Founder']);
  dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [s5,'Brad Wilson','brad@brewlocal.com','319-555-0207','Craft beer enthusiast and former distribution rep who knew every pain point on both sides of the transaction.','linkedin.com/in/bradwilson','CEO & Founder']);

  // Events
  const e1 = dbRun('INSERT INTO events (name,date,type,tier,description,location) VALUES (?,?,?,?,?,?)', ['Ideastorm Fall 2025','2025-10-15','Pitch Competition',1,'Flagship pitch competition open to UI students and community founders. Cash prizes and mentorship packages.','Pappajohn Business Building, Room 108']).lastInsertRowid;
  const e2 = dbRun('INSERT INTO events (name,date,type,tier,description,location) VALUES (?,?,?,?,?,?)', ['Venture School Demo Day','2025-12-08','Demo Day',1,'Graduation showcase for the Fall 2025 Venture School cohort. 12 teams pitch to a live panel of investors and mentors.','Iowa Memorial Union, Main Ballroom']).lastInsertRowid;
  const e3 = dbRun('INSERT INTO events (name,date,type,tier,description,location) VALUES (?,?,?,?,?,?)', ['Mentor Speed Dating','2025-11-14','Networking',2,'Structured speed-networking connecting students and founders with JPEC mentors. 8-minute rotations.','Pappajohn Business Building, Atrium']).lastInsertRowid;
  const e4 = dbRun('INSERT INTO events (name,date,type,tier,description,location) VALUES (?,?,?,?,?,?)', ['Financial Modeling Workshop','2026-01-22','Workshop',2,'Hands-on session covering 3-statement models, cap tables, and key startup metrics. Bring your laptop.','JPEC Office, Room 200']).lastInsertRowid;
  const e5 = dbRun('INSERT INTO events (name,date,type,tier,description,location) VALUES (?,?,?,?,?,?)', ['Iowa Startup Crawl','2026-02-10','Networking',3,'Informal happy hour networking at downtown Iowa City venues. Founders and investors from across the state.','Iowa City Downtown - Multiple Venues']).lastInsertRowid;

  // Attendees
  const aff = ['Student','Mentor','Alumni','Faculty','Founder','Investor'];
  const names = ['Alex Johnson','Sam Lee','Jordan Rivera','Taylor Kim','Morgan Chen','Casey Williams','Riley Davis','Drew Thompson','Avery Martinez','Quinn Anderson','Blake Harris','Cameron Scott','Dylan Moore','Emerson Taylor','Finley Brown','Harper Wilson','Indie Garcia','Jamie Miller','Kendall Jackson','Logan White','Mason Clark','Nora Lewis','Owen Hall','Paige Young','Reese King'];
  names.forEach((n, i) => dbRun('INSERT INTO attendees (event_id,name,email,affiliation,registered,attended) VALUES (?,?,?,?,1,?)', [e1, n, `${n.toLowerCase().replace(/ /g,'.')}@example.com`, aff[i % aff.length], i < 20 ? 1 : 0]));
  names.slice(0, 18).forEach((n, i) => dbRun('INSERT INTO attendees (event_id,name,email,affiliation,registered,attended) VALUES (?,?,?,?,1,?)', [e2, n, `${n.toLowerCase().replace(/ /g,'.')}@example.com`, aff[i % aff.length], i < 14 ? 1 : 0]));
  names.slice(0, 14).forEach((n, i) => dbRun('INSERT INTO attendees (event_id,name,email,affiliation,registered,attended) VALUES (?,?,?,?,1,?)', [e3, n, `${n.toLowerCase().replace(/ /g,'.')}@example.com`, aff[i % aff.length], i < 11 ? 1 : 0]));
  names.slice(0, 10).forEach((n, i) => dbRun('INSERT INTO attendees (event_id,name,email,affiliation,registered,attended) VALUES (?,?,?,?,1,?)', [e4, n, `${n.toLowerCase().replace(/ /g,'.')}@example.com`, aff[i % aff.length], i < 9 ? 1 : 0]));
  names.slice(0, 8).forEach((n, i) => dbRun('INSERT INTO attendees (event_id,name,email,affiliation,registered,attended) VALUES (?,?,?,?,1,0)', [e5, n, `${n.toLowerCase().replace(/ /g,'.')}@example.com`, aff[i % aff.length]]));

  // Startup updates
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s1,'2025-11-01','Investment','AgriTech Iowa Closes $50K Pre-Seed','Raised from JPEC Venture Fund and two Iowa agtech angel investors. Will fund hardware pilot on 10 farms.','']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s2,'2025-10-15','Milestone','HealthSync Reaches 10,000 Appointments Managed','Platform crossed a major milestone. Serving 8 clinics across Iowa and Illinois.','healthsync.io/news']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s2,'2025-12-01','Investment','HealthSync Closes $250K Seed Round','Led by Iowa Startup Capital with three physician angels participating. Post-money valuation $2M.','']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s2,'2026-01-30','Media','HealthSync Featured in Iowa Business Record','Covered for their innovative approach to patient retention and no-show reduction.','iowabizrecord.com/healthsync']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s4,'2025-09-01','Customer','GreenOps Signs Fortune 500 Pilot','6-month pilot with major Midwest manufacturer. First enterprise contract. Could expand to 12 facilities.','']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s4,'2026-01-15','Investment','GreenOps Raises $1.2M Series A','Led by Midwest Sustainability Fund. Will use capital for enterprise sales team and product expansion into Scope 3 reporting.','']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s4,'2026-02-05','Award','GreenOps Named Top 10 Iowa Startup to Watch','Recognized by Iowa Economic Development Authority.','iowaeda.com/top-startups']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s5,'2025-08-01','Milestone','BrewLocal Launches in Illinois','Expanded from Iowa to Illinois with 12 new brewery partners and 4 new distributors signed in first month.','']);
  dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [s5,'2025-10-20','Customer','BrewLocal Signs Kinnick Brewing as Flagship Partner','Largest brewery partnership to date. Kinnick Brewing processes 400 orders/month through the platform.','']);

  // Connections
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m1,s2,'Active','Sarah helping HealthSync with product roadmap prioritization and Series A prep. Meeting bi-weekly.']);
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m2,s1,'Active','Michael building 3-year financial model with AgriTech Iowa and preparing investor deck.']);
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m3,s5,'Active','Lisa helping BrewLocal with go-to-market strategy and brand positioning for multi-state expansion.']);
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m5,s4,'Completed','Jennifer helped GreenOps land their Fortune 500 pilot through enterprise sales coaching. Engagement complete.']);
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m6,s4,'Active','Robert advising GreenOps on scaling operations infrastructure ahead of Series A capital deployment.']);
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m4,s3,'Pending','David offered to help EduLeap with incorporation and IP protection. Awaiting founder response.']);
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m2,s5,'Pending','BrewLocal requested Michael for financial modeling workshop. Michael reviewing capacity.']);
  dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,?,?)", [m1,s1,'Pending','AgriTech Iowa requested Sarah for product strategy session.']);

  // Interactions
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m1,s2,'2025-12-15','Meeting','2-hour product strategy session. Reviewed Q1 2026 roadmap priorities. Sarah recommended deprioritizing 3 features to focus on core retention loop.',5]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m1,s2,'2026-01-20','Meeting','Investor pitch deck review. Detailed feedback on market sizing methodology and competitive landscape slide.',5]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m1,s2,'2026-02-10','Email','Intro to two healthcare VCs who are active in patient engagement space. Both have agreed to take a meeting.',5]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m2,s1,'2025-11-30','Meeting','Built 3-year financial model together. Marcus left with a solid handle on unit economics and path to profitability.',4]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m2,s1,'2026-01-08','Meeting','Investor deck session. Focused on the pre-seed raise narrative and use of funds slide.',4]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m3,s5,'2025-10-10','Meeting','Initial strategy session. Identified 3 key marketing gaps. Lisa will help create quarterly content calendar and brand guide.',5]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m3,s5,'2025-11-18','Review','Reviewed draft brand guide. Strong foundations. Recommended expanding visual identity for Illinois market launch.',4]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m5,s4,'2025-08-20','Meeting','Enterprise sales strategy deep dive. Identified 20 target manufacturing companies and built outbound sequence.',5]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m5,s4,'2025-09-15','Meeting','Follow-up: Jennifer made direct intro to procurement contact at pilot client. Deal closed two weeks later.',5]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m6,s4,'2026-01-10','Meeting','Operations audit. Identified 3 major workflow inefficiencies costing ~$8K/month. Roadmap to fix all three by March.',4]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m6,s4,'2026-02-12','Meeting','Follow-up on ops improvements. Two of three implemented. Running 23% faster on onboarding new clients.',5]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m4,null,'2025-09-01','Event','Attended Mentor Speed Dating. Connected with 6 student teams.',null]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m2,null,'2025-10-15','Event','Judged Ideastorm. Provided written feedback to all 8 teams that presented.',null]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m3,null,'2025-10-15','Event','Judged Ideastorm. Gave detailed marketing feedback to top 3 finalists.',null]);
  dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [m1,null,'2025-12-08','Event','Keynote speaker at Venture School Demo Day. Shared lessons from her two exits.',null]);

  console.log('✅ Database seeded with sample data.');
  console.log('🔑 Default login: admin@jpec.uiowa.edu / jpec2026');
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = dbGet('SELECT id,name,email,role FROM users WHERE id=?', [req.session.userId]);
  res.json(user || { error: 'User not found' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = dbGet('SELECT * FROM users WHERE email=?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, (req, res) => {
  res.json(dbAll('SELECT id,name,email,role,created_at FROM users ORDER BY name', []));
});

app.post('/api/users', auth, (req, res) => {
  const { name, email, password, role = 'staff' } = req.body;
  try {
    const result = dbRun('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)', [name, email, bcrypt.hashSync(password, 10), role]);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.put('/api/users/:id/password', auth, (req, res) => {
  const { password } = req.body;
  dbRun('UPDATE users SET password=? WHERE id=?', [bcrypt.hashSync(password, 10), parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  dbRun('DELETE FROM users WHERE id=?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  res.json({
    mentors: (dbGet('SELECT COUNT(*) as c FROM mentors WHERE active=1', []) || {c:0}).c,
    startups: (dbGet('SELECT COUNT(*) as c FROM startups WHERE active=1', []) || {c:0}).c,
    events: (dbGet('SELECT COUNT(*) as c FROM events', []) || {c:0}).c,
    connections: (dbGet("SELECT COUNT(*) as c FROM connections WHERE status='Active'", []) || {c:0}).c,
    pending: (dbGet("SELECT COUNT(*) as c FROM connections WHERE status='Pending'", []) || {c:0}).c,
    recentEvents: dbAll('SELECT * FROM events ORDER BY date DESC LIMIT 5', []),
    recentUpdates: dbAll('SELECT u.*,s.name as startup_name FROM startup_updates u JOIN startups s ON s.id=u.startup_id ORDER BY u.date DESC LIMIT 6', []),
    topMentors: dbAll("SELECT m.id,m.name,m.industry,COUNT(c.id) as connections FROM mentors m LEFT JOIN connections c ON c.mentor_id=m.id AND c.status='Active' WHERE m.active=1 GROUP BY m.id ORDER BY connections DESC LIMIT 5", []),
    pendingConnections: dbAll("SELECT c.*,m.name as mentor_name,s.name as startup_name FROM connections c JOIN mentors m ON m.id=c.mentor_id JOIN startups s ON s.id=c.startup_id WHERE c.status='Pending' ORDER BY c.created_at DESC LIMIT 5", []),
  });
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────
app.get('/api/events', auth, (req, res) => {
  const { search = '', tier = '', type = '' } = req.query;
  let sql = `SELECT e.*,COUNT(a.id) as reg_count,SUM(CASE WHEN a.attended=1 THEN 1 ELSE 0 END) as att_count FROM events e LEFT JOIN attendees a ON a.event_id=e.id WHERE 1=1`;
  const p = [];
  if (search) { sql += ' AND (e.name LIKE ? OR e.description LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
  if (tier) { sql += ' AND e.tier=?'; p.push(parseInt(tier)); }
  if (type) { sql += ' AND e.type=?'; p.push(type); }
  sql += ' GROUP BY e.id ORDER BY e.date DESC';
  res.json(dbAll(sql, p));
});

app.post('/api/events', auth, (req, res) => {
  const { name, date, type = 'Workshop', tier = 2, description = '', location = '' } = req.body;
  const r = dbRun('INSERT INTO events (name,date,type,tier,description,location) VALUES (?,?,?,?,?,?)', [name, date, type, tier, description, location]);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/events/:id', auth, (req, res) => {
  const event = dbGet('SELECT * FROM events WHERE id=?', [parseInt(req.params.id)]);
  if (!event) return res.status(404).json({ error: 'Not found' });
  const attendees = dbAll('SELECT * FROM attendees WHERE event_id=? ORDER BY name', [parseInt(req.params.id)]);
  const stats = { total: attendees.length, registered: 0, attended: 0, byAffiliation: {} };
  attendees.forEach(a => {
    if (a.registered) stats.registered++;
    if (a.attended) stats.attended++;
    if (!stats.byAffiliation[a.affiliation]) stats.byAffiliation[a.affiliation] = { reg: 0, att: 0 };
    if (a.registered) stats.byAffiliation[a.affiliation].reg++;
    if (a.attended) stats.byAffiliation[a.affiliation].att++;
  });
  res.json({ ...event, attendees, stats });
});

app.put('/api/events/:id', auth, (req, res) => {
  const { name, date, type, tier, description, location } = req.body;
  dbRun('UPDATE events SET name=?,date=?,type=?,tier=?,description=?,location=? WHERE id=?', [name, date, type, tier, description, location, parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.delete('/api/events/:id', auth, (req, res) => {
  dbRun('DELETE FROM events WHERE id=?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/events/:id/attendees', auth, (req, res) => {
  res.json(dbAll('SELECT * FROM attendees WHERE event_id=? ORDER BY name', [parseInt(req.params.id)]));
});

app.post('/api/events/:id/attendees', auth, (req, res) => {
  const { name, email = '', affiliation = 'Student' } = req.body;
  const r = dbRun('INSERT INTO attendees (event_id,name,email,affiliation,registered,attended) VALUES (?,?,?,?,1,0)', [parseInt(req.params.id), name, email, affiliation]);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/events/:id/attendees/:aid', auth, (req, res) => {
  const { attended } = req.body;
  dbRun('UPDATE attendees SET attended=? WHERE id=? AND event_id=?', [attended ? 1 : 0, parseInt(req.params.aid), parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.delete('/api/events/:id/attendees/:aid', auth, (req, res) => {
  dbRun('DELETE FROM attendees WHERE id=? AND event_id=?', [parseInt(req.params.aid), parseInt(req.params.id)]);
  res.json({ ok: true });
});

// ─── MENTORS ──────────────────────────────────────────────────────────────────
app.get('/api/mentors', auth, (req, res) => {
  const { search = '', industry = '' } = req.query;
  let sql = `SELECT m.*,COUNT(DISTINCT c.id) as active_connections,ROUND(AVG(mi.rating),1) as avg_rating FROM mentors m LEFT JOIN connections c ON c.mentor_id=m.id AND c.status='Active' LEFT JOIN mentor_interactions mi ON mi.mentor_id=m.id AND mi.rating IS NOT NULL WHERE m.active=1`;
  const p = [];
  if (search) { sql += ' AND (m.name LIKE ? OR m.bio LIKE ? OR m.skills LIKE ? OR m.company LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  if (industry) { sql += ' AND m.industry=?'; p.push(industry); }
  sql += ' GROUP BY m.id ORDER BY m.name';
  res.json(dbAll(sql, p).map(parseSkills));
});

app.post('/api/mentors', auth, (req, res) => {
  const { name, email = '', phone = '', bio = '', company = '', industry = '', skills = [], hours_per_week = 2, stage_pref = 'Any', account_manager = '', linkedin = '' } = req.body;
  const r = dbRun('INSERT INTO mentors (name,email,phone,bio,company,industry,skills,hours_per_week,stage_pref,account_manager,linkedin) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [name, email, phone, bio, company, industry, JSON.stringify(skills), hours_per_week, stage_pref, account_manager, linkedin]);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/mentors/:id', auth, (req, res) => {
  const mentor = dbGet('SELECT m.*,ROUND(AVG(mi.rating),1) as avg_rating FROM mentors m LEFT JOIN mentor_interactions mi ON mi.mentor_id=m.id AND mi.rating IS NOT NULL WHERE m.id=? GROUP BY m.id', [parseInt(req.params.id)]);
  if (!mentor) return res.status(404).json({ error: 'Not found' });
  const interactions = dbAll('SELECT mi.*,s.name as startup_name FROM mentor_interactions mi LEFT JOIN startups s ON s.id=mi.startup_id WHERE mi.mentor_id=? ORDER BY mi.date DESC', [parseInt(req.params.id)]);
  const connections = dbAll('SELECT c.*,s.name as startup_name,s.industry as startup_industry,s.stage as startup_stage FROM connections c JOIN startups s ON s.id=c.startup_id WHERE c.mentor_id=? ORDER BY c.created_at DESC', [parseInt(req.params.id)]);
  res.json({ ...parseSkills(mentor), interactions, connections });
});

app.put('/api/mentors/:id', auth, (req, res) => {
  const { name, email, phone, bio, company, industry, skills, hours_per_week, stage_pref, account_manager, linkedin, active } = req.body;
  dbRun('UPDATE mentors SET name=?,email=?,phone=?,bio=?,company=?,industry=?,skills=?,hours_per_week=?,stage_pref=?,account_manager=?,linkedin=?,active=? WHERE id=?', [name, email, phone, bio, company, industry, JSON.stringify(skills), hours_per_week, stage_pref, account_manager, linkedin, active ? 1 : 0, parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post('/api/mentors/:id/interactions', auth, (req, res) => {
  const { startup_id = null, date, type = 'Meeting', description = '', rating = null } = req.body;
  const r = dbRun('INSERT INTO mentor_interactions (mentor_id,startup_id,date,type,description,rating) VALUES (?,?,?,?,?,?)', [parseInt(req.params.id), startup_id || null, date, type, description, rating || null]);
  res.json({ id: r.lastInsertRowid });
});

// ─── STARTUPS ─────────────────────────────────────────────────────────────────
app.get('/api/startups', auth, (req, res) => {
  const { search = '', industry = '', stage = '' } = req.query;
  let sql = `SELECT s.*,COUNT(DISTINCT f.id) as founder_count,COUNT(DISTINCT c.id) as connection_count FROM startups s LEFT JOIN founders f ON f.startup_id=s.id LEFT JOIN connections c ON c.startup_id=s.id AND c.status='Active' WHERE s.active=1`;
  const p = [];
  if (search) { sql += ' AND (s.name LIKE ? OR s.description LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
  if (industry) { sql += ' AND s.industry=?'; p.push(industry); }
  if (stage) { sql += ' AND s.stage=?'; p.push(stage); }
  sql += ' GROUP BY s.id ORDER BY s.name';
  res.json(dbAll(sql, p).map(parseNeeds));
});

app.post('/api/startups', auth, (req, res) => {
  const { name, description = '', industry = '', stage = 'Idea', founded = '', website = '', account_manager = '', needs = [], funding = 0 } = req.body;
  const r = dbRun('INSERT INTO startups (name,description,industry,stage,founded,website,account_manager,needs,funding) VALUES (?,?,?,?,?,?,?,?,?)', [name, description, industry, stage, founded, website, account_manager, JSON.stringify(needs), funding]);
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/startups/:id', auth, (req, res) => {
  const sid = parseInt(req.params.id);
  const startup = dbGet('SELECT * FROM startups WHERE id=?', [sid]);
  if (!startup) return res.status(404).json({ error: 'Not found' });
  const founders = dbAll('SELECT * FROM founders WHERE startup_id=?', [sid]);
  const updates = dbAll('SELECT * FROM startup_updates WHERE startup_id=? ORDER BY date DESC', [sid]);
  const connections = dbAll('SELECT c.*,m.name as mentor_name,m.industry as mentor_industry,m.skills as mentor_skills,m.email as mentor_email FROM connections c JOIN mentors m ON m.id=c.mentor_id WHERE c.startup_id=? ORDER BY c.created_at DESC', [sid]);
  const interactions = dbAll(`SELECT si.*, u.name as user_name, e.name as event_name
    FROM startup_interactions si LEFT JOIN users u ON u.id=si.user_id LEFT JOIN events e ON e.id=si.event_id
    WHERE si.startup_id=? ORDER BY si.date DESC`, [sid]);
  const employeeHistory = dbAll('SELECT * FROM employee_snapshots WHERE startup_id=? ORDER BY date DESC', [sid]);
  const founderEmails = founders.filter(f => f.email).map(f => f.email.toLowerCase());
  let eventAttendance = [];
  if (founderEmails.length > 0) {
    const allAtt = dbAll(`SELECT a.*, e.name as event_name, e.date as event_date, e.type as event_type, e.tier as event_tier
      FROM attendees a JOIN events e ON e.id=a.event_id ORDER BY e.date DESC`);
    eventAttendance = allAtt.filter(a => a.email && founderEmails.includes(a.email.toLowerCase()));
  }
  res.json({ ...parseNeeds(startup), founders, updates, interactions, employeeHistory, eventAttendance,
    connections: connections.map(c => ({ ...c, mentor_skills: JSON.parse(c.mentor_skills || '[]') })) });
});

app.put('/api/startups/:id', auth, (req, res) => {
  const { name, description, industry, stage, founded, website, account_manager, needs, funding, active } = req.body;
  dbRun('UPDATE startups SET name=?,description=?,industry=?,stage=?,founded=?,website=?,account_manager=?,needs=?,funding=?,active=? WHERE id=?', [name, description, industry, stage, founded, website, account_manager, JSON.stringify(needs), funding, active ? 1 : 0, parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post('/api/startups/:id/founders', auth, (req, res) => {
  const { name, email = '', phone = '', bio = '', linkedin = '', role = 'Co-Founder' } = req.body;
  const r = dbRun('INSERT INTO founders (startup_id,name,email,phone,bio,linkedin,role) VALUES (?,?,?,?,?,?,?)', [parseInt(req.params.id), name, email, phone, bio, linkedin, role]);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/founders/:id', auth, (req, res) => {
  dbRun('DELETE FROM founders WHERE id=?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

app.post('/api/startups/:id/updates', auth, (req, res) => {
  const { date, type = 'Milestone', title, description = '', url = '' } = req.body;
  const r = dbRun('INSERT INTO startup_updates (startup_id,date,type,title,description,url) VALUES (?,?,?,?,?,?)', [parseInt(req.params.id), date, type, title, description, url]);
  res.json({ id: r.lastInsertRowid });
});

// ─── STARTUP INTERACTIONS (Admin CRM) ─────────────────────────────────────────
app.get('/api/startups/:id/interactions', auth, (req, res) => {
  const interactions = dbAll(`SELECT si.*, u.name as user_name, e.name as event_name
    FROM startup_interactions si
    LEFT JOIN users u ON u.id=si.user_id
    LEFT JOIN events e ON e.id=si.event_id
    WHERE si.startup_id=? ORDER BY si.date DESC`, [parseInt(req.params.id)]);
  res.json(interactions);
});

app.post('/api/startups/:id/interactions', auth, (req, res) => {
  const { contact_name = '', date, type = 'Call', description = '', event_id = null } = req.body;
  const r = dbRun('INSERT INTO startup_interactions (startup_id,user_id,contact_name,date,type,description,event_id) VALUES (?,?,?,?,?,?,?)',
    [parseInt(req.params.id), req.session.userId, contact_name, date, type, description, event_id || null]);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/startup-interactions/:id', auth, (req, res) => {
  dbRun('DELETE FROM startup_interactions WHERE id=?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

// ─── EMPLOYEE SNAPSHOTS (BOR Reporting) ───────────────────────────────────────
app.get('/api/startups/:id/employees', auth, (req, res) => {
  res.json(dbAll('SELECT * FROM employee_snapshots WHERE startup_id=? ORDER BY date DESC', [parseInt(req.params.id)]));
});

app.post('/api/startups/:id/employees', auth, (req, res) => {
  const { date, employee_count = 0, jobs_created = 0, notes = '' } = req.body;
  const r = dbRun('INSERT INTO employee_snapshots (startup_id,date,employee_count,jobs_created,notes) VALUES (?,?,?,?,?)',
    [parseInt(req.params.id), date, employee_count, jobs_created, notes]);
  dbRun('UPDATE startups SET employees=? WHERE id=?', [employee_count, parseInt(req.params.id)]);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/employee-snapshots/:id', auth, (req, res) => {
  dbRun('DELETE FROM employee_snapshots WHERE id=?', [parseInt(req.params.id)]);
  res.json({ ok: true });
});

// ─── EVENT ATTENDANCE BY STARTUP ──────────────────────────────────────────────
app.get('/api/startups/:id/event-attendance', auth, (req, res) => {
  const founders = dbAll('SELECT email FROM founders WHERE startup_id=? AND email != ""', [parseInt(req.params.id)]);
  if (founders.length === 0) return res.json([]);
  const emails = founders.map(f => f.email.toLowerCase());
  const allAttendees = dbAll(`SELECT a.*, e.name as event_name, e.date as event_date, e.type as event_type, e.tier as event_tier
    FROM attendees a JOIN events e ON e.id=a.event_id ORDER BY e.date DESC`);
  const matched = allAttendees.filter(a => a.email && emails.includes(a.email.toLowerCase()));
  res.json(matched);
});

// ─── CONNECTIONS ──────────────────────────────────────────────────────────────
app.get('/api/connections', auth, (req, res) => {
  const { status = '' } = req.query;
  let sql = `SELECT c.*,m.name as mentor_name,m.email as mentor_email,s.name as startup_name,s.industry as startup_industry FROM connections c JOIN mentors m ON m.id=c.mentor_id JOIN startups s ON s.id=c.startup_id`;
  const p = [];
  if (status) { sql += ' WHERE c.status=?'; p.push(status); }
  sql += ' ORDER BY c.created_at DESC';
  res.json(dbAll(sql, p));
});

app.post('/api/connections/create', auth, (req, res) => {
  const { mentor_id, startup_id, notes = '' } = req.body;
  const r = dbRun("INSERT INTO connections (mentor_id,startup_id,status,notes) VALUES (?,?,'Pending',?)", [mentor_id, startup_id, notes]);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/connections/:id', auth, (req, res) => {
  const { status, notes, startup_rating, mentor_rating } = req.body;
  dbRun('UPDATE connections SET status=?,notes=?,startup_rating=?,mentor_rating=? WHERE id=?', [status, notes, startup_rating || null, mentor_rating || null, parseInt(req.params.id)]);
  res.json({ ok: true });
});

// ─── MATCHING ─────────────────────────────────────────────────────────────────
app.get('/api/match/:startup_id', auth, (req, res) => {
  const startup = dbGet('SELECT * FROM startups WHERE id=?', [parseInt(req.params.startup_id)]);
  if (!startup) return res.status(404).json({ error: 'Not found' });
  const needs = JSON.parse(startup.needs || '[]');
  const existingMentorIds = dbAll("SELECT mentor_id FROM connections WHERE startup_id=? AND status IN ('Active','Pending')", [parseInt(req.params.startup_id)]).map(c => c.mentor_id);
  const mentors = dbAll(`SELECT m.*,COUNT(DISTINCT c.id) as active_connections,ROUND(AVG(mi.rating),1) as avg_rating FROM mentors m LEFT JOIN connections c ON c.mentor_id=m.id AND c.status='Active' LEFT JOIN mentor_interactions mi ON mi.mentor_id=m.id AND mi.rating IS NOT NULL WHERE m.active=1 GROUP BY m.id`, []);
  const scored = mentors.map(m => {
    const skills = JSON.parse(m.skills || '[]');
    const overlap = needs.filter(n => skills.some(s => s.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(s.toLowerCase()))).length;
    const score = needs.length > 0 ? Math.round((overlap / needs.length) * 100) : 0;
    const hasCapacity = m.hours_per_week > (m.active_connections * 1.5);
    const alreadyConnected = existingMentorIds.includes(m.id);
    const matching_skills = skills.filter(s => needs.some(n => s.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(s.toLowerCase())));
    return { ...parseSkills(m), match_score: score, has_capacity: hasCapacity, already_connected: alreadyConnected, matching_skills };
  }).sort((a, b) => b.match_score - a.match_score || (b.has_capacity ? 1 : 0) - (a.has_capacity ? 1 : 0));
  res.json({ startup: parseNeeds(startup), mentors: scored });
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────
app.get('/api/reports', auth, (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const y = String(year);
  res.json({
    year,
    eventsByTier: dbAll(`SELECT e.tier,COUNT(DISTINCT e.id) as events,COUNT(a.id) as registered,SUM(CASE WHEN a.attended=1 THEN 1 ELSE 0 END) as attended FROM events e LEFT JOIN attendees a ON a.event_id=e.id WHERE strftime('%Y',e.date)=? GROUP BY e.tier ORDER BY e.tier`, [y]),
    eventsByType: dbAll(`SELECT type,COUNT(*) as count FROM events WHERE strftime('%Y',date)=? GROUP BY type ORDER BY count DESC`, [y]),
    attendeesByAffiliation: dbAll(`SELECT a.affiliation,COUNT(*) as registered,SUM(a.attended) as attended FROM attendees a JOIN events e ON e.id=a.event_id WHERE strftime('%Y',e.date)=? GROUP BY a.affiliation ORDER BY registered DESC`, [y]),
    mentorStats: {
      total: (dbGet('SELECT COUNT(*) as c FROM mentors WHERE active=1', []) || {c:0}).c,
      active_connections: (dbGet("SELECT COUNT(*) as c FROM connections WHERE status='Active'", []) || {c:0}).c,
      completed_connections: (dbGet("SELECT COUNT(*) as c FROM connections WHERE status='Completed'", []) || {c:0}).c,
      total_interactions: (dbGet('SELECT COUNT(*) as c FROM mentor_interactions', []) || {c:0}).c,
      interactions_this_year: (dbGet(`SELECT COUNT(*) as c FROM mentor_interactions WHERE strftime('%Y',date)=?`, [y]) || {c:0}).c,
      avg_rating: (dbGet('SELECT ROUND(AVG(rating),1) as r FROM mentor_interactions WHERE rating IS NOT NULL', []) || {r:null}).r,
      by_industry: dbAll("SELECT m.industry,COUNT(DISTINCT m.id) as mentors,COUNT(DISTINCT c.id) as connections FROM mentors m LEFT JOIN connections c ON c.mentor_id=m.id AND c.status='Active' WHERE m.active=1 GROUP BY m.industry ORDER BY mentors DESC", []),
    },
    startupStats: {
      total: (dbGet('SELECT COUNT(*) as c FROM startups WHERE active=1', []) || {c:0}).c,
      by_stage: dbAll('SELECT stage,COUNT(*) as count FROM startups WHERE active=1 GROUP BY stage', []),
      by_industry: dbAll('SELECT industry,COUNT(*) as count FROM startups WHERE active=1 GROUP BY industry ORDER BY count DESC', []),
      total_funding: (dbGet('SELECT SUM(funding) as total FROM startups WHERE active=1', []) || {total:0}).total || 0,
      updates_this_year: (dbGet(`SELECT COUNT(*) as c FROM startup_updates WHERE strftime('%Y',date)=?`, [y]) || {c:0}).c,
      investments_this_year: (dbGet(`SELECT COUNT(*) as c FROM startup_updates WHERE type='Investment' AND strftime('%Y',date)=?`, [y]) || {c:0}).c,
    },
    borMetrics: {
      total_companies: (dbGet('SELECT COUNT(*) as c FROM startups WHERE active=1', []) || {c:0}).c,
      total_employees: (dbGet('SELECT COALESCE(SUM(employees),0) as c FROM startups WHERE active=1', []) || {c:0}).c,
      total_jobs_created: (dbGet('SELECT COALESCE(SUM(jobs_created),0) as c FROM employee_snapshots es WHERE es.id IN (SELECT MAX(e2.id) FROM employee_snapshots e2 GROUP BY e2.startup_id)', []) || {c:0}).c,
      snapshots_this_year: dbAll(`SELECT es.*, s.name as startup_name FROM employee_snapshots es JOIN startups s ON s.id=es.startup_id WHERE strftime('%Y',es.date)=? ORDER BY es.date DESC`, [y]),
      interactions_this_year: (dbGet(`SELECT COUNT(*) as c FROM startup_interactions WHERE strftime('%Y',date)=?`, [y]) || {c:0}).c,
      startups_with_employees: dbAll('SELECT s.name, s.employees, s.industry, s.stage FROM startups s WHERE s.active=1 AND s.employees > 0 ORDER BY s.employees DESC', []),
    },
  });
});

// ─── SEARCH ───────────────────────────────────────────────────────────────────
app.get('/api/search', auth, (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json({ mentors: [], startups: [], events: [] });
  const like = `%${q}%`;
  res.json({
    mentors: dbAll('SELECT id,name,industry,company FROM mentors WHERE active=1 AND (name LIKE ? OR company LIKE ? OR skills LIKE ?) LIMIT 4', [like, like, like]),
    startups: dbAll('SELECT id,name,industry,stage FROM startups WHERE active=1 AND (name LIKE ? OR description LIKE ?) LIMIT 4', [like, like]),
    events: dbAll('SELECT id,name,date,type FROM events WHERE (name LIKE ? OR description LIKE ?) LIMIT 4', [like, like]),
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
async function main() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏛️  JPEC CRM running at http://localhost:${PORT}`);
    console.log(`🔑 Default login: admin@jpec.uiowa.edu / jpec2026\n`);
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
