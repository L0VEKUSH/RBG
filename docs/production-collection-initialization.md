# Production Collection Initialization

## Scope and safety boundary

`scripts/initialize-production-collections.js` is a separate operator CLI for creating only missing model collections. It is dry-run by default, requires `NODE_ENV=production`, checks target identity and transaction-capable topology, and requires an explicit sanitized target confirmation for creation.

It does not load `.env` or dotenv files, accept a connection string as an argument, print a connection string or credentials, insert records, create declared indexes, synchronize indexes, drop collections, or rename collections. Its database adapter exposes only collection metadata listing and `createCollection`.

MongoDB maintains its mandatory `_id_` index for collections. The utility does not call any index-creation API; after this utility finishes, the separately controlled index-provisioning stage remains required for the application's declared indexes.

## Reviewed model-to-collection inventory

Names are read from each model's Mongoose-resolved `model.collection.collectionName`, so Mongoose's pluralization rules and explicit collection overrides are honored. No explicit collection overrides were found in the current model files. The utility compares this runtime inventory to a reviewed 36-model manifest and stops if a model is added, removed, renamed, or redirected to another collection before the manifest is reviewed.

| Model | Mongoose collection |
|---|---|
| AcademicYear | `academicyears` |
| Achievement | `achievements` |
| Admission | `admissions` |
| AdmissionSagaAttempt | `admissionsagaattempts` |
| Attendance | `attendances` |
| AuditLog | `auditlogs` |
| Bus | `buses` |
| Class | `classes` |
| Complaint | `complaints` |
| Counter | `counters` |
| EmailDelivery | `emaildeliveries` |
| Event | `events` |
| Exam | `exams` |
| Faculty | `faculties` |
| FeeStructure | `feestructures` |
| Homework | `homeworks` |
| LeaveRequest | `leaverequests` |
| LibraryBook | `librarybooks` |
| LibraryTransaction | `librarytransactions` |
| Marks | `marks` |
| Message | `messages` |
| Notice | `notices` |
| Notification | `notifications` |
| Parent | `parents` |
| Payment | `payments` |
| Route | `routes` |
| SchoolSettings | `schoolsettings` |
| Student | `students` |
| StudentFee | `studentfees` |
| Subject | `subjects` |
| SubjectAllocation | `subjectallocations` |
| Timetable | `timetables` |
| TransportAssignment | `transportassignments` |
| User | `users` |
| WebsiteContent | `websitecontents` |
| WorkerLease | `workerleases` |

`Achievement`, `Complaint`, and `TransportAssignment` remain in the model files and the existing index inventory. That inventory describes achievement queries, complaint lists, and student transport, but the current application search found no references to these models outside their definitions and the index inventory. Their current purpose is therefore unproven. This utility does not remove or skip them; all three remain in the reviewed manifest and are required by its complete inventory check until a separate model-retirement decision is approved.

## Creating collections is not seeding data

The utility creates empty collections only. It does not add an academic year, settings, users, classes, subjects, or any other baseline record. The current seed scripts contain academic-year and subject-allocation setup, but they are not production collection initializers and must not be used as a substitute for an approved production data-bootstrap process.

With production `autoCreate` and `autoIndex` disabled, Mongoose will not eagerly create model collections or declared indexes. A first MongoDB write may still cause the server to create a missing collection implicitly; that does not create the application's declared secondary indexes. Do not rely on this behavior. The index-provisioning CLI requires all 36 collections to exist before it can inspect or provision indexes.

## Preconditions

Before using the utility, the operator must:

1. Independently verify the Atlas project, cluster, and production database in the Atlas dashboard.
2. Confirm a transaction-capable replica set or sharded topology and a MongoDB server version/FCV compatible with the locked application dependencies.
3. Configure the intended production database user, TLS, and Atlas network access for the actual Render egress design.
4. Confirm a recent approved backup/recovery checkpoint and a maintenance window. Keep application and other writers stopped or fenced during creation.
5. Supply the connection secret to the operator process through an approved secret manager. Do not place it in command arguments, shell history, documentation, or logs.

The CLI checks the expected host, port, and database against the URI-derived identity, checks the connected database name, and uses `hello` to require a replica-set primary or `mongos`. This does not verify the Atlas account or project; the dashboard check is mandatory.

## Dry-run procedure

The operator process must set `NODE_ENV=production` and provide `MONGO_URI` without echoing it. The CLI has no `--execute` flag by default, so it only lists each expected collection as existing, missing, or incompatible. The dry run connects and reads collection metadata; it is not an offline preview and requires separate authorization to inspect the selected target.

Example using non-secret target metadata:

```powershell
$env:NODE_ENV = 'production'
# Load MONGO_URI from the approved secret manager without displaying it.
node scripts/initialize-production-collections.js `
  --expected-host=verified-atlas-host `
  --expected-port=srv `
  --expected-db=school_management_prod
```

A successful dry run may report missing collections. That means inspection completed; it does not mean the database is initialized. Review every missing and incompatible entry. A view or other non-collection object at an expected collection name blocks execution. Unrelated collection metadata is left untouched.

## Execution authorization

Only after reviewing the dry-run output and approving collection creation on that exact Atlas deployment may an operator add `--execute` and the exact sanitized target identity. The confirmation format is `host=<host>;port=<port>;database=<database>`; it is not a connection string and contains no credentials.

```powershell
node scripts/initialize-production-collections.js `
  --expected-host=verified-atlas-host `
  --expected-port=srv `
  --expected-db=school_management_prod `
  --execute `
  "--confirm-production-target=host=verified-atlas-host;port=srv;database=school_management_prod"
```

The CLI re-reads metadata before each create, creates only entries still missing, and verifies each create and the final inventory. Existing collection metadata is not modified. It never attempts automatic rollback or a second create attempt after an uncertain result.

## Partial failure recovery

Collection creation is a sequence of independent operations; it is not an all-or-nothing transaction. A failure can leave some new empty collections in place. The CLI reports a safe status code and the last verified inventory without printing raw server errors.

If execution is partial or its result is uncertain:

1. Stop and preserve all collections already created.
2. Do not drop, rename, or recreate anything as rollback.
3. Have an authorized operator perform a fresh dry-run against the independently verified target.
4. Review what exists and what remains missing, confirm the backup and maintenance gates again, and obtain new explicit approval before any further execution.

The CLI does not lock out other operators. A maintenance window and external write/DDL fence are required to avoid races between metadata inspection and collection creation.

## Separate index-provisioning stage

After all 36 collections are present and verified, the next stage is the separate production index-provisioning CLI. It has its own dry run, duplicate checks for missing unique indexes, incompatible/extra-index review, explicit execution approval, and final index metadata verification. Do not combine the two CLIs into one unattended deployment step. Collection initialization does not prove index readiness or duplicate-free data.
