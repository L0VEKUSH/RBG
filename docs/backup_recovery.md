# Backup & Disaster Recovery

This document describes operational procedures for backing up and restoring the RBG School ERP MongoDB database.

> IMPORTANT: The database name is driven by the application's MONGO_URI environment variable.
> Never hardcode a database name. The examples below use $DB_NAME which must
> be set from your environment or secret manager before running any script.

---

## 1. Configuration

Set these variables in your deployment environment or CI/CD secrets:

```bash
# The full MongoDB connection string (from .env or secret manager)
export MONGO_URI="mongodb+srv://user:pass@cluster.example.net/school_management_db"

# Extract the database name from the URI programmatically - do NOT hardcode it.
export DB_NAME=$(echo "$MONGO_URI" | sed 's/.*\///' | cut -d'?' -f1)
# Result: school_management_db (or whatever the operator has configured)

export BACKUP_DIR="/var/backups/mongodb"
export S3_BUCKET="s3://sunrise-school-db-backups"   # replace with real bucket
```

---

## 2. Daily Automated Backup (Cron - 2:00 AM)

### scripts/backup.sh

```bash
#!/usr/bin/env bash
# Exit immediately on any error, treat unset vars as errors.
set -euo pipefail

# Configuration
: "${MONGO_URI:?MONGO_URI is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"

DB_NAME=$(echo "$MONGO_URI" | sed 's/.*\///' | cut -d'?' -f1)
DATE=$(date +%Y-%m-%d_%H%M%S)
ARCHIVE_NAME="${DB_NAME}-${DATE}.archive.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Run mongodump
echo "[backup] Starting dump of $DB_NAME at $(date)..."
mongodump --uri="$MONGO_URI" --archive="$ARCHIVE_PATH" --gzip
echo "[backup] Dump complete: $ARCHIVE_PATH"

# Verify archive is non-empty
ARCHIVE_SIZE=$(stat -c%s "$ARCHIVE_PATH" 2>/dev/null || stat -f%z "$ARCHIVE_PATH")
if [[ "$ARCHIVE_SIZE" -lt 1024 ]]; then
  echo "[backup] ERROR: Archive is suspiciously small (${ARCHIVE_SIZE} bytes). Aborting upload." >&2
  exit 1
fi
echo "[backup] Archive size: ${ARCHIVE_SIZE} bytes. OK."

# Upload to S3
echo "[backup] Uploading to $S3_BUCKET ..."
aws s3 cp "$ARCHIVE_PATH" "${S3_BUCKET}/"
echo "[backup] Upload complete."

# Verify upload
aws s3 ls "${S3_BUCKET}/${ARCHIVE_NAME}" || { echo "[backup] ERROR: Upload verification failed." >&2; exit 1; }
echo "[backup] Upload verified."

# Purge local copies older than 7 days
find "$BACKUP_DIR" -type f -name "*.gz" -mtime +7 -exec rm -v {} \;

echo "[backup] Backup procedure complete at $(date)."
```

Crontab entry (runs as the app service account):

```cron
0 2 * * * /usr/local/bin/backup.sh >> /var/log/sunrise-backup.log 2>&1
```

---

## 3. Restore Procedure (Isolated Test DB First)

CAUTION: Never restore directly to the production database without first validating
the archive in an isolated test database.

### Step 1 - Download the archive

```bash
ARCHIVE="school_management_db-2026-10-29_020000.archive.gz"   # replace with actual name
aws s3 cp "${S3_BUCKET}/${ARCHIVE}" ./
```

### Step 2 - Validate the archive locally

```bash
# Quick integrity check - will error if the gzip stream is corrupt.
gzip -t "$ARCHIVE" && echo "Archive integrity OK" || { echo "Corrupt archive!"; exit 1; }
```

### Step 3 - Restore to an ISOLATED test database

```bash
# Use a separate test URI - NEVER point this at production.
TEST_URI="mongodb://localhost:27017/school_management_restore_test"
mongorestore --uri="$TEST_URI" --gzip --archive="$ARCHIVE" --drop
echo "Restore to test DB complete."
```

### Step 4 - Verify restored data

```bash
mongosh "$TEST_URI" --eval "
  const u = db.users.countDocuments();
  const s = db.students.countDocuments();
  print('Users:', u, ' Students:', s);
  if (u < 1) throw new Error('Restore verification failed: no users found');
"
```

### Step 5 - Smoke-test the application against the restored DB

```bash
MONGO_URI="$TEST_URI" NODE_ENV=test node server.js &
APP_PID=$!
sleep 5
curl -sf http://localhost:5000/health | grep '"status":"ok"' && echo "Health check OK" || echo "Health check FAILED"
kill $APP_PID
```

### Step 6 - Restore to production (only after Steps 2-5 pass)

Requires a second approver sign-off. Stop the application before restoring.

```bash
# Stop app
pm2 stop sunrise-erp

# Restore - --drop replaces existing collections from the archive.
mongorestore --uri="$MONGO_URI" --gzip --archive="$ARCHIVE" --drop

# Restart app
pm2 start sunrise-erp

# Run security regression
node security_matrix.js
```

---

## 4. Access Controls & Retention

| Control | Requirement |
|---------|-------------|
| S3 bucket policy | Server-side encryption (SSE-S3 or SSE-KMS); bucket versioning enabled |
| S3 access | Restrict to backup service IAM role only; no public access |
| Local backup dir | Mode 700, owned by app service account |
| Retention | 7 days local, 30 days S3 (lifecycle rule) |
| Restore approval | Two-person rule for production restores |
| Backup verification | Monthly restore drill to isolated DB |

---

## 5. High Availability (Replica Set)

For zero-downtime production, deploy MongoDB as a 3-node replica set (Primary + 2 Secondaries)
across multiple availability zones. Point MONGO_URI at the replica set connection string:

```
mongodb://node1:27017,node2:27017,node3:27017/school_management_db?replicaSet=rs0
```

mongodump with --uri handles replica set connections automatically.
