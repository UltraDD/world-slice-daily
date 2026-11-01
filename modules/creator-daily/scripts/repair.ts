import { sql, closeDb } from "@aihot/backend/db";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { ideaSchema, type Edition } from "../contracts.ts";
import { generateIdea } from "../backend/generate.ts";

try {
  const [row] = await sql`SELECT day,payload FROM creator_editions ORDER BY day DESC LIMIT 1`;
  if (!row) throw new Error("没有待检查的日报");
  const edition = row.payload as Edition;
  for (let index = 0; index < edition.ideas.length; index++) {
    const original = edition.ideas[index];
    if (ideaSchema.safeParse(original).success) continue;
    const response = await generateIdea(original.sources[0], edition.date, true);
    edition.ideas[index] = { ...original, ...response.data.idea };
    await sql.begin(async tx => {
      await tx`UPDATE creator_editions SET payload=${tx.json(edition as never)},generated_at=now() WHERE day=${row.day}`;
      await completeReceipt(tx, response.receiptId);
    });
    console.log(`已修复第 ${index + 1} 张卡片`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : "校订失败"); process.exitCode=1; }
finally { await closeDb(); }
