#!/bin/sh
# Entrypoint for the READ REPLICA container.
#
# On first start (empty data volume) it clones the primary with
# pg_basebackup. "-R" writes standby.signal + the connection settings, so
# the server starts in recovery mode and keeps streaming changes (WAL) from
# the primary forever. After that it just starts PostgreSQL.
set -eu

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "replica: waiting for primary at ${PRIMARY_HOST}..."
  until pg_isready -h "$PRIMARY_HOST" -p 5432 -U postgres >/dev/null 2>&1; do sleep 1; done

  export PGPASSWORD="${REPLICATION_PASSWORD:-replicator}"
  # The primary's init scripts (schema + 200k seed polls) may still be
  # running; retry until the replication user exists and the copy succeeds.
  until pg_basebackup -h "$PRIMARY_HOST" -p 5432 -U replicator -D "$PGDATA" -R -X stream -c fast; do
    echo "replica: primary not ready for replication yet, retrying in 3s"
    rm -rf "${PGDATA:?}"/*
    sleep 3
  done
  chmod 0700 "$PGDATA"
  echo "replica: base backup complete"
fi

# recovery_min_apply_delay makes the replica deliberately apply changes a bit
# late, so replication lag (and the read-your-writes problem) is visible on a
# laptop, where real lag would be only a few milliseconds.
exec postgres \
  -c hot_standby=on \
  -c recovery_min_apply_delay="${REPLICA_APPLY_DELAY:-2s}" \
  -c max_connections=200
