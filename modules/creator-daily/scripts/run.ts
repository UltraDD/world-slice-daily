import { closeDb } from "@aihot/backend/db";
import { runDaily } from "../backend/pipeline.ts";

try {
  const result = await runDaily({ force: process.argv.includes("--force"), collectOnly: process.argv.includes("--collect-only") });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : "更新失败");
  process.exitCode = 1;
} finally { await closeDb(); }
