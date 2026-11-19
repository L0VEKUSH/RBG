# Render backend deployment preparation

**Status:** preparation guide only. No Render, Vercel, Atlas, Redis, or SMTP service was configured or contacted for this phase.

## Current deployment shape

The repository is a CommonJS Express application. `npm start` runs `node server.js`; there is no frontend build script. Express serves the existing `public/` tree and mounts API routers below `/api/v1/`. The static frontend and backend can be configured as separate Vercel and Render services from the same repository, using the application directory that contains this `package.json` as each service's root.

The checked-in source does not include a Render manifest, Dockerfile, Vercel config, `.nvmrc`, or package `engines` declaration. `.node-version` now pins Node `24.22.2`. The Render service hostname and deployment environment values are not known. Do not create a Vercel rewrite destination until Render supplies its real HTTPS hostname.

### Render web service settings to enter after service creation

| Setting | Value from repository | Notes |
|---|---|---|
| Root directory | Application directory containing `package.json` | Confirm the repository layout in the Render project setup. |
| Runtime | Node.js `24.22.2` | Exact LTS patch selected in `.node-version`; do not set a conflicting Render `NODE_VERSION`; run the safe test suite on this version before release. |
| Build/install command | `npm ci` | Uses the checked-in lockfile. No frontend build command is defined. |
| Start command | `npm start` | Runs `node server.js`. |
| Health check path | `/health` | Reports MongoDB state for the web process. Production listens after initial startup gates, including Redis connection, but this endpoint does not actively probe Redis or establish worker readiness. |
| Port | Render-provided `PORT` | The app passes `PORT` to `app.listen`; it defaults to `5000` only when the variable is absent. No host argument is supplied; confirm the process is reachable on Render's required public interface and port. |

The package range and lockfile resolve Mongoose `8.24.7` and MongoDB driver `6.20.0`; direct dependency engine requirements inspected support Node 24. The repository pin and the local runtime selected for Phase 21L checks are both Node `24.22.2`. Keep the pin rather than relying on a service-creation-date-dependent default. [Render Node version selection](https://render.com/docs/node-version), [Node.js archive for v24.22.2](https://nodejs.org/en/download/archive/v24.22.2)

### Separate email worker

The repository defines `npm run worker:email` (`node scripts/email-worker.js`). It consumes the email queue and performs periodic delivery/admission-saga recovery. Configure it as a separate, continuously running Render Background Worker with the same approved MongoDB and Redis services as the web process. Do not run the worker as a second web service or assume the web process handles queued email.

Production MongoDB connections disable Mongoose `autoIndex` and `autoCreate`, but MongoDB can still implicitly create a collection on a write. Before the web process listens, it loads the complete reviewed 36-model inventory, performs a read-only `listCollections` metadata check, then checks declared indexes. The worker runs the same collection and index gates before saga recovery, delivery reconciliation, or constructing its job consumer. The application's database role must be allowed to list collections in the application database; the preflight does not need to create or alter database objects. Production service paths that previously called `createIndexes()` now verify existing index metadata and fail closed if required indexes are missing or incompatible. Outside production, existing automatic collection/index behavior remains enabled. The index checker compares ordered key patterns and semantic options; generated names and server metadata fields are not pinned.

Collection initialization and index provisioning are separate operator actions. The collection initializer only creates reviewed collections that are missing; it does not add indexes or records. After collections are present, the index provisioning CLI can be run under its separate target confirmation and approval gates. The provisioning CLI never drops or synchronizes indexes and refuses missing collections. Verify both stages before allowing production web or worker startup.

## Redis, email, storage, and service plans

- **Redis is required in production.** `config/env.js` rejects production startup without `REDIS_URL`; the web process uses Redis-backed distributed rate limiting, and the email worker uses Redis/BullMQ. Use an isolated, durable Redis-compatible service with network/TLS settings supported by the selected plan. A restart must not silently erase queued delivery state.
- **The worker needs an always-on plan.** Render documents no Free instances for Background Workers. Its Free Key Value service is in-memory and can lose all data on restart, so it is unsuitable for a reliable production job queue. Select paid/persistent resources or an independently approved compatible provider. [Render Free plan limits](https://render.com/docs/free), [Background Workers](https://render.com/docs/background-workers), [Key Value](https://render.com/docs/key-value)
- **Email requires a delivery decision.** The app uses SMTP configuration. Render Free services cannot send outbound traffic on SMTP ports 25, 465, or 587, and free web services can spin down after inactivity. Use a plan/provider that supports the configured SMTP route, or separately implement and review another delivery integration; do not assume an HTTP email API is supported by the current code. [Render Free plan limits](https://render.com/docs/free)
- **Filesystem:** the app serves `/uploads` from a local `uploads` directory, but source/docs inspection found no connected Multer upload flow. Do not treat runtime local files as durable storage. If user uploads are implemented later, choose durable object storage or an explicitly managed persistent disk before enabling the feature. Static files already in `public/` are part of the deployment artifact.
- **Paid resources:** a production-like deployment needs an always-on web service, an always-on worker, durable Redis, and an email path that the selected service plan permits. The exact Render plan, Redis provider, Atlas tier, backups, and costs remain operator decisions; this guide does not select a billing tier. Render states that Free plans are for preview/hobby use and are not intended for production.

## Environment variable matrix

This inventory is derived from the web, worker, shared config, and their runtime services. It lists names and purposes only; no current values were inspected. Store secrets in private service environment settings, never in frontend code, Vercel public variables, checked-in files, or logs. The worker imports the shared production config, so some settings such as `JWT_SECRET` and `CORS_ORIGIN` are currently required there even though it does not serve browser requests.

| Variable | Service | Requirement and purpose |
|---|---|---|
| `NODE_ENV` | Web, worker | **Required:** set to `production` to enable production checks and secure-cookie behavior. |
| `MONGO_URI` | Web, worker | **Required:** private URI for the intended production database. Startup checks the connected target's required collections and indexes. |
| `REDIS_URL` | Web, worker | **Required:** Redis-compatible service for rate limiting and BullMQ. Use the provider's supported TLS and authentication settings. |
| `JWT_SECRET` | Web, worker | **Required:** production signing secret; the shared config rejects missing, short, or known weak values. |
| `CORS_ORIGIN` | Web, worker through shared config | **Required:** comma-separated explicit HTTPS browser origin allowlist; wildcard is rejected. The worker currently inherits this shared-config requirement. |
| `EMAIL_ENCRYPTION_KEY`, `EMAIL_ENCRYPTION_KEY_VERSION` | Web, worker | **Required:** current protected-token encryption key and its version label. Keep key material private. |
| `PORT` | Web | **Platform supplied:** Render provides the listening port; the source has a local fallback. |
| `FRONTEND_URL` | Web and worker email-link generation | **Conditional operational requirement:** set the public HTTPS frontend origin for account activation and recovery links. |
| `SCHOOL_WEBSITE` | Web and worker email-link generation | **Conditional fallback:** used when `FRONTEND_URL` is absent; set it to the same approved public HTTPS origin if relying on the fallback. The source's local default is unsuitable for production links. |
| `EMAIL_TRANSPORT` | Web shared config, worker, mail sender | **Conditional:** may be unset (SMTP is the default) or set to `smtp`. Production rejects `json` and every unsupported value. Development/test JSON behavior remains available. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Worker | **Required in production:** SMTP host, numeric port, and explicit `true`/`false` TLS mode. Validation requires these before Mongo recovery/reconciliation; it does not open an SMTP connection. |
| `SMTP_USER` or `SMTP_EMAIL` | Worker | **Required in production:** SMTP username; `SMTP_EMAIL` is the accepted legacy alias. |
| `SMTP_PASS` or `SMTP_PASSWORD` | Worker | **Required in production:** SMTP password; `SMTP_PASSWORD` is the accepted legacy alias. Store only as a secret. |
| `FROM_EMAIL` | Worker | **Required in production:** valid sender email identity. |
| `FROM_NAME` | Worker mail sender | **Optional:** display name; source has a default. |
| `EMAIL_ENCRYPTION_KEY_PREVIOUS`, `EMAIL_ENCRYPTION_KEY_PREVIOUS_VERSION` | Web, worker | **Conditional:** configure both together during key rotation; the previous version must differ from the current version. Remove only after stored material no longer needs it. |
| `TRUST_PROXY_HOPS` | Web | **Optional tuning:** trusted proxy hop count, default `0`; choose only after confirming the actual proxy chain. |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_KEY_PREFIX` | Web | **Optional tuning:** global API rate limit and Redis key namespace. Keep namespaces isolated between environments. |
| `AUTH_LOGIN_RATE_LIMIT_MAX`, `AUTH_RECOVERY_RATE_LIMIT_MAX`, `AUTH_ACTIVATION_RATE_LIMIT_MAX` | Web | **Optional tuning:** per-route authentication throttles. |
| `ADMISSION_RATE_LIMIT_MAX` | Web | **Optional tuning:** admission route throttling. |
| `JWT_EXPIRE`, `JWT_COOKIE_EXPIRE` | Web | **Optional policy settings:** token and cookie lifetimes; source defaults are `7d` and 7 days. |
| `EMAIL_QUEUE_PREFIX` | Web producer, worker | **Optional tuning:** BullMQ namespace. If overridden, use the same value for every producer and consumer sharing the queue. |
| `EMAIL_RECONCILE_MS` | Web email service, worker | **Optional tuning:** delivery reconciliation interval. |
| `EMAIL_RECONCILE_LEASE_MS`, `EMAIL_LEASE_MS` | Web email service, worker | **Optional tuning:** reconciliation and delivery lease durations. |
| `EMAIL_MAX_ATTEMPTS`, `EMAIL_BACKOFF_MS` | Web email service, worker | **Optional tuning:** retry limit and retry backoff. |
| `EMAIL_DELIVERY_RETENTION_MS` | Web email service, worker | **Optional tuning:** delivery record retention period. |
| `ADMISSION_SAGA_LEASE_MS`, `ADMISSION_SAGA_ORPHAN_RECHECK_MS` | Web, worker | **Optional tuning:** admission-saga lease and orphan recovery interval. |
| `SCHOOL_NAME`, `SCHOOL_ADDRESS`, `SCHOOL_EMAIL`, `SCHOOL_PHONE` | Shared config, email templates/branding where used | **Optional branding:** the source supplies defaults; confirm approved school identity before production email. |
| `COLLEGE_NAME`, `COLLEGE_ADDRESS`, `COLLEGE_PHONE` | Shared config | **Optional legacy aliases:** school-prefixed values take precedence when both are set. |
| `MAX_FILE_UPLOAD`, `FILE_UPLOAD_PATH` | Shared config | **Optional config values:** upload size/path settings exist, but source review did not find a connected upload flow. A local path is not durable storage. |

### Production email behavior

The web process validates that production transport selection is SMTP-compatible and validates the shared encryption-key configuration, but it does not require SMTP credentials because its role is to enqueue delivery work. The worker validates the full SMTP configuration before connecting to MongoDB, checking indexes, recovering sagas, reconciling delivery records, or constructing its BullMQ consumer. Configuration errors fail worker startup as setup errors; they do not become delivery failures after jobs have been consumed. Validation does not contact SMTP. Existing retry, idempotency, and dead-letter behavior remains in the delivery path.

## Vercel frontend and same-origin API routing

Keep browser requests on relative `/api/v1/...` paths. The existing routing guide, [Vercel/Render same-origin routing](vercel-render-routing.md), documents the required external rewrites after the actual Render hostname exists:

- `/api/v1/:path*` to the matching Render API path.
- `/health` to Render `/health` as its own exact rule.
- No wildcard rewrite for HTML, scripts, styles, images, or print pages.

Vercel external rewrites proxy without changing the browser URL. Keep the existing HTTP-only cookie and `SameSite=Strict` policy; production cookies are `Secure`. Do not expose JWTs to JavaScript or loosen cookies for a cross-origin browser flow. The existing CORS configuration still requires an explicit production HTTPS origin. Validate request methods, query strings, bodies, API errors, response headers, and proxied `Set-Cookie` in a Vercel preview with the real Render URL; cookie behavior has not been browser-tested here. [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)

## MongoDB Atlas readiness gates

No Atlas database was accessed and no production topology, indexes, or duplicate state is verified. Before an application deployment that can write attendance or exams:

1. Use an Atlas replica set or sharded cluster that supports multi-document transactions. Standalone MongoDB is not sufficient. Verify the actual cluster topology, server version, feature compatibility version, and transaction operation through an approved isolated process; do not infer these from a URI or Atlas branding. The repository's attendance service requires a transaction and has no non-transactional fallback. [MongoDB transaction requirements](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/)
2. The lockfile resolves Mongoose `8.24.7` (package range `^8.0.3`) and MongoDB Node.js driver `6.20.0`. MongoDB's transaction documentation gives minimum feature compatibility versions of 4.0 for replica sets and 4.2 for sharded clusters; those are technical floors, not deployment recommendations. Mongoose 8's published compatibility table lists server support from 4.2 through 8.x. Select a currently supported Atlas version compatible with the locked stack and exercise it in an isolated replica-set environment before production. Do not infer deployment readiness from local package versions. [MongoDB transaction requirements](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/), [Mongoose 8 compatibility](https://mongoosejs.com/docs/8.x/docs/compatibility.html)
3. Verify deployed index metadata and duplicate data before enabling writes. Source declares:
   - Attendance unique key `{ student: 1, class: 1, date: 1, subject: 1, academicYear: 1 }`; attendance also declares non-unique `{ class: 1, date: 1 }`.
   - Exam unique key `{ class: 1, academicYear: 1, examType: 1 }`.
4. Treat these as source declarations only. They do not prove the indexes exist in Atlas. Attendance write code checks its unique index before writes; exam duplicate protection also depends on the deployed unique index to close concurrent-create races. The known historical narrow attendance unique index is not evidence of Atlas state. Do not auto-drop, repair, or rebuild an unexpected index. Have an authorized operator check duplicates and index metadata, then approve any separate remediation.
5. Verify that the production application user can perform the read-only collection and index metadata checks. Initialize missing collections through the separately authorized collection utility, then run the index provisioning CLI under its own documented target and approval checks. Review dry-run results and unique-index duplicate findings before explicitly approving index creation. Do not run `syncIndexes()` as a deployment shortcut. [Mongoose index guidance](https://mongoosejs.com/docs/8.x/docs/guide.html)
6. Configure Atlas network access for the actual Render egress/network design, use a least-privilege application database user, and keep the URI private. Confirm backup retention and complete an isolated restore test before production use; tier and backup configuration are unknown.

## Ordered preparation and release checklist

1. **Resolve code/runtime gates:** run non-database unit/static checks on pinned Node `24.22.2`; separately approve and complete index provisioning and metadata verification. Production startup now stops if a declared index is absent or incompatible.
2. **Prepare Atlas separately:** choose a supported transaction-capable cluster, configure private credentials/network access, inspect duplicate attendance/exam keys, and verify the exact required indexes. Capture sanitized evidence without database records or credentials.
3. **Prepare Redis and email:** select durable Redis compatible with both rate limiting and BullMQ; verify queue persistence/restart behavior in an isolated environment. Select a supported SMTP route and confirm worker delivery/retry behavior outside production.
4. **Create Render web and worker services:** root at this app, build `npm ci`, web start `npm start`, worker start `npm run worker:email`; set only the needed private environment variables. Keep `MONGO_URI` unset until the collection, index, security, backup, and restore gates below are complete. Use an always-on configuration suitable for the required worker, Redis, and email path.
5. **Health and proxy review:** current `/health` checks MongoDB only, so add a separately reviewed operational check for Redis/worker before relying on it as full service readiness. Confirm Render port reachability and `TRUST_PROXY_HOPS` against the actual proxy chain.
6. **Configure Vercel after Render hostname assignment:** set static output to `public/`, use the rewrite pair in `vercel-render-routing.md`, and keep no broad catch-all. Set exact frontend URL and allowed origin.
7. **Run staging/preview acceptance:** test login, logout, activation/recovery links, cookie forwarding, protected APIs, email queue delivery, Redis restart behavior, database transactions, and attendance/exam index gates. Use synthetic data and an isolated staging Atlas deployment first. No preview or production test was performed in this phase.
8. **Production release:** require owner/operator approval, a backup/restore checkpoint, verified Atlas evidence, and a rollback plan before deployment.

## Current blockers and unknowns

- No actual Render service hostname, service instance choice, or Vercel project/domain is known, so rewrites and exact public URLs are deployment-time inputs.
- Node `24.22.2` is pinned; the Phase 21L targeted local tests and syntax checks passed on this runtime. Full application and service integration checks remain unrun.
- Atlas topology, version/FCV, network allowlist, database user, actual indexes, duplicate checks, and backup plan are unverified.
- Redis persistence/provider and SMTP provider/plan are undecided.
- Production startup disables Mongoose automatic index and collection initialization, then checks all 36 collections and declared indexes before either service becomes ready. MongoDB can still implicitly create a collection if an application write occurs without this gate; do not bypass startup readiness. The separate collection initializer and index provisioning CLI have not been run; an operator must complete and verify both stages before Render starts either service.
- First-admin bootstrap and initial account activation still need a separately reviewed operating procedure.
- Baseline academic year, classes, subjects, subject allocations, and initial school settings still need an approved data preparation procedure; this phase creates no records.
- `/health` does not represent Redis or worker readiness.
- No production browser, email, transaction, or service integration checks have been run.

**Conclusion:** deployment preparation is **CONDITIONAL**, not deployment-ready. This guide records source-derived settings and the remaining operator/service decisions; it does not certify runtime compatibility or production readiness.
