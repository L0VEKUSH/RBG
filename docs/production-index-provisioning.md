# Production MongoDB Index Provisioning

## Status and boundary

This document describes a manual administrative tool. **Actual production index status is UNKNOWN.** No database was inspected or changed while this tool was added. A successful source test is not evidence of live index installation or duplicate-free data.

`scripts/provision-production-indexes.js` is not imported by application startup and has no npm lifecycle hook. It does not load `config/env.js`, dotenv, or `.env`; it reads `MONGO_URI` only from the process environment. It never prints a URI, credentials, query parameters, raw database errors, or duplicate key values.

The tool verifies the selected database name against both the URI and the connected database handle, compares the sanitized URI host/port/database with required operator-supplied values, and checks `hello` for a writable replica-set primary or a mongos router. Replica-set checks require the connected `me` and `primary` to agree and be listed as members. Standalone topology is rejected. These checks do not prove which cloud account the operator intended; the operator must independently verify the service/cluster identity in the approved provider console before confirming the target.

## Connection and invocation safeguards

The tool requires `NODE_ENV=production`, `MONGO_URI` supplied outside this repository, and explicit expected target metadata. It accepts no URI, username, password, run ID, or arbitrary options as CLI arguments. The host parser supports one DNS/IPv4 host or an SRV host; multi-host seed lists and IPv6 are rejected. A separate target confirmation is required for any index creation.

PowerShell examples below use placeholders; do not paste secrets into command history. Load `MONGO_URI` through the approved secret manager in the current process without echoing it.

```powershell
$env:NODE_ENV = 'production'
node scripts/provision-production-indexes.js `
  --expected-host=cluster.example.net `
  --expected-port=srv `
  --expected-db=school_management_db
```

The command above is a read-only dry run. Missing indexes on existing collections are reported as candidates; missing collections, duplicate keys, incompatible indexes, and unrecognized extra indexes are blockers. Dry run still connects and performs read-only metadata and duplicate checks, so it requires separate authorization to inspect the selected target.

Index creation requires both `--execute` and a target confirmation string that exactly matches the sanitized URI identity printed by the dry run. For the placeholder above, the confirmation is `mongodb+srv://cluster.example.net/school_management_db`:

```powershell
node scripts/provision-production-indexes.js `
  --expected-host=cluster.example.net `
  --expected-port=srv `
  --expected-db=school_management_db `
  --execute `
  --confirm-production-target=mongodb+srv://cluster.example.net/school_management_db
```

The confirmation is an explicit operator action, not cryptographic proof or a substitute for provider-console verification. The tool also checks the actual connected database name and topology before reading or writing indexes. It prints only the sanitized target identity, topology, model/collection/index metadata, and whether duplicate groups were found.

## Provisioning behavior

- Mongoose `autoIndex` and `autoCreate` are disabled on all production application connections and on this CLI.
- The CLI loads every `.js` model in `models/`, then inspects each model's declared indexes and the target database's actual collections/indexes.
- `_id_` must exist with key `{ _id: 1 }` and `unique: true`.
- A matching key and options is present; an absent index is missing; the same indexed fields with a different order or options is incompatible. Generated index names are not pinned.
- Any unrecognized extra index is reported and blocks execution pending review. Nothing is replaced, dropped, synchronized, or repaired.
- Missing collections block execution. The CLI never calls `createCollection()`. Use a separately authorized collection-provisioning process if a required collection does not yet exist.
- For each missing unique index, the CLI checks for duplicate groups over exactly the indexed fields before proposing or creating it. Sparse membership, `partialFilterExpression`, and collation are included. Duplicate keys and their records are never printed. A duplicate, timeout, or aggregation error blocks creation.
- Execution first inspects every model/collection. It creates only missing indexes on existing collections, rechecks duplicates immediately before each missing unique index, and verifies metadata again afterward. If a create command has an uncertain result, it reads metadata once and does not retry the create. Any partial provisioning remains in place for operator review; there is no automatic rollback or restart recovery.
- Run only in a planned maintenance window with concurrent collection/index DDL prevented. The operator's database role should be scoped to the intended database and grant only the read/duplicate-check and index actions required. It must not have drop permissions. The CLI's collection-existence check cannot prevent a separate actor from dropping a collection between check and create; this race must be excluded operationally.

## Declared index inventory

The collection names shown are Mongoose's default pluralized names; the code does not configure custom collection names. Options omitted in the table mean ordinary non-unique indexes. All collection/index presence is **UNKNOWN** until separately inspected.

| Model / collection | Declared keys and options | Feature depending on it |
|---|---|---|
| `AcademicYear` / `academicyears` | `{ name: 1 }`, unique | Academic-year identity |
| `Achievement` / `achievements` | `{ student: 1 }` | Student achievement queries |
| `Admission` / `admissions` | `{ applicationNumber: 1 }`, unique; `{ status: 1 }`; `{ status: 1, admissionSaga.state: 1, admissionSaga.leaseUntil: 1 }` | Admission identity and saga recovery |
| `AdmissionSagaAttempt` / `admissionsagaattempts` | `{ sagaId: 1 }`, unique; `{ state: 1, leaseUntil: 1, _id: 1 }`; `{ state: 1, nextCleanupAt: 1, _id: 1 }`; `{ admission: 1, ownerGeneration: 1 }` | Admission saga ownership/recovery |
| `Attendance` / `attendances` | `{ student: 1, class: 1, date: 1, subject: 1, academicYear: 1 }`, unique; `{ class: 1, date: 1 }` | Attendance logical identity and class/day reads |
| `AuditLog` / `auditlogs` | `{ user: 1, createdAt: -1 }`; `{ resource: 1, action: 1 }` | Audit history |
| `Bus` / `buses` | `{ busNumber: 1 }`, unique | Bus identity |
| `Class` / `classes` | `{ name: 1, academicYear: 1 }`, unique | Class identity |
| `Complaint` / `complaints` | `{ complainant: 1 }`; `{ status: 1 }` | Complaint lists |
| `EmailDelivery` / `emaildeliveries` | `{ idempotencyKey: 1 }`, unique; `{ status: 1 }`; `{ nextAttemptAt: 1 }`; `{ status: 1, nextAttemptAt: 1 }`; `{ status: 1, lockedAt: 1 }`; `{ status: 1, lastEnqueuedAt: 1, nextAttemptAt: 1 }`; `{ admissionSagaId: 1, admissionSagaGeneration: 1, status: 1 }`; `{ purgeAt: 1 }`, TTL `expireAfterSeconds: 0` | Email idempotency, retries, leases, retention |
| `Event` / `events` | `{ startDate: 1 }`; `{ type: 1 }` | Event queries |
| `Faculty` / `faculties` | `{ user: 1 }`, unique; `{ employeeId: 1 }`, unique+sparse; `{ department: 1 }`; `{ classTeacherOf.class: 1 }` | Staff identity and assignments |
| `Exam` / `exams` | `{ class: 1, academicYear: 1 }`; `{ class: 1, academicYear: 1, examType: 1 }`, unique; `{ startDate: 1 }`; `{ status: 1 }` | Exam schedules and unique exam-type protection |
| `FeeStructure` / `feestructures` | `{ class: 1, academicYear: 1 }` | Fee structure lookup |
| `Homework` / `homeworks` | `{ class: 1, subject: 1 }`; `{ dueDate: 1 }` | Homework queries |
| `LeaveRequest` / `leaverequests` | `{ user: 1, status: 1 }` | Leave workflow |
| `LibraryBook` / `librarybooks` | `{ isbn: 1 }`; `{ title: 1 }` | Book lookup |
| `LibraryTransaction` / `librarytransactions` | `{ student: 1, status: 1 }`; `{ book: 1, status: 1 }` | Library checkout and return |
| `Marks` / `marks` | `{ student: 1, examType: 1, academicYear: 1 }`, unique; `{ class: 1, examType: 1, academicYear: 1 }` | Marks uniqueness and class reports |
| `Message` / `messages` | `{ sender: 1, receiver: 1 }`; `{ receiver: 1, isRead: 1 }` | Messaging |
| `Notice` / `notices` | `{ publishDate: -1, isPublished: 1 }`; `{ isPinned: -1, publishDate: -1 }` | Notice feeds |
| `Notification` / `notifications` | `{ recipient: 1, isRead: 1 }`; `{ createdAt: 1 }` | Notification lists |
| `Parent` / `parents` | `{ user: 1 }`, unique; `{ admissionSagaId: 1, admissionSagaGeneration: 1 }`, sparse; `{ admissionSagaLinks.sagaId: 1, admissionSagaLinks.ownerGeneration: 1 }` | Parent linkage and admission recovery |
| `Payment` / `payments` | `{ receiptNumber: 1 }`, unique; `{ idempotencyKey: 1 }`, unique+sparse | Receipt identity and payment idempotency |
| `Route` / `routes` | `{ routeNumber: 1 }`, unique | Transport route identity |
| `SchoolSettings` / `schoolsettings` | `{ key: 1 }`, unique | Settings identity |
| `Student` / `students` | `{ user: 1 }`, unique; `{ admissionNumber: 1 }`, unique; `{ class: 1, rollNumber: 1, academicYear: 1 }`, unique; `{ parentUser: 1 }`; `{ admissionSagaId: 1, admissionSagaGeneration: 1 }`, sparse | Student identity, rosters, linkage, admission recovery |
| `StudentFee` / `studentfees` | `{ student: 1, academicYear: 1 }`; `{ admissionSagaId: 1, admissionSagaGeneration: 1 }`, sparse | Fee ledger and admission recovery |
| `Subject` / `subjects` | `{ code: 1 }`, unique | Subject identity |
| `SubjectAllocation` / `subjectallocations` | `{ teacher: 1, subject: 1, class: 1, academicYear: 1 }`, unique | Teacher assignment identity |
| `Timetable` / `timetables` | `{ class: 1, academicYear: 1, day: 1 }`, unique | Class/year/day timetable |
| `TransportAssignment` / `transportassignments` | `{ student: 1, academicYear: 1 }` | Student transport |
| `User` / `users` | `{ email: 1 }`, unique; `{ activationToken: 1 }`, sparse; `{ resetPasswordToken: 1 }`, sparse; `{ admissionSagaId: 1, admissionSagaGeneration: 1 }`, sparse | Login, activation, recovery, admission |
| `WebsiteContent` / `websitecontents` | `{ page: 1, pageBlock: 1 }`, unique | Website content identity |

`Counter` and `WorkerLease` have no secondary index declarations. MongoDB supplies the implicit `_id_` index for each collection.

### Duplicate-check and rollback notes

Unique index creation can fail if existing records contain duplicate indexed values, including legacy null/missing values under the index's sparse/partial rules. The utility checks duplicates but does not resolve them. A duplicate report requires a separate, approved data-remediation decision; no record is selected, merged, or deleted automatically. This applies especially to attendance's five-field key, exam `{ class, academicYear, examType }`, payment receipt/idempotency keys, and saga/idempotency keys.

The utility is add-only. It does not roll back successful index builds if a later index fails. A non-unique index can be removed only through a separately reviewed operator plan after confirming no query depends on it. Removing a unique index removes an integrity guarantee. Removing the email TTL index stops automatic expiry; it does not restore already expired documents. Never treat rollback as automatic or run a drop operation as part of this tool.

## Verification after separately authorized execution

1. Review the complete dry-run output and resolve every missing collection, duplicate group, incompatible index, and unmanaged extra index.
2. Confirm a backup/restore checkpoint, maintenance window, exact target host/database, and least-privilege operator access independently.
3. Obtain explicit approval for index creation on that exact target; then provide `--execute` and the exact `--confirm-production-target` value.
4. Require exit code zero and final read-back of all expected indexes. If the process exits nonzero or loses connection, do not rerun execution blindly; run another authorized dry run and reconcile exact index metadata first.
5. Keep sanitized output with target label and capture time. Do not store URI, credentials, duplicate keys, student data, or raw database errors.

The tool's existence and tests do not authorize its execution. Production host/database identity, actual indexes, and duplicate status remain UNKNOWN until a separate operator verification and approval phase.
