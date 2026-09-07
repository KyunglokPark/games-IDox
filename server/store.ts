// 유저 프로필 저장소. Upstash Redis(REST) 사용, env 없으면 메모리 폴백(로컬 개발용).
export interface Profile {
  pin: string;
  coins: number;
}

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = !!(REST_URL && REST_TOKEN);
const mem = new Map<string, Profile>();

export function storageMode(): string {
  return useRedis ? "Upstash Redis" : "메모리(폴백)";
}

async function redis(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(REST_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: string };
  if (j.error) throw new Error(j.error);
  return j.result;
}

const key = (name: string) => `lexio:user:${name.toLowerCase()}`;

export async function getProfile(name: string): Promise<Profile | null> {
  if (!useRedis) return mem.get(key(name)) ?? null;
  try {
    const v = (await redis(["GET", key(name)])) as string | null;
    return v ? (JSON.parse(v) as Profile) : null;
  } catch (e) {
    console.error("[store] getProfile 실패:", (e as Error).message);
    return mem.get(key(name)) ?? null; // 장애 시 메모리 폴백
  }
}

export async function saveProfile(name: string, p: Profile): Promise<void> {
  mem.set(key(name), p); // 메모리 캐시도 갱신
  if (!useRedis) return;
  try {
    await redis(["SET", key(name), JSON.stringify(p)]);
  } catch (e) {
    console.error("[store] saveProfile 실패:", (e as Error).message);
  }
}
