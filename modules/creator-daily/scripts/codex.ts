// This entry never imports database/config/provider modules or loads .env.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { beijingDate } from "../backend/sources.ts";
import { collectForCodex, decideForCodex, importLegacy, loadState, publishForCodex, renderEdition, supplementForCodex } from "../backend/codex-store.ts";

const root = fileURLToPath(new URL("../../../.data/codex/", import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  force: { type: "boolean", default: false }, input: { type: "string" },
  id: { type: "string" }, decision: { type: "string" }, reason: { type: "string" },
} });
try {
  const command = positionals[0];
  if (positionals.length !== 1) throw new Error("用法：codex.ts collect|supplement|context|publish|decide|import-legacy|read");
  let result: unknown;
  if (command === "collect") {
    const packet = await collectForCodex(root, values.force);
    result = { date: packet.date, cached: packet.cached, count: packet.signals.length, sources: packet.sources, path: packet.path };
  } else if (command === "context") {
    const state = await loadState(root);
    result = { date: beijingDate(), root,
      todaySaved: state.editions.some(edition => edition.date === beijingDate()),
      recent: state.editions.slice(-14).map(edition => ({ date: edition.date, lead: edition.lead,
        ideas: edition.ideas.map(({ id, title, signalIds }) => ({ id, title, signalIds })) })),
      feedback: state.decisions.map(({ id, decision, payload, reason }) => ({ id, decision, title: payload.title, reason })),
    };
  } else if (command === "publish" || command === "import-legacy" || command === "supplement") {
    if (!values.input) throw new Error("缺少 --input JSON文件路径");
    const input: unknown = JSON.parse(await readFile(values.input, "utf8"));
    result = command === "publish" ? await publishForCodex(root, input, values.force)
      : command === "supplement" ? await supplementForCodex(root, input) : await importLegacy(root, input);
  } else if (command === "decide") {
    if (!values.id || !values.decision) throw new Error("缺少 --id 和 --decision saved|dismissed|new");
    result = await decideForCodex(root, values.id, values.decision, values.reason);
  } else if (command === "read") {
    const edition = (await loadState(root)).editions.find(item => item.date === beijingDate());
    if (!edition) throw new Error("今天尚未生成日报");
    const report = renderEdition(edition);
    await writeFile(join(root, `${edition.date}.md`), report, "utf8");
    process.stdout.write(report);
  } else throw new Error("用法：codex.ts collect|supplement|context|publish|decide|import-legacy|read");
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
