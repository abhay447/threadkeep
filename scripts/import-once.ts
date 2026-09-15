import { importArchive } from "../server/importer.js";
import { loadConfig, saveConfig } from "../server/config.js";
import { stats } from "../server/db.js";

const archive = process.argv[2];
if (!archive) {
  process.stderr.write("Usage: tsx scripts/import-once.ts <archive-folder>\n");
  process.exit(1);
}

saveConfig({ archivePath: archive });
const started = Date.now();
const report = await importArchive(archive);
process.stdout.write(
  `${JSON.stringify({ report, stats: stats(), ms: Date.now() - started, archivePath: loadConfig().archivePath }, null, 2)}\n`,
);
