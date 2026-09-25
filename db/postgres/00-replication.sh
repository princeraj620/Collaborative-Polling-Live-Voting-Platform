#!/bin/bash
# Runs once on the PRIMARY when its data volume is first created
# (official postgres image: /docker-entrypoint-initdb.d/*).
# Creates the user the replica logs in as, and allows it to stream WAL.
set -eo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD:-replicator}';
SQL

# Allow replication connections from other containers on the Docker network.
echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
