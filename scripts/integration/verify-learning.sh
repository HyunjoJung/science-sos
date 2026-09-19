#!/usr/bin/env bash
set -euo pipefail
: "${TEST_DATABASE_URL:?Disposable local PostgreSQL required}"
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_only
export SUPABASE_SECRET_KEY=sb_secret_ci_only
export APP_ORIGIN=http://localhost:3000
export LEARNING_MODEL_ENDPOINT=http://127.0.0.1:55321/v1/chat/completions
export LEARNING_MODEL=ci-fixture
export LEARNING_MODEL_API_KEY=ci-fixture-not-a-secret
export LEARNING_ALLOW_LOCAL_MODEL=true LEARNING_ALLOW_LOCAL_DB=true
export NEXT_TELEMETRY_DISABLED=1
mkdir -p .test-results
node --test scripts/unit/*.test.mjs | tee .test-results/unit.tap
pnpm exec tsc -p tsconfig.foundation.json
pnpm typecheck
pnpm test:demo
pnpm build
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/integration/bootstrap.sql
for migration in supabase/migrations/*.sql; do psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"; done
node --test scripts/integration/learning-db.test.mjs | tee .test-results/database.tap
NODE_ENV=test node scripts/integration/auth-rpc-bridge.mjs >.test-results/bridge.log 2>&1 & bridge=$!
node scripts/learning-worker.mjs >.test-results/worker.log 2>&1 & worker=$!
pnpm start >.test-results/next.log 2>&1 & web=$!
trap 'kill "$bridge" "$worker" "$web" 2>/dev/null || true' EXIT
for i in $(seq 1 60); do
 if curl -fsS http://127.0.0.1:55321/health >/dev/null && curl -fsS http://localhost:3000/learn >/dev/null; then break; fi
 sleep 1
done
node scripts/integration/browser.cjs | tee .test-results/browser.log
