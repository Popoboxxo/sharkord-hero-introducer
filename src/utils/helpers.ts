export const SUPPORTED_EXTENSIONS = [".mp3", ".mpeg"];
export const INTRO_DELAY_MS = Number(process.env.HERO_INTRO_DELAY_MS ?? "5000");

export function isSupportedAudioFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
