#!/usr/bin/env bash
set -euo pipefail
# Guard against accidentally running destructive fixtures in a hosted database.
: "${DATABASE_URL:?Set a disposable localhost PostgreSQL URL}"
python - <<'CHECK'
import os
from urllib.parse import urlparse
u=urlparse(os.environ['DATABASE_URL'])
assert u.hostname in ('localhost','127.0.0.1','::1') and not u.query and u.path=='/science_sos_test' and os.environ.get('ALLOW_DISPOSABLE_DATABASE')=='yes', 'Refusing non-disposable database'
CHECK
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db/bootstrap.sql
for sql in supabase/migrations/00{1,2,3,4}_*.sql; do psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$sql"; done
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db/fixtures.sql
for sql in supabase/migrations/00{5,6,7,8}_*.sql; do psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$sql"; done
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/db/learning.sql
python scripts/db/concurrency.py
