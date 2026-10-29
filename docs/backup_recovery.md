# Backup & Disaster Recovery Readiness

This document outlines the operational procedures for backing up and restoring the Sunrise Public School ERP MongoDB database. 
Since the application uses MongoDB, the primary tools for backup and recovery are `mongodump` and `mongorestore`.

## 1. Automated Daily Backups (Cron)
A background cron job should be configured on the database server to run daily at 2:00 AM. 
The script dumps the entire database, compresses it, and ships it to an offsite secure storage bucket (e.g., AWS S3).

### Backup Script (`backup.sh`)
```bash
#!/bin/bash
# Backup configuration
DB_NAME="sunriseschool"
BACKUP_DIR="/var/backups/mongodb"
DATE=$(date +%Y-%m-%d_%H%M%S)
ARCHIVE_NAME="$DB_NAME-$DATE.archive.gz"
S3_BUCKET="s3://sunrise-school-db-backups"

# Ensure directory exists
mkdir -p $BACKUP_DIR

# Run mongodump and pipe to gzip
echo "Starting backup of $DB_NAME..."
mongodump --db=$DB_NAME --archive=$BACKUP_DIR/$ARCHIVE_NAME --gzip

# Upload to S3
echo "Uploading to S3..."
aws s3 cp $BACKUP_DIR/$ARCHIVE_NAME $S3_BUCKET/

# Cleanup old backups (keep last 7 days locally)
find $BACKUP_DIR -type f -name "*.gz" -mtime +7 -exec rm {} \;

echo "Backup complete."
```

## 2. Disaster Recovery Procedure (Restoration)

In the event of catastrophic data loss or database corruption, follow these steps to restore the database from the latest backup.

### Step 1: Locate and Download the Latest Backup
Retrieve the latest `.archive.gz` file from the S3 bucket.
```bash
aws s3 cp s3://sunrise-school-db-backups/sunriseschool-2026-09-24_020000.archive.gz ./
```

### Step 2: Drop the Corrupted Database (If Necessary)
If restoring over a partially corrupted database, it may be safer to drop the existing database first (ensure no active connections).
*Warning: This action is destructive.*
```bash
mongosh --eval "db.getSiblingDB('sunriseschool').dropDatabase()"
```

### Step 3: Execute `mongorestore`
Restore the archive into the database instance.
```bash
mongorestore --gzip --archive=sunriseschool-2026-09-24_020000.archive.gz
```

### Step 4: Verify Application Integrity
1. Start the Node.js server.
2. Log in as `super_admin`.
3. Verify recent Admissions and Student records are intact.
4. Verify the `security_matrix.js` passes 39/39 to ensure RBAC collections (Users/Permissions) restored correctly.

## 3. High Availability (Replica Sets)
For zero-downtime operations, the production MongoDB cluster should be deployed as a 3-node Replica Set (Primary + 2 Secondaries) across multiple availability zones. This ensures that if the Primary node fails, a Secondary node is automatically elected as Primary with no data loss.
