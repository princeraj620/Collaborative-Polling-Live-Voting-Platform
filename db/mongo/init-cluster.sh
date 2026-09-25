#!/bin/bash
# =====================================================================
# One-shot setup for the sharded MongoDB cluster (runs in the mongo-init
# container, then exits). Safe to run again: every step checks first.
#
#   cfg1                  config server replica set "cfgrs"
#   a1  a2  a3            shard "shard-a" (replica set): Mumbai, Frankfurt, Virginia
#   b1  b2  b3            shard "shard-b" (replica set): Mumbai, Frankfurt, Virginia
#   mongos                router the API connects to
# =====================================================================
set -euo pipefail

log() { echo "[mongo-init] $*"; }

wait_for_mongod() {
  until mongosh --host "$1" --quiet --eval 'db.adminCommand({ ping: 1 }).ok' >/dev/null 2>&1; do
    log "waiting for $1 ..."
    sleep 2
  done
}

wait_for_primary() {
  until [ "$(mongosh --host "$1" --quiet --eval 'db.hello().isWritablePrimary' 2>/dev/null)" = "true" ]; do
    log "waiting for $1 to become PRIMARY ..."
    sleep 2
  done
}

for host in cfg1 a1 a2 a3 b1 b2 b3; do wait_for_mongod "$host:27017"; done

# --- 1. Config server replica set ------------------------------------------
log "initiating config server replica set"
mongosh --host cfg1:27017 --quiet --eval '
  try { rs.status(); print("cfgrs already initiated"); }
  catch (e) {
    rs.initiate({ _id: "cfgrs", configsvr: true, members: [{ _id: 0, host: "cfg1:27017" }] });
  }'

# --- 2. Shard replica sets, one member per "region" -------------------------
# Mumbai gets a higher priority, so it is the preferred primary. If it dies,
# Frankfurt or Virginia is elected automatically (majority = 2 of 3).
init_shard() {
  local name=$1 mumbai=$2 frankfurt=$3 virginia=$4
  log "initiating $name"
  mongosh --host "$mumbai:27017" --quiet --eval "
    try { rs.status(); print('$name already initiated'); }
    catch (e) {
      rs.initiate({
        _id: '$name',
        members: [
          { _id: 0, host: '$mumbai:27017',    priority: 2, tags: { region: 'mumbai' } },
          { _id: 1, host: '$frankfurt:27017', priority: 1, tags: { region: 'frankfurt' } },
          { _id: 2, host: '$virginia:27017',  priority: 1, tags: { region: 'virginia' } }
        ]
      });
    }"
}
init_shard shard-a a1 a2 a3
init_shard shard-b b1 b2 b3

wait_for_primary cfg1:27017
wait_for_primary a1:27017
wait_for_primary b1:27017

# --- 3. Router: register shards, shard the collections -----------------------
wait_for_mongod mongos:27017
log "configuring sharding through mongos"
mongosh --host mongos:27017 --quiet /scripts/init-sharding.js

log "cluster ready"
