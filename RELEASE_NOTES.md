# RELEASE NOTES — RBG School ERP
## Version 1.0.0
**Release Date:** September 2026  
**Status:** Release Candidate — Ready for Staging Deployment and UAT

---

## Overview

RBG School ERP is a complete, production-hardened K–12 school management system covering the full academic lifecycle from admission to TC issuance. The system is designed around three primary daily users — Teacher, Student, and Principal — with supporting roles for administration, finance, library, transport, and HR.

---

## Major Features

### Academic Structure
- Academic Year → Class → Students (no Section concept)
- Pre-Nursery, Nursery, LKG, UKG, Class I–XII
- Stream support for Class XI–XII: Science, Commerce, Humanities
- Atomic roll-number allocation per class per academic year
- Student promotion with full history preservation
- Transfer Certificate (TC) workflow with enrollment closure

### Authentication & Authorization
- JWT-based authentication with secure HttpOnly cookie option
- 18-role system: `super_admin`, `school_admin`, `principal`, `vice_principal`, `academic_coordinator`, `teacher`, `class_teacher`, `exam_coordinator`, `admission_officer`, `accountant`, `librarian`, `transport_admin`, `hr`, `receptionist`, `staff`, `student`, `parent`, `driver`
- Centralized permission engine with role-level and per-user-level overrides
- IDOR protection: parent-child ownership, teacher class/subject scoping, student self-isolation
- Negative permission overrides (deny specific users specific permissions)

### Teacher Portal (Workflow-First)
- Today's schedule at login — current period highlighted
- Attendance marking with P/A/L toggles, Mark All Present, live counter
- Homework assignment and submission review
- Study material management
- Marks entry withUP Board grade preview (A1–E) aligned to backend
- Real API save — backend recalculates authoritative grade on save
- Class roster and student profiles
- Leave request approval (for Class Teachers)
- Class performance reports

### Student Portal (Learning-First)
- Next Class widget based on current time and timetable
- Day-wise timetable view
- Homework list with subject filter
- Attendance calendar (monthly P/A/L view)
- Published-only exam results (unpublished marks never exposed)
-UP Board grade cards
- Fee ledger (offline — cash/DD only; clearly labelled)
- Library book status
- Leave application
- Notifications

### Principal Portal (Analytics-First)
- Executive KPI dashboard: enrollment, today's attendance, pending approvals
- Global student search (by name, admission number, roll number)
- School attendance trend chart
- Academic performance analytics
- Teacher overview with class assignments
- Admissions pipeline management
- Central approvals hub (leave requests + admissions)
- Notice publishing
- Report generation

### Admissions Workflow
- Public admission application form (`POST /api/v1/admissions/apply`)
- Hardened endpoint: rate limited (5/15min per IP), strict field whitelist, role injection blocked, response sanitized
- Admin review workflow: Draft → Submitted → Under Review → Document Verification → Approved → Admitted
- On "Admit": creates User + Student + Parent records atomically
- Admission number auto-generated

### Academic Workflows
- Attendance marking and monthly reports
- Homework assignment, submission, and review
- Marks entry withUP Board grading (A1, A2, B1, B2, C1, C2, D, E)
- Marks publish workflow (unpublished marks hidden from students/parents)
- Rank computation
- Report Card generation
- Fee receipt generation
- Student ID Card

### Public Website
- Home, About, Academics, Admissions, Facilities, Events, Gallery, Notices, Results, Contact
- Public notices API (only `isPublished=true` records)
- Public events API (only `isPublic=true` records)
- Admissions form connected to real API
- Results page is informational only (CBSE grading table + portal login CTA) — no private data exposed
- SEO meta tags on all pages
- Mobile responsive

### Security
- Helmet.js security headers
- CORS restricted to configured origins
- MongoDB sanitization (express-mongo-sanitize)
- Rate limiting (global 100/10min + admission-specific 5/15min)
- JWT secret required in production (throws on missing)
- Password hashing with bcrypt (12 rounds)
- Sensitive fields stripped from all responses (password, resetPasswordToken, lockUntil)
- No academic Section concept — fully eradicated

---

## Grading System

CBSE 10-Point Scale — used consistently in backend, frontend preview, and report cards:

| Marks % | Grade | Grade Point |
|---------|-------|-------------|
| 91–100 | A1 | 10 |
| 81–90 | A2 | 9 |
| 71–80 | B1 | 8 |
| 61–70 | B2 | 7 |
| 51–60 | C1 | 6 |
| 41–50 | C2 | 5 |
| 33–40 | D  | 4 |
| Below 33 | E | 0 |

---

## Security Test Results

```
PASS: 39/39
FAIL:  0/39

Tests: Authentication, Privilege Escalation, IDOR Protection,
       Permission Overrides, Role Dashboard Access, Sensitive Field Leaks,
       Role Isolation, Section Eradication
```

---

## Known V1 Limitations

| Feature | Status | Notes |
|---------|--------|-------|
| Online Payments | **Not implemented** | Fee ledger is offline/internal. Cash/DD at counter. Clearly communicated in Student portal. |
| File Uploads | **Not implemented** | No multer/storage configured. Upload buttons are not shown. |
| Automated Backups | **Manual procedure only** | See `docs/backup_recovery.md` for mongodump/mongorestore procedure. |
| Email Notifications | **Not configured** | SMTP config exists in `.env` but no SMTP provider connected. |
| SMS/Push Notifications | **Not implemented** | Not in V1 scope. |
| Real Gallery Images | **Placeholders** | School must supply real media assets. |
| XML Sitemap / robots.txt | **Not generated** | Low priority for V1. |

---

## Deployment Requirements

### Prerequisites
- Node.js 18+
- MongoDB 6.0+ (Replica Set recommended for production)
- npm

### Environment Variables Required
```env
NODE_ENV=production
MONGO_URI=mongodb+srv://.../<dbname>
JWT_SECRET=<64-char minimum random string>
CORS_ORIGIN=https://yourdomain.com
PORT=5000
SCHOOL_NAME=RBG School
SCHOOL_ADDRESS=<actual address>
SCHOOL_PHONE=<actual phone>
SCHOOL_EMAIL=<actual email>
```

### Installation
```bash
git clone <repository>
cd college-management-system
npm install
```

### Staging Seed
```bash
MONGO_URI=mongodb://localhost:27017/school_management_staging \
  node seeds/seed-staging.js --destroy
```

### Start (Production)
```bash
NODE_ENV=production node server.js
```

### Start (Staging)
```bash
NODE_ENV=staging MONGO_URI=mongodb://localhost:27017/school_management_staging \
  node server.js
```

### Security Regression
```bash
# Requires server running on port 5000 with seed data
node security_matrix.js
# Expected: 39/39 PASS
```

### Backup
See `docs/backup_recovery.md`

---

## Staging UAT Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@staging.test | Admin@123 |
| Principal | principal@staging.test | Principal@123 |
| Teacher | ravi.sharma@staging.test | Teacher@123 |
| Class Teacher | priya.nair@staging.test | Teacher@123 |
| Student | arjun@staging.test | Student@123 |
| Parent | mr.kumar@staging.test | Parent@123 |
| Accountant | accountant@staging.test | Staff@123 |
| Librarian | librarian@staging.test | Staff@123 |

> ⚠️ All staging accounts are clearly labelled [STAGING] and connect to the staging database only.

---

## Go-Live Classification

| Module | Status | Notes |
|--------|--------|-------|
| Authentication | ✅ **READY** | JWT, bcrypt, session management |
| Authorization / RBAC | ✅ **READY** | 39/39 security tests PASS |
| Teacher Portal | ✅ **READY** | Workflow-first, real API |
| Student Portal | ✅ **READY** | Learning-first, IDOR protected |
| Principal Portal | ✅ **READY** | Analytics-first, search, approvals |
| Academic Workflow | ✅ **READY** | Attendance → Homework → Marks → Results |
| Admissions | ✅ **READY** | Public endpoint hardened, full workflow |
| Attendance | ✅ **READY** | Daily marking, monthly reports |
| Homework | ✅ **READY** | Assign, submit, review |
| Marks / Grading | ✅ **READY** |UP Board consistent, server-authoritative |
| Results | ✅ **READY** | Published-only protection |
| Fee Ledger | ✅ **READY WITH LIMITATION** | Offline only — no online payments |
| Public Website | ✅ **READY** | 10 pages, API-connected, mobile responsive |
| Mobile | ✅ **READY** | Responsive on 320px–1440px |
| Security | ✅ **READY** | 39/39 PASS, hardened headers, rate limiting |
| Database | ✅ **READY** | MongoDB with indexes, atomic operations |
| Backups | ⚠️ **OPERATIONAL REQUIREMENT** | Manual procedure; automate via cron before full production |
| File Uploads | ⚠️ **READY WITH LIMITATION** | Not implemented; UI correctly omits upload buttons |
| Online Payments | ➖ **NOT REQUIRED FOR V1** | Offline fee ledger; accepted V1 limitation |
| Secondary Portals | ✅ **READY** | Functional, secure, smoke-tested |
