// Dedicated public-trial worker. Existing class records and budgets are never read.
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCursorInference } from "./lib/cursor-inference.mjs";
import { completeLegacyJob } from "../src/lib/runtime/ai.mjs";

/** Finish exactly once. A lost DB acknowledgement must not regenerate paid inference. */
export async function runTrialJob({ job, infer, rpc }) {
  return completeLegacyJob({
    rpc,
    name: "trial_finish",
    fallback: { p_id: job.id, p_lease: job.lease, p_result: null, p_error: true },
    generate: async () => ({
      p_id: job.id,
      p_lease: job.lease,
      p_result: await infer({
        conditions: "물 1g/cm³. 나무 80g/100cm³와 철 20g/2.56cm³를 넣는다.",
        prediction: job.prediction,
        reason: job.reason,
      }),
      p_error: false,
    }),
  });
}

export async function startTrialWorker() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } });
  const { run } = await createCursorInference({
    workspace: resolve(process.env.CURSOR_WORKSPACE || ".worker-inference", "trial"),
  });
  const rpc = (name, args) => db.rpc(name, args);
  let stopped = false;
  let heartbeatPending = false;
  const stop = () => { stopped = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Inference can take 60 seconds: heartbeat continues independently of model work.
  const heartbeat = setInterval(async () => {
    if (heartbeatPending || stopped) return;
    heartbeatPending = true;
    try {
      const { error } = await rpc("trial_tick", { p_claim: false });
      if (error) throw new Error("heartbeat_failed");
    } catch {
      console.log(JSON.stringify({ event: "trial_heartbeat_failure" }));
    } finally { heartbeatPending = false; }
  }, 15000);
  console.log(JSON.stringify({ event: "trial_worker_started" }));
  try {
    while (!stopped) {
      try {
        const { data: job, error } = await rpc("trial_tick", { p_claim: true });
        if (error) throw new Error("claim_failed");
        if (job) {
          const completion = await runTrialJob({ job, infer: run, rpc });
          console.log(JSON.stringify({ event: "trial_finished", id: job.id, ...completion }));
        }
      } catch {
        console.log(JSON.stringify({ event: "trial_worker_connection_failure" }));
      }
      if (!stopped) await new Promise((done) => setTimeout(done, 3000));
    }
  } finally {
    clearInterval(heartbeat);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startTrialWorker();
}
