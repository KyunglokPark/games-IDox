// 조합 평가 및 비교
import { Combo, ComboType, Tile } from "./types.ts";
import { numRank, sortByStrength, tileStrength } from "./tiles.ts";

// 5장 조합 족보 순위 (값이 클수록 강함)
const CATEGORY: Record<ComboType, number> = {
  [ComboType.Single]: 0,
  [ComboType.Pair]: 0,
  [ComboType.Triple]: 0,
  [ComboType.Straight]: 0,
  [ComboType.Flush]: 1,
  [ComboType.FullHouse]: 2,
  [ComboType.FourKind]: 3,
  [ComboType.StraightFlush]: 4,
};

/** face 값 래핑: 16 -> 1 (스트레이트 12-13-14-15-1 처리용) */
function wrapFace(x: number): number {
  return x > 15 ? x - 15 : x;
}

/** 허용 스트레이트: 시작 face 1..12, [s..s+4]. 반환은 numset->시작face 매핑 */
const STRAIGHT_SETS: { start: number; nums: Set<number> }[] = (() => {
  const out: { start: number; nums: Set<number> }[] = [];
  for (let s = 1; s <= 12; s++) {
    const nums = new Set<number>();
    for (let i = 0; i < 5; i++) nums.add(wrapFace(s + i));
    out.push({ start: s, nums });
  }
  return out;
})();

/** 스트레이트면 시작 face(1..12) 반환, 아니면 null */
function straightStart(tiles: Tile[]): number | null {
  const nums = new Set(tiles.map((t) => t.num));
  if (nums.size !== 5) return null;
  for (const cand of STRAIGHT_SETS) {
    if (cand.nums.size === nums.size && [...nums].every((n) => cand.nums.has(n))) {
      return cand.start;
    }
  }
  return null;
}

/** 숫자별 개수 맵 */
function numCounts(tiles: Tile[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of tiles) m.set(t.num, (m.get(t.num) ?? 0) + 1);
  return m;
}

function maxSuit(tiles: Tile[]): number {
  return Math.max(...tiles.map((t) => t.suit));
}

/** 가장 강한 타일(숫자 강함 우선, 같으면 무늬) */
function strongestTile(tiles: Tile[]): Tile {
  return tiles.reduce((best, t) => (tileStrength(t) > tileStrength(best) ? t : best));
}

/**
 * 타일 묶음이 유효한 조합인지 평가. 유효하면 Combo, 아니면 null.
 * 중복 타일 검사는 상위 로직(손패 검증)에서 처리한다고 가정.
 */
export function evaluate(input: Tile[]): Combo | null {
  const tiles = sortByStrength(input);
  const n = tiles.length;

  if (n === 1) {
    return combo(ComboType.Single, tiles, [tileStrength(tiles[0])]);
  }

  if (n === 2) {
    if (tiles[0].num !== tiles[1].num) return null;
    return combo(ComboType.Pair, tiles, [numRank(tiles[0].num), maxSuit(tiles)]);
  }

  if (n === 3) {
    if (tiles[0].num !== tiles[1].num || tiles[1].num !== tiles[2].num) return null;
    return combo(ComboType.Triple, tiles, [numRank(tiles[0].num), maxSuit(tiles)]);
  }

  if (n === 5) {
    const start = straightStart(tiles);
    const isFlush = tiles.every((t) => t.suit === tiles[0].suit);
    const counts = [...numCounts(tiles).entries()];
    // 스트레이트/플러시류는 가장 강한 타일로 서열 (숫자 강함 2>1>15>… , 같으면 무늬)
    const topStr = tileStrength(strongestTile(tiles));

    if (start !== null && isFlush) {
      // 스트레이트 플러시
      return combo(ComboType.StraightFlush, tiles, [topStr]);
    }

    const four = counts.find(([, c]) => c === 4);
    if (four) {
      return combo(ComboType.FourKind, tiles, [numRank(four[0])]);
    }

    const triple = counts.find(([, c]) => c === 3);
    const pair = counts.find(([, c]) => c === 2);
    if (triple && pair) {
      // 풀하우스: 트리플 부분으로만 서열
      return combo(ComboType.FullHouse, tiles, [numRank(triple[0])]);
    }

    if (isFlush) {
      // 플러시: 가장 강한 타일로 비교 (숫자 높은 게 이기고, 같으면 무늬)
      return combo(ComboType.Flush, tiles, [topStr]);
    }

    if (start !== null) {
      // 스트레이트: 가장 강한 타일로 비교 (2>1>15>… , 같으면 무늬)
      return combo(ComboType.Straight, tiles, [topStr]);
    }
  }

  return null;
}

function combo(type: ComboType, tiles: Tile[], key: number[]): Combo {
  return { type, count: tiles.length, category: CATEGORY[type], key, tiles };
}

/** key 사전식 비교. a>b 면 양수. */
function compareKey(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 두 조합 비교. 같은 장수일 때만 의미 있음.
 * a>b(=a가 더 강함)면 양수, 같으면 0, 약하면 음수.
 * 장수가 다르면 NaN.
 */
export function compareCombo(a: Combo, b: Combo): number {
  if (a.count !== b.count) return NaN;
  if (a.category !== b.category) return a.category - b.category;
  return compareKey(a.key, b.key);
}

/** a 가 b 를 받아칠 수 있는가 (같은 장수 & 더 강함) */
export function beats(a: Combo, b: Combo): boolean {
  return a.count === b.count && compareCombo(a, b) > 0;
}
