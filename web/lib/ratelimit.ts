// Simple in-memory sliding-window rate limit per IP. Good enough for a single-container demo;
// use Redis/Upstash for multiple instances.
const hits = new Map<string, number[]>();

export function rateLimited(req: Request, bucket: string, maxPerMinute: number): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > maxPerMinute;
}
