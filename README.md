# 🏫 RBG School — College Management System

A professional, full-stack **School Management System** for Classes I–XII built with **Node.js**, **Express**, **MongoDB**, and a fully responsive **HTML/CSS/JS frontend dashboard**.

---

## 🚀 Features

### 👨‍💼 Admin
- Full dashboard with live stats & charts
- Student enrollment, promotion, TC management
- Faculty / staff management
- Attendance tracking & reports
- Marks entry, grade computation, result publishing
- Notice board (pinned, categorized)
- Fee management & collection
- Timetable management
- Export reports (PDF/Excel ready)

### 👩‍🏫 Faculty
- Mark class attendance (bulk)
- Enter subject marks
- View class roster & student profiles
- Post notices
- Apply for leave

### 👨‍🎓 Student / Parent
- View own attendance summary
- View published results / report card
- View notices
- Fee statement

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 18+ |
| Framework | Express.js 4 |
| Database | MongoDB + Mongoose |
| Auth | JWT (access token + httpOnly cookie) |
| Security | Helmet, CORS, Rate Limiting, Mongo-Sanitize |
| Validation | Express-Validator + Joi |
| Logging | Winston |
| Frontend | Vanilla HTML5 / CSS3 / ES6+ |
| Charts | Chart.js 4 |
| Icons | Font Awesome 6 |
| Fonts | Inter + Poppins (Google Fonts) |

---

## 📁 Project Structure

```
college-management-system/
├── config/          # DB + env config
├── controllers/     # Route handlers
├── models/          # Mongoose schemas
├── routes/          # Express routers
├── middleware/      # Auth, role, error, validate
├── services/        # Business logic layer
├── utils/           # Helpers (token, hash, features, logger)
├── validators/      # Input validation rules
├── seeds/           # Database seeder
├── public/          # Frontend (HTML, CSS, JS)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── uploads/         # File uploads
├── logs/            # Winston log files
├── server.js        # App entry point
└── .env.example
```

---

## ⚡ Quick Start

### 1. Install dependencies
```bash
cd college-management-system
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret
```

### 3. Seed the database
```powershell
# Only for a disposable local development database.
$env:NODE_ENV = "development"
$env:ALLOW_DEMO_SEED = "1"
$env:MONGO_URI = "mongodb://127.0.0.1:27017/school_management_dev"
npm run seed
```
The seed command refuses to run without explicit opt-in and a loopback MongoDB URI
using the exact `school_management_dev` database. Never seed production or reuse a
database containing real school records. Demo accounts are synthetic development
fixtures; the application does not publish demo credentials.

### 4. Start the server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### 5. Open browser
```
http://localhost:5000
```

---

## Demo Credentials

The public login page does not display demo credentials. Seed scripts create synthetic
accounts only after explicit opt-in against the exact loopback development or staging
database. Never use seeded accounts or deploy a seeded database in shared or production
environments. Disable or rotate demo accounts created by earlier versions before release.

---

## 📡 API Endpoints

### Auth
```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
PUT    /api/v1/auth/update-profile
PUT    /api/v1/auth/change-password
POST   /api/v1/auth/forgot-password
PUT    /api/v1/auth/reset-password       (body: { token, password })
PUT    /api/v1/auth/activate             (body: { token, password })
```

### Distributed rate limiting

Authentication login, activation, password recovery, and password reset use separate
Redis-backed limits when `REDIS_URL` is configured. Production startup requires a valid
`redis://` or `rediss://` URL and does not fall back to per-process memory limits.
`TRUST_PROXY_HOPS` must match the number of trusted reverse proxies; leave it at `0`
unless the hosting topology is explicitly documented.

### Email delivery and recovery tokens

The email outbox is durable in MongoDB; BullMQ/Redis carries only delivery IDs. A
worker reconciles pending outbox rows periodically, so MongoDB remains the source
of truth after Redis queue loss. SMTP delivery is at-least-once: a worker crash
after the SMTP provider accepts a message but before MongoDB records success can
cause a duplicate message. Run the worker under a process supervisor and monitor
its ready/error/health log events; the API `/health` endpoint does not include
worker state.
The database role used by the API and worker must be able to create the declared
unique idempotency and TTL indexes, or those indexes must be provisioned before
email requests are enabled.

Admission creation uses a compensating saga, not a MongoDB transaction. Each
attempt writes a durable saga ID, owner lease, step, planned document IDs, and
activation-token hashes to the admission before persisting each activation
token. The worker claims stale `Admitting` sagas and compensates by those exact
IDs. It removes only saga-created parent records, preserves reused parent
accounts, and removes only the child link for the planned student. It then
returns the admission to `Approved`. The saga commit is a single admission update
that sets `Admitted` and a matching durable commit marker; status routes cannot write
either field. Activation outbox rows carry that saga ID, and both reconciliation
and the worker require the matching commit marker before release or SMTP.

This remains a saga with eventual compensation, not cross-collection atomicity.
Roll-number counter increments are intentionally not reversed, so failed attempts
can leave gaps rather than risk reusing a concurrently allocated number.
If a journal is missing/incomplete or a compensation write fails, the admission
stays `Admitting` with saga state `manual_review`; an operator must inspect and
resolve it. Do not manually set the admission status to `Admitted`. Legacy
unjournaled `Admitting` rows and staged E1 rows without a saga ID are not
auto-repaired or sent. Before rollout, stop old API/worker processes, reconcile
legacy rows, then deploy the marker-aware API and worker together.

### Enrollment and transfer-certificate dates

Admission approval requires an explicit school-local `YYYY-MM-DD` enrollment
effective date. The date must fall within exactly one configured active academic
year; approval stores both values, and the durable admission-saga attempt copies
them before creating the Student. A retry reuses the approved date/year and
cannot silently choose a new date. Account activation remains a separate step.
Direct Student creation also requires an explicit effective date that matches
the selected configured academic year. Missing or ambiguous dates/years fail
closed; legacy records are not backfilled automatically.

Transfer-certificate issuance requires an explicit inclusive school-local
`lastEnrolledDate`. It is stored separately from `tcDate`, which remains the TC
issue timestamp. Enrollment history stores the following day as its exclusive
`promotedDate` boundary using the shared school-date helper. Existing TC records
and incomplete historical enrollment dates are preserved without inference.

Email reconciliation uses a renewable MongoDB owner lease to avoid overlap
between worker processes, and processes at most 500 rows per cleanup category
per cycle. Remaining rows are handled by later scheduled cycles. Delivery
processing also renews its per-row lease and checks the ownership token before
changing delivery state. SMTP remains at-least-once: a process can crash after a
provider accepts a message and before MongoDB records it as sent, so a retry can
deliver a duplicate.

The User model adds sparse indexes on `activationToken` and `resetPasswordToken`.
Provision these indexes in production before enabling token endpoints, alongside
the EmailDelivery unique idempotency and TTL indexes. Index creation requires
the documented migration/database privilege; schema declarations alone do not
prove production indexes exist.

Generate current and previous email encryption keys as base64 encodings of 32
cryptographically random bytes and store them in a secret manager. Configure
`EMAIL_ENCRYPTION_KEY_VERSION` with `EMAIL_ENCRYPTION_KEY`. During one rotation,
move the old current version/key into
`EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION` and `EMAIL_ENCRYPTION_KEY_PREVIOUS`, then
install the new current pair. Retain the previous pair until all ciphertext
created with it has expired and been purged; this implementation supports one
previous version at a time. Existing E1 ciphertext created with the earlier
passphrase-hashing format must be drained or migrated offline before deploying
this strict key format; the worker will dead-letter an unreadable row while
retaining its ciphertext only for the bounded retention period. Never put these
values in source control or logs.

Recovery links necessarily carry a bearer token in the initial page URL. The
page removes the query string immediately, sends the token in a JSON request
body, and sets a no-referrer policy. Configure reverse proxies, CDNs, WAFs, and
web servers to omit query strings and request bodies from access logs; apply the
same rule to email security scanners and observability tooling.

The focused unit checks require no external services:

```bash
npm run test:e1-r1:unit
```

The guarded E1-R2 admission recovery and HTTP boundary suite is:

```bash
npm run test:e1-r2:admission
```

The auth-race and admission-saga integration scripts require an explicit local
`MONGO_TEST_URI` whose database is named `erp_security_e1r1_*`, plus
`ALLOW_E1R1_TEST_WRITES=1`. The E1-R2 saga integration requires a local
`erp_security_e1r2_*` database and `ALLOW_E1R2_TEST_WRITES=1`; it does not use
Redis or SMTP. The email-worker integration additionally requires
an explicit local `REDIS_TEST_URL` with a database path such as `/4` and
`ALLOW_E1R1_REDIS_WRITES=1`. Those scripts only remove records/job IDs they
created; they do not drop a database or scan shared Redis prefixes. The browser
E2E suite drops its isolated `erp_security_e2e_*` database only when
`ALLOW_E2E_TEST_DB_DROP=1` is explicitly set.
The legacy destructive `test:phase-c` and direct MongoDB integration scripts
also require `ALLOW_PHASEC_TEST_DB_DROP=1` and
`ALLOW_MONGODB_IT_TEST_DB_DROP=1`, respectively.

For local testing, start a disposable Redis instance and set `NODE_ENV=test` and
`REDIS_TEST_URL=redis://127.0.0.1:6379`. Run:

```bash
npm run test:redis-rate-limit
```

The test starts two local application instances sharing a unique Redis key prefix,
verifies that the fourth request is rejected across both instances, and verifies that
restarting one instance does not reset the counter. Never point these commands at
production Redis.

### Students
```
GET    /api/v1/students             (Admin, Faculty)
POST   /api/v1/students             (Admin)
GET    /api/v1/students/:id         (Admin, Faculty)
PUT    /api/v1/students/:id         (Admin)
DELETE /api/v1/students/:id         (Admin)
GET    /api/v1/students/class/:class
POST   /api/v1/students/promote
PUT    /api/v1/students/:id/fees  (retired; responds 410)
GET    /api/v1/students/stats
GET    /api/v1/students/my-profile  (Student)
```

Fee collection uses `POST /api/v1/fees/payment` with `{ studentFee, amount, method, remarks, idempotencyKey }`.
The key identifies one payment attempt and must be reused unchanged when retrying an uncertain request.
The legacy student-fee write route is retired; clients must use the fee ledger endpoint. Collection
requires MongoDB transaction support and a unique sparse `Payment.idempotencyKey` index. The service
ensures that index before accepting a collection; provision it ahead of rollout if the database role
cannot create indexes. Before fee collection is enabled, an operator must also provision or verify
the unique, non-sparse `Payment.receiptNumber` index. The required index definitions are
`{ idempotencyKey: 1 }` with `{ unique: true, sparse: true }` and `{ receiptNumber: 1 }` with
`{ unique: true }`, matching the Payment schema. Schema declarations do not prove that either
index exists in the deployment database; verify or provision both through the approved deployment
procedure before enabling collection. The service attempts to ensure the idempotency index, but does
not create or verify the receipt-number index.

### Faculty
```
GET    /api/v1/faculty
POST   /api/v1/faculty
GET    /api/v1/faculty/:id
PUT    /api/v1/faculty/:id
DELETE /api/v1/faculty/:id
POST   /api/v1/faculty/:id/leave
GET    /api/v1/faculty/stats
```

### Attendance
```
POST   /api/v1/attendance/mark
GET    /api/v1/attendance/class/:class/:section
GET    /api/v1/attendance/student/:id/summary
GET    /api/v1/attendance/student/:id/monthly
GET    /api/v1/attendance/report
PUT    /api/v1/attendance/:id
GET    /api/v1/attendance/low
```

### Marks
```
POST   /api/v1/marks
GET    /api/v1/marks/student/:id
GET    /api/v1/marks/class
POST   /api/v1/marks/publish
POST   /api/v1/marks/rank
GET    /api/v1/marks/my-marks
GET    /api/v1/marks/stats
DELETE /api/v1/marks/:id
```

### Notices
```
GET    /api/v1/notices
POST   /api/v1/notices
GET    /api/v1/notices/pinned
GET    /api/v1/notices/:id
PUT    /api/v1/notices/:id
DELETE /api/v1/notices/:id
PUT    /api/v1/notices/:id/pin
GET    /api/v1/notices/type/:type
```

#### Notice visibility policy

`notices.create` permits creating notices but does not grant unrestricted access to
other notices. Recipient reads (list, pinned, type-filtered, and detail) include only
published notices whose `publishDate` is missing/null or no later than the current
time, and whose `expiryDate` is missing/null or no earlier than the current time;
audience and target-class restrictions also apply. Date comparisons use stored
timestamps (UTC instants), not local-time string comparisons.

Unrestricted notice management reads, including unpublished, future-dated, expired,
and audience/class-restricted notices, require `notices.view-management`. The
School Admin role has this permission because it has notice update/delete rights;
Super Admin retains wildcard access. Creating a notice alone does not grant this
management visibility. Protected event access for Teachers and Principals remains
unchanged and is an unresolved future role-policy decision.

---

## 🔒 Security Features

- JWT authentication with httpOnly cookies
- Bcrypt password hashing (12 rounds)
- Account lockout after 5 failed login attempts
- Rate limiting (200 req/15min global, 20 req/15min for auth)
- MongoDB query injection sanitization
- XSS protection via Helmet
- Input validation on all routes
- Soft delete (data preservation)

---

## 📊 Grading System (CBSE)

| Marks % | Grade | Grade Point |
|---------|-------|-------------|
| 90–100  | A1    | 10 |
| 80–89   | A2    | 9  |
| 70–79   | B1    | 8  |
| 60–69   | B2    | 7  |
| 50–59   | C1    | 6  |
| 40–49   | C2    | 5  |
| 33–39   | D     | 4  |
| Below 33| E (Fail) | 0 |

---

## 📝 License

MIT License — Free to use for educational purposes.
