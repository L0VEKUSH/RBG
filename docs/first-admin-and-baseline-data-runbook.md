# RBG School ERP — First-Admin Bootstrap and Baseline Data Runbook

This runbook establishes the official operator-controlled procedure for creating the initial privileged school administrator, provisioning the approved 15-class academic structure, and verifying database readiness prior to production launch.

---

## 1. Authorization and Operator Roles

Only designated Systems Operations personnel and authorized School Trustees are permitted to execute the first-admin bootstrap procedure.

- **Primary Operator:** Lead Systems Engineer or Infrastructure Owner.
- **Witness / Approver:** School Trustee, Principal, or Designated Compliance Officer.
- **Restrictions:**
  - Public registration endpoints for privileged roles are permanently disabled (`/api/v1/auth/register` returns `410 Gone`).
  - No synthetic or automated demo seed scripts (`seeds/seed.js`, `seeds/seed-staging.js`) may ever be executed against production or pre-production databases.
  - The bootstrap script enforces single-use first-admin creation and fails closed if any account with `super_admin`, `school_admin`, or `admin` role already exists.

---

## 2. Target Database Identification and Verification

Every bootstrap and validation operation requires explicit, operator-confirmed target parameters matching the invoking process's `MONGO_URI`.

### Target Verification Parameters
- `--expected-host=<hostname>` (e.g., MongoDB cluster hostname)
- `--expected-port=<port|srv>` (e.g., `srv` for Atlas, or `27017`)
- `--expected-db=<database>` (e.g., `school_management_prod`)

### Confirmation Safeguards
1. **Target Identity Match:** The script parses `MONGO_URI` using standard URL parsing and verifies that the hostname, port, and database name match the command-line parameters exactly.
2. **Double Confirmation on Execution:**
   - Dry-run mode (`--execute` omitted) inspects eligibility and reports the proposed administrator without modifying the database.
   - Execution mode requires `--execute`, `--confirm-production-target=<expectedHost>/<expectedDatabase>`, and `--confirm-bootstrap-first-admin`.
3. **No Credential Exposure:** Neither `MONGO_URI` nor passwords appear in command-line arguments, console output, or log streams.

---

## 3. Secure First-Admin Account Access & Concurrency Lifecycle

The first administrator account is created through the audited bootstrap CLI (`scripts/bootstrap-first-admin.js`).

### Password Security Policy
- Passwords **must never** be passed as command-line arguments (the CLI actively rejects `--password` flags to prevent leakage in process tables and shell history).
- The password is provided securely via the `BOOTSTRAP_ADMIN_PASSWORD` environment variable or entered interactively via a masked terminal prompt.
- **Complexity Requirements:**
  - Minimum 12 characters.
  - At least one uppercase letter (`A-Z`).
  - At least one lowercase letter (`a-z`).
  - At least one numeric digit (`0-9`).
  - At least one special symbol (`!@#$%^&*(),.?":{}|<>`).
- Passwords are encrypted before persistence using `bcrypt` (12 rounds of salt) via the `User` schema's pre-save hook.

### Concurrency Fencing & Atomic Lock Lifecycle
1. **Atomic CAS Lock:** Uses `WorkerLease` document `bootstrap_first_admin` with monotonically increasing `generation` fencing and `state: 'in_progress'`.
2. **Mutual Exclusion:** If an active lease is held (`leaseUntil > now`), concurrent operators immediately receive `CONCURRENT_BOOTSTRAP_IN_PROGRESS`.
3. **Stale Fencing:** If an operation expires, a new operator re-acquires the lease by incrementing the generation. If the stale operator wakes up, any attempts to renew or finalize the lock fail with `STALE_LOCK_OWNER` or `LEASE_LOST`, preventing split-brain overwrites.
4. **Heartbeat Renewal:** Active operations renew the lease via `renewBootstrapLock` **prior to entering the transaction**. If renewal fails (`LEASE_LOST`), the operation stops immediately — no account creation is attempted.
5. **Durable Completion (Two-Part):**
   - A `bootstrap_permanent_marker` document (no `leaseUntil`, `state: 'completed'`) is written **inside the transaction** alongside the user and audit records.
   - The transient `bootstrap_first_admin` lease is then transitioned to `state: 'completed'` outside the transaction.
   - Any subsequent attempt immediately halts with `BOOTSTRAP_ALREADY_COMPLETED` even if the transient lock is somehow deleted.

### MongoDB Transaction Requirement
> **IMPORTANT:** First-admin bootstrap requires MongoDB multi-document transaction support (MongoDB 4.0+, replica set or sharded cluster). Standalone MongoDB does NOT support transactions. The bootstrap will fail closed with `TRANSACTIONS_UNAVAILABLE` on unsupported deployments — there is **no non-transactional fallback**.

The transaction guarantees atomicity across three writes:
1. `User` document creation.
2. `AuditLog` document creation (records the bootstrap action with `authenticatedSession: false`).
3. `WorkerLease` permanent marker (`bootstrap_permanent_marker`) with no TTL field.

If any of these three writes fails (including an `AuditLog` failure), the entire transaction is aborted and **no records persist**. The lock is released for a clean operator retry.

### Password Security
- The `BOOTSTRAP_ADMIN_PASSWORD` environment variable is deleted from `process.env` immediately after being read by the script.
- Passwords never appear in process arguments, log output, or error traces.

### Crash Recovery Guarantee
- If the process crashes **before** the transaction commits: no user, no audit, no permanent marker. The 5-minute lease expires; a new operator can retry cleanly.
- If the process crashes **after** the transaction commits but before the transient lock is marked completed: the permanent marker exists and prevents reacquisition. The user and audit exist and are correct.
- If the process crashes **during** the transaction commit: MongoDB's distributed commit protocol ensures the transaction either fully commits or fully aborts. No partial writes survive.

### Bootstrap Execution Procedure

```bash
# Step 1: Perform dry-run validation
MONGO_URI="mongodb+srv://.../school_management_prod" node scripts/bootstrap-first-admin.js \
  --expected-host=cluster0.example.mongodb.net \
  --expected-port=srv \
  --expected-db=school_management_prod \
  --name="System Administrator" \
  --email="admin@school.edu.in" \
  --role=super_admin

# Step 2: Execute account creation (interactive password prompt)
MONGO_URI="mongodb+srv://.../school_management_prod" node scripts/bootstrap-first-admin.js \
  --expected-host=cluster0.example.mongodb.net \
  --expected-port=srv \
  --expected-db=school_management_prod \
  --confirm-production-target=cluster0.example.mongodb.net/school_management_prod \
  --confirm-bootstrap-first-admin \
  --name="System Administrator" \
  --email="admin@school.edu.in" \
  --role=super_admin \
  --execute
```

---

## 4. Approved 15-Class Structure & Academic Data Approval

The school structure consists of **exactly 15 logical class levels**. An additional `Pre-Nursery` class is **not** included.

### Canonical Stored Values and Approved Aliases

| Logical Grade | Canonical Stored Enum | Display Label | Accepted Aliases | Academic Level |
| :--- | :--- | :--- | :--- | :--- |
| **1. Nursery / NC** | `'Nursery'` | Nursery / NC | `NC`, `nc`, `nursery`, `Nursery / NC` | Pre-Primary |
| **2. KG-1** | `'LKG'` | KG-1 | `KG-1`, `kg-1`, `KG 1`, `KG1`, `LKG`, `lkg` | Pre-Primary |
| **3. KG-2** | `'UKG'` | KG-2 | `KG-2`, `kg-2`, `KG 2`, `KG2`, `UKG`, `ukg` | Pre-Primary |
| **4. Class 1** | `'1'` | Class 1 | `Class 1`, `class-1`, `1` | Primary |
| **5. Class 2** | `'2'` | Class 2 | `Class 2`, `class-2`, `2` | Primary |
| **6. Class 3** | `'3'` | Class 3 | `Class 3`, `class-3`, `3` | Primary |
| **7. Class 4** | `'4'` | Class 4 | `Class 4`, `class-4`, `4` | Primary |
| **8. Class 5** | `'5'` | Class 5 | `Class 5`, `class-5`, `5` | Primary |
| **9. Class 6** | `'6'` | Class 6 | `Class 6`, `class-6`, `6` | Middle |
| **10. Class 7** | `'7'` | Class 7 | `Class 7`, `class-7`, `7` | Middle |
| **11. Class 8** | `'8'` | Class 8 | `Class 8`, `class-8`, `8` | Middle |
| **12. Class 9** | `'9'` | Class 9 | `Class 9`, `class-9`, `9` | Secondary |
| **13. Class 10** | `'10'` | Class 10 | `Class 10`, `class-10`, `10` | Secondary |
| **14. Class 11** | `'11'` | Class 11 | `Class 11`, `class-11`, `11` | Senior Secondary |
| **15. Class 12** | `'12'` | Class 12 | `Class 12`, `class-12`, `12` | Senior Secondary |

### Rules & Safeguards:
- **No Class Sections:** Single undivided cohorts per class level.
- **No Pre-Nursery Class:** Records with `Pre-Nursery` are rejected as unapproved 16th classes.
- **Alias Deduplication:** Creating both `Nursery` and `NC` (or `LKG` and `KG-1`) in the same academic year is blocked as a logical duplicate.

---

## 5. Required Order of Setup

Data entities must be created in strict dependency order:

```
[1. First Admin Account]
           │
           ▼
[2. Current Academic Year (isCurrent = true)]
           │
           ├──────────────────────────────┐
           ▼                              ▼
[3. Class Records (15 levels)]    [4. Subject Catalog]
           │                              │
           └──────────────┬───────────────┘
                          ▼
            [5. Faculty & Staff Profiles]
                          │
                          ▼
            [6. Subject Allocations]
                          │
                          ▼
            [7. Class Teacher Assignments]
                          │
                          ▼
            [8. Core School Settings]
```

### Detailed Order:
1. **First Admin Account:** Created via `scripts/bootstrap-first-admin.js`.
2. **Academic Year:** Create via Admin Portal or API (`POST /api/v1/academic-years`). The `isCurrent` and `isActive` fields **cannot** be set through `POST` or `PUT`. After creation, establish the initial current year by calling:
   ```
   PATCH /api/v1/academic-years/:id/establish-current
   ```
   This dedicated endpoint requires `academic-years.manage` permission, validates the year is active and no other year is already current, sets `isCurrent: true` within a transaction, and records an audit log entry (`action: 'academic_year_establish_current'`). A concurrency-safe unique partial index on `{ isCurrent: 1 }` guarantees at most one current year at the database level.
3. **Classes:** Create 15 classes (`Nursery`, `LKG`, `UKG`, and `1` through `12`) associated with the active academic year.
4. **Subjects:** Register approved subjects with appropriate types (`Core`, `Elective`, etc.) and mapped `classLevels` via `POST /api/v1/subjects`.
5. **Faculty / Staff Accounts:** Invited via `/api/v1/invitations/teachers`. Accounts activate via secure email invitations.
6. **Subject Allocations:** Map active teachers to approved subjects and classes for the active academic year via `POST /api/v1/subject-allocations`. Required payload:
   ```json
   {
     "teacher": "<Faculty ObjectId>",
     "subject": "<Subject ObjectId>",
     "class": "<canonical class level, e.g. '5'>",
     "academicYear": "<YYYY-YYYY, e.g. '2026-2027'>"
   }
   ```
   The endpoint validates teacher existence, subject existence and class-level applicability, canonical class levels (Pre-Nursery rejected), and academic year format/existence. The compound unique index `{ teacher, subject, class, academicYear }` prevents duplicate allocations. Full CRUD available at `/api/v1/subject-allocations`. Requires `subjects.manage` permission for mutations and `subjects.view` for reads.
7. **Class Teacher Assignments:** Assign designated class teachers to class records.
8. **School Settings:** Configure school identity, contact information, and operational policies via `GET/PUT /api/v1/settings/:key` and `POST /api/v1/settings/bulk`. Requires `settings.view` / `settings.manage` permissions.

---

## 6. Verification of Baseline Initialization

Once the initial data is entered, run the read-only baseline validation utility to verify system integrity:

```bash
MONGO_URI="mongodb+srv://.../school_management_prod" node scripts/validate-baseline-data.js \
  --expected-host=cluster0.example.mongodb.net \
  --expected-port=srv \
  --expected-db=school_management_prod
```

### Verification Criteria:
- **Academic Year:** Exactly one current, active academic year with valid consecutive YYYY-YYYY naming and non-overlapping terms.
- **Classes:** Exactly 15 offered class levels present for the active year with valid academic levels and display orders.
- **Subjects:** All subjects have unique codes, valid types, and consistent class level mappings.
- **Allocations:** Zero dangling teacher or subject references.
- **Result:** Status reports `VALID (Ready for workflows)` with 0 errors.

---

## 7. Partial Failure Recovery and Safe Retries

### Concurrency Lock and Interrupted Bootstrap
- If an operation fails **before the transaction commits**, no user, audit, or permanent marker records exist. The lock is safely cleaned up (or expires after 5 minutes), allowing safe operator retry.
- If a process terminates abnormally **during the transaction**, MongoDB's commit protocol ensures either full commit or full abort — no partial writes survive.
- If the process crashes **after the transaction commits** but before the transient lock is marked completed: the durable `bootstrap_permanent_marker` document exists and blocks any future reacquisition. The user and audit records are correct and complete.
- In all crash scenarios, a subsequent operator invocation will either find no records (safe to retry) or find the permanent marker (bootstrap already completed successfully).

### Handling Data Creation Failures
- **Unique Indexes:** All core entities (`User.email`, `AcademicYear.name`, `Class.{name, academicYear}`, `Subject.code`, `SubjectAllocation.{teacher, subject, class, academicYear}`) have unique indexes. Partial reruns cannot create duplicate records.
- **Dangling References:** The baseline validation utility highlights any dangling IDs (e.g., allocations referencing deleted teachers), allowing operators to repair specific records prior to student admissions and attendance marking.

---

## 8. Auditability and Governance

1. **Bootstrap Audit Record:**
   - Every bootstrap execution writes an immutable record to the `AuditLog` collection:
     - `action: 'BOOTSTRAP_FIRST_ADMIN'`
     - `resource: 'User'`
     - `resourceId: <adminUserId>`
     - `details: { mechanism: 'OPERATOR_BOOTSTRAP_CLI', authenticatedSession: false, targetRole, maskedEmail, bootstrapTimestamp }`
   - Explicitly records `authenticatedSession: false` so the action is not falsely attributed to an existing logged-in user.
2. **Operator Logging:**
   - Systems operators must document the execution time, operator identity, witness identity, and target database in the school's Change Management Log.
3. **Credential Transfer:**
   - The initial password set during bootstrap must be handed over to the primary administrator via an encrypted, out-of-band channel.
   - The administrator must change their password upon initial login via the Admin Portal (`PUT /api/v1/auth/change-password`).
