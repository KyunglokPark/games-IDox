import { describe, it, expect } from "vitest";
import { Suit, Tile } from "../src/engine/types.ts";
import { evaluate, beats, compareCombo } from "../src/engine/combos.ts";
import { numRank, tileStrength } from "../src/engine/tiles.ts";

const T = (num: number, suit: Suit): Tile => ({ num, suit });

describe("숫자 강함 순위", () => {
  it("3<4<...<15<1<2", () => {
    expect(numRank(3)).toBe(0);
    expect(numRank(15)).toBe(12);
    expect(numRank(1)).toBe(13);
    expect(numRank(2)).toBe(14);
  });
  it("타일 강함은 숫자 우선, 무늬 차선", () => {
    expect(tileStrength(T(2, Suit.Sun))).toBe(59); // 최강
    expect(tileStrength(T(3, Suit.Cloud))).toBe(0); // 최약
    expect(tileStrength(T(5, Suit.Sun))).toBeGreaterThan(tileStrength(T(5, Suit.Cloud)));
  });
});

describe("싱글/페어/트리플", () => {
  it("싱글 비교", () => {
    const a = evaluate([T(2, Suit.Cloud)])!;
    const b = evaluate([T(15, Suit.Sun)])!;
    expect(beats(a, b)).toBe(true); // 2 > 15
  });
  it("페어는 같은 숫자만, 무늬로 동률 처리", () => {
    expect(evaluate([T(5, Suit.Cloud), T(6, Suit.Cloud)])).toBeNull();
    const a = evaluate([T(5, Suit.Cloud), T(5, Suit.Sun)])!;
    const b = evaluate([T(5, Suit.Star), T(5, Suit.Moon)])!;
    expect(beats(a, b)).toBe(true); // 최고무늬 해 > 달
  });
  it("트리플", () => {
    expect(evaluate([T(7, Suit.Cloud), T(7, Suit.Star), T(7, Suit.Moon)])!.type).toBe("triple");
    expect(evaluate([T(7, Suit.Cloud), T(7, Suit.Star), T(8, Suit.Moon)])).toBeNull();
  });
});

describe("5장 조합 족보", () => {
  const straight = [T(3, Suit.Cloud), T(4, Suit.Star), T(5, Suit.Moon), T(6, Suit.Sun), T(7, Suit.Cloud)];
  const flush = [T(3, Suit.Sun), T(6, Suit.Sun), T(9, Suit.Sun), T(11, Suit.Sun), T(14, Suit.Sun)];
  const fullhouse = [T(8, Suit.Cloud), T(8, Suit.Star), T(8, Suit.Moon), T(5, Suit.Cloud), T(5, Suit.Sun)];
  const fourkind = [T(9, Suit.Cloud), T(9, Suit.Star), T(9, Suit.Moon), T(9, Suit.Sun), T(2, Suit.Cloud)];
  const straightFlush = [T(3, Suit.Sun), T(4, Suit.Sun), T(5, Suit.Sun), T(6, Suit.Sun), T(7, Suit.Sun)];

  it("각 족보 인식", () => {
    expect(evaluate(straight)!.type).toBe("straight");
    expect(evaluate(flush)!.type).toBe("flush");
    expect(evaluate(fullhouse)!.type).toBe("fullhouse");
    expect(evaluate(fourkind)!.type).toBe("fourkind");
    expect(evaluate(straightFlush)!.type).toBe("straightflush");
  });

  it("족보 순위: 스트레이트<플러시<풀하우스<포카드<스플", () => {
    expect(beats(evaluate(flush)!, evaluate(straight)!)).toBe(true);
    expect(beats(evaluate(fullhouse)!, evaluate(flush)!)).toBe(true);
    expect(beats(evaluate(fourkind)!, evaluate(fullhouse)!)).toBe(true);
    expect(beats(evaluate(straightFlush)!, evaluate(fourkind)!)).toBe(true);
  });

  it("스트레이트 12-13-14-15-1 이 11-12-13-14-15 보다 강함", () => {
    const wrap = [T(12, Suit.Cloud), T(13, Suit.Star), T(14, Suit.Moon), T(15, Suit.Sun), T(1, Suit.Cloud)];
    const high = [T(11, Suit.Cloud), T(12, Suit.Star), T(13, Suit.Moon), T(14, Suit.Sun), T(15, Suit.Cloud)];
    expect(evaluate(wrap)!.type).toBe("straight");
    expect(beats(evaluate(wrap)!, evaluate(high)!)).toBe(true);
  });

  it("1-2-3-4-5 는 가장 약한 스트레이트", () => {
    const low = [T(1, Suit.Cloud), T(2, Suit.Star), T(3, Suit.Moon), T(4, Suit.Sun), T(5, Suit.Cloud)];
    const next = [T(2, Suit.Cloud), T(3, Suit.Star), T(4, Suit.Moon), T(5, Suit.Sun), T(6, Suit.Cloud)];
    expect(evaluate(low)!.type).toBe("straight");
    expect(beats(evaluate(next)!, evaluate(low)!)).toBe(true);
  });

  it("2-3-4-5-6 이후 wrap 아닌 13-14-15-1-2 는 스트레이트 아님", () => {
    const invalid = [T(13, Suit.Cloud), T(14, Suit.Star), T(15, Suit.Moon), T(1, Suit.Sun), T(2, Suit.Cloud)];
    expect(evaluate(invalid)).toBeNull();
  });

  it("풀하우스는 트리플 숫자로만 비교", () => {
    const fhLow = [T(4, Suit.Cloud), T(4, Suit.Star), T(4, Suit.Moon), T(15, Suit.Cloud), T(15, Suit.Sun)];
    const fhHigh = [T(5, Suit.Cloud), T(5, Suit.Star), T(5, Suit.Moon), T(3, Suit.Cloud), T(3, Suit.Sun)];
    expect(beats(evaluate(fhHigh)!, evaluate(fhLow)!)).toBe(true); // 트리플 5 > 4
  });

  it("장수 다르면 비교 불가", () => {
    expect(Number.isNaN(compareCombo(evaluate([T(5, Suit.Cloud)])!, evaluate(flush)!))).toBe(true);
  });
});
