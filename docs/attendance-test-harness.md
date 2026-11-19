# Attendance Integration Test Guard

This document describes the attendance guard and the Phase 2B.6R runner source. No runner or test was executed in that phase. This document does not authorize connecting to MongoDB, running tests, creating indexes, or deleting a database.

## Runtime-generated run context

Runtime target construction requires `process.env.NODE_ENV === 'test'`. `createRunContext()` generates a 128-bit random hexadecimal run ID internally; it accepts no caller-supplied ID. The resulting context can issue one target URI and bind that URI to one validated target. A second URI issuance, target binding, or ownership lease for the same context is rejected. A new run requires a new context and therefore a new cryptographically random ID; uniqueness is probabilistic, not an absolute guarantee.

`validateRunId()` and `databaseNameForRunId()` remain pure format helpers. They do not create runtime contexts or authorize a runtime target.

The target is fixed to:

- Host: `127.0.0.1`
- Port: `27018`
- Replica set: `rbgAttendanceIT`
- Database: `erp_attendance_it_<32-character random hex run ID>`
- URI credentials and extra query parameters: rejected

The guard returns a URI only from the internally generated context. Never log the URI or ownership marker. The previous report of a container/database is not used as a default or verified by this module.

## Topology shape validation and freshness boundary

`validateHelloResponseShape()` checks a supplied object's topology fields against the fixed single-member replica-set shape and returns a single-use validation handle bound to the exact target. It requires the expected set name, `isWritablePrimary: true`, `secondary: false`, exact primary/member addresses, one advertised host, and empty `passives` and `arbiters` arrays. It rejects contradictory `arbiterOnly`, `hidden`, and `isreplicaset` boolean claims while allowing unrelated metadata. Missing or malformed required fields fail closed.

This handle is not proof that MongoDB produced the supplied object or that it is fresh. Its five-second lifetime starts when this JavaScript helper validates the object, not when MongoDB produced it. The runner source issues a new `hello` command through the exact validated connection immediately before cleanup preflight and passes that response through the shape validator. The guard cannot independently prove command provenance or freshness. Even a fresh response cannot guarantee that topology remains unchanged after verification; this guard does not establish container identity or prevent a topology change in the interval after the check. Runtime behavior remains unverified because the runner was not executed.

## Ownership marker values are not read-back evidence

`createOwnershipLease(context)` generates a random 256-bit nonce internally. `markerForInsert()` returns the marker values intended for the first write in a newly created test database. `matchesLeaseMarkerValues(marker)` only checks whether supplied values match this run's expected marker. It accepts a copy of the insert values and returns a boolean; this is value comparison, not evidence that a database read occurred.

The guard has no read-back evidence API and does not perform, authenticate, or independently prove a database read. A copied marker object cannot be distinguished from a MongoDB result by this pure helper. The runner source queries the marker collection through the exact validated connection, compares the returned document with the internally held lease values, and keeps that result and decision inside its private control flow. It does not turn arbitrary caller input into read-back evidence or expose marker data as a cleanup authorization input. Runtime behavior remains unverified because the runner was not executed.

Before the first marker write, the runner checks whether the exact generated database already exists; this is only a collision check. The ownership marker is its first database write. If the marker write is rejected or uncertain, the runner attempts only direct read-back reconciliation. Without a matching marker, it stops scenarios and retains the database. The guard itself does not establish ownership.

## Guard is not cleanup authority

The guard has no cleanup-eligibility predicate, deletion method, or API that accepts `cleanupPermission` or `commitOutcomeUncertain` values. It cannot establish operator consent, database ownership, transaction certainty, or cleanup authorization. The runner captures cleanup opt-in from its exact CLI invocation and tracks ownership, transaction certainty, and direct reads in private state; caller-supplied booleans or lookalike tokens are not proof.

`lease.retireRunAfterTopologyValidation(handle)` is only a terminal local state transition. It consumes one unexpired topology-shape validation that was minted for the context's exact target, then retires the context and lease. It does not authorize or perform database deletion. Invalid, stale, mismatched, or reused handles return false without changing state; successful retirement cannot be repeated. There is no reset or reopen operation. The runner performs its own private cleanup checks using the exact internally generated database and consumes/retire the context immediately before at most one cleanup attempt. A cleanup error or uncertain result does not trigger another attempt. Container, volume, and network cleanup are outside this guard.

## Private runner source

`scripts/attendance-it-runner.js` is a private CLI entry point and exports no runner state or cleanup functions. It accepts no arguments by default, which retains the generated database; the exact `--cleanup` argument requests cleanup only after the complete scenario set and all private preflight gates succeed. It requires the actual `NODE_ENV=test`, constructs its URI from the guard's internally generated context, and creates one dedicated Mongoose connection with `autoIndex` and `autoCreate` disabled. It does not load the ERP server or environment configuration.

The runner checks that the exact generated database is absent before the first write, inserts one unique ownership marker without upsert, and reads that marker back directly from the exact connection using majority read concern. Insert or read uncertainty is reconciled only by repeated direct reads; without a matching marker, no scenarios or cleanup proceed. Marker values, URI, and raw database errors are not logged. It prints the generated database name only after the ownership marker has been read back and matched. Each runner invocation creates a new random database name; it does not discover or recover prior run databases after a process interruption.

The index gate is read-only. It requires the `attendances` collection to have exactly the `_id` index, the declared unique `{ student, class, date, subject, academicYear }` index, and the declared non-unique `{ class, date }` index, with no additional index options or indexes. It never calls `syncIndexes()` or any index-creation method. A missing collection/index or unexpected index, including the previously reported narrower unique index, stops the runner before attendance fixtures are written. The database must be absent before the marker write, so there is no supported way in this runner to prepopulate its generated database with these indexes; the runner currently has no provisioning handoff or resume path. A separately approved index provisioning design is required before runner execution can succeed on a fresh target.

The synthetic scenarios use the dedicated connection's native collection API to exercise transaction commit, rollback, duplicate-key protection, and optimistic stale-write rejection. They do not call `attendance.service.js`, so they do not prove application-service behavior. The current attendance service passes its MongoDB session to the batch `Attendance.bulkWrite()` and to the authorization, academic-year, enrollment, and existing-record reads in its transaction flow. This source-level session propagation still requires separately authorized replica-set integration testing; this runner does not exercise that service path.

Attendance authorization depends on dated enrollment history. New admission approval and direct Student creation require an explicit school-local `YYYY-MM-DD` effective date matched to a configured academic year. The admission saga records the date and year in its durable attempt; account activation remains separate. TC issuance captures `lastEnrolledDate` as an inclusive school-local date, distinct from the TC issue timestamp, and stores the next school date as the exclusive enrollment-history boundary. Missing legacy dates are not inferred or rewritten by these workflows.

When `--cleanup` is requested, cleanup is considered only after scenarios pass, no scenario is active, every transaction is committed or known aborted, and reconciliation completes. The runner directly rereads the marker and issues a new `hello` command immediately before its cleanup decision. It consumes the guard's terminal context transition, marks the single cleanup attempt before awaiting `connection.dropDatabase()`, and targets only that connection's exact generated database. A deletion error or uncertain result is terminal; there is no retry or restart cleanup. Cleanup is not authorized merely by source presence: runner execution and database cleanup require separate explicit approval.

## Index gate still required

The guard does not create or synchronize indexes. The runner source disables Mongoose `autoIndex` and `autoCreate`, inspects `listIndexes()` before fixture writes, and requires the exact approved five-field unique attendance index plus the declared class/date index. An unexpected narrow unique index, missing index, or unexpected index option stops the run; no automatic index repair is allowed. A separate approved design is still needed to provision these indexes for the internally generated per-run database.

## Pure tests and authorization boundary

The pure guard tests and runner source-contract tests use Node's built-in test runner. The runner source tests read files and do not import or start the runner. They do not connect to MongoDB. These tests cannot establish MongoDB read-back provenance, operator consent, transaction behavior, or deletion safety.

```powershell
node --test tests/attendance-it-guard.test.js tests/attendance-it-runner-source.test.js
```

The guard tests, runner source tests, and runner were not run during Phase 2B.6R. Running them requires separate authorization. MongoDB integration testing, index provisioning, Docker provisioning, and database cleanup each require separate explicit authorization after review of the complete runner and environment evidence. A process crash never triggers prefix scanning or automatic cleanup; any uncertain ownership, transaction, or deletion outcome requires operator investigation.
