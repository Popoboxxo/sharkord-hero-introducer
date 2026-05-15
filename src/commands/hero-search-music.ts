import type { TInvokerContext } from "@sharkord/plugin-sdk";
import type { PluginState } from "../types";
import path from "path";
import fs from "fs/promises";
import { Database } from "bun:sqlite";

interface AudioFileRow {
  name: string;
  original_name: string | null;
  mime_type: string;
  extension: string;
}

export function registerHeroSearchMusicCommand(state: PluginState): void {
  const { ctx, musicDir, debugLog } = state;

  ctx.commands.register({
    name: "hero-search-music",
    description: "Search chat attachments for audio files and add them to the music library.",
    args: [],
    async execute(invokerCtx: TInvokerContext) {
      debugLog(`/hero-search-music called by userId=${(invokerCtx as Record<string, unknown>).userId}`);

      const dbPath = path.join(ctx.path, "..", "..", "db.sqlite");
      const publicDir = path.join(ctx.path, "..", "..", "public");

      debugLog(`hero-search-music: dbPath=${dbPath}, publicDir=${publicDir}, musicDir=${musicDir}`);

      let rows: AudioFileRow[];

      try {
        const db = new Database(dbPath, { readonly: true });
        rows = db.query(`
          SELECT DISTINCT f.name, f.original_name, f.mime_type, f.extension
          FROM files f
          INNER JOIN message_files mf ON mf.fileId = f.id
          WHERE f.mime_type IN ('audio/mpeg', 'audio/mp3')
             OR LOWER(f.extension) IN ('.mp3', '.mpeg', 'mp3', 'mpeg')
        `).all() as AudioFileRow[];
        db.close();
        debugLog(`hero-search-music: query returned ${rows.length} row(s)`);
      } catch (err) {
        const errorMsg = `Failed to read database at "${dbPath}": ${String(err)}`;
        ctx.error(`/hero-search-music: ${errorMsg}`);
        return errorMsg;
      }

      let copied = 0;
      let skipped = 0;
      const copiedFiles: string[] = [];
      const skippedFiles: string[] = [];

      for (const row of rows) {
        const destName = (row.original_name && row.original_name.trim().length > 0)
          ? row.original_name.trim()
          : row.name;

        const srcPath = path.join(publicDir, row.name);
        const destPath = path.join(musicDir, destName);

        debugLog(`hero-search-music: processing row name="${row.name}", original_name="${row.original_name ?? "null"}", destName="${destName}"`);

        try {
          await fs.access(destPath);
          debugLog(`hero-search-music: skipping "${destName}" (already exists in music dir)`);
          skipped++;
          skippedFiles.push(destName);
          continue;
        } catch {
          // proceed
        }

        const srcFile = Bun.file(srcPath);
        const srcExists = await srcFile.exists();
        if (!srcExists) {
          ctx.log(`[WARN] hero-search-music: source file not found, skipping — "${srcPath}"`);
          debugLog(`hero-search-music: source not found: ${srcPath}`);
          skipped++;
          skippedFiles.push(`${destName} (source missing: ${row.name})`);
          continue;
        }

        try {
          await Bun.write(destPath, srcFile);
          debugLog(`hero-search-music: copied "${row.name}" → "${destName}"`);
          copied++;
          copiedFiles.push(destName);
        } catch (err) {
          ctx.error(`hero-search-music: failed to copy "${row.name}" → "${destName}": ${String(err)}`);
          skipped++;
          skippedFiles.push(`${destName} (copy error: ${String(err)})`);
        }
      }

      const lines: string[] = [
        "Search complete.",
        `Found: ${rows.length} audio file(s) in chat attachments`,
        `Copied: ${copied}`,
        `Skipped (already exists): ${skipped}`,
      ];

      if (copiedFiles.length > 0) {
        lines.push("", "Copied files:");
        for (const f of copiedFiles) {
          lines.push(`  + ${f}`);
        }
      }

      if (skippedFiles.length > 0) {
        lines.push("", "Skipped files:");
        for (const f of skippedFiles) {
          lines.push(`  - ${f}`);
        }
      }

      const result = lines.join("\n");
      debugLog(`hero-search-music: done — ${result}`);
      return result;
    },
  });
}
