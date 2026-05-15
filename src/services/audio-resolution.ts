import fs from "fs/promises";
import { isSupportedAudioFile } from "../utils/helpers";
import type { ResolveResult } from "../types";

export async function resolveAudioFile(musicDir: string, input: string): Promise<ResolveResult> {
  let allFiles: string[];
  try {
    const dirEntries = await fs.readdir(musicDir);
    allFiles = dirEntries.filter((f: string) => isSupportedAudioFile(f));
  } catch {
    allFiles = [];
  }

  if (allFiles.length === 0) {
    return { ok: false, message: "No audio files found in the music directory." };
  }

  const hasExtension = isSupportedAudioFile(input);

  if (hasExtension) {
    const match = allFiles.find((f) => f.toLowerCase() === input.toLowerCase());
    if (match) {
      return { ok: true, fileName: match };
    }
    return {
      ok: false,
      message: `File not found: ${input}\n\nAvailable files:\n${allFiles.map((f) => `• ${f}`).join("\n")}`,
    };
  }

  const lowerInput = input.toLowerCase();
  const matches = allFiles.filter((f) => {
    const nameWithoutExt = f.substring(0, f.lastIndexOf(".")).toLowerCase();
    return nameWithoutExt === lowerInput;
  });

  if (matches.length === 0) {
    return {
      ok: false,
      message: `No file found matching "${input}".\n\nAvailable files:\n${allFiles.map((f) => `• ${f}`).join("\n")}`,
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      message: `Multiple files found matching "${input}":\n${matches.map((f) => `• ${f}`).join("\n")}\n\nPlease specify the full filename with extension.`,
    };
  }

  return { ok: true, fileName: matches[0] };
}
