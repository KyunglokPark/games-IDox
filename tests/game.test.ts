import { describe, it, expect } from "vitest";
import { deal, play, pass, computeScores, GameState } from "../src/engine/game.ts";
import { botMove } from "../src/engine/moves.ts";
import { tileId } from "../src/engine/tiles.ts";

function newGame(n: number, seed = 42): GameState {
  const players = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isBot: true,
  }));
  return deal({ players, seed });
}

describe("딜링", () => {
  it("3인: 각 12장, 선은 구름3 보유자", () => {
    const s = newGame(3);
    expect(s.players.every((p) => p.hand.length === 12)).toBe(true);
    const cloud3 = tileId({ num: 3, suit: 0 });
    expect(s.players[s.turn].hand.some((t) => tileId(t) === cloud3)).toBe(true);
  });
  it("4인 13장, 5인 12장", () => {
    expect(newGame(4).players.every((p) => p.hand.length === 13)).toBe(true);
    expect(newGame(5).players.every((p) => p.hand.length === 12)).toBe(true);
  });
});

describe("턴 진행", () => {
  it("선은 패스할 수 없다", () => {
    const s = newGame(3);
    const r = pass(s, s.turn);
    expect(r.ok).toBe(false);
  });
  it("차례가 아니면 낼 수 없다", () => {
    const s = newGame(3);
    const other = (s.turn + 1) % 3;
    const r = play(s, other, [s.players[other].hand[0]]);
    expect(r.ok).toBe(false);
  });
  it("모두 패스하면 마지막으로 낸 사람이 새 선", () => {
    let s = newGame(3);
    const leader = s.turn;
    const r1 = play(s, leader, [s.players[leader].hand[0]]);
    expect(r1.ok).toBe(true);
    s = r1.state;
    // 나머지 둘 패스
    s = pass(s, s.turn).state;
    s = pass(s, s.turn).state;
    expect(s.lastPlay).toBeNull();
    expect(s.turn).toBe(leader);
  });
});

describe("점수 계산", () => {
  it("공식 예시: 남은타일 [0,4,7] -> [+11,-1,-10]", () => {
    const s = newGame(3);
    // 손패를 강제로 세팅 (2 타일 없는 것으로)
    s.players[0].hand = [];
    s.players[1].hand = [
      { num: 3, suit: 0 }, { num: 4, suit: 0 }, { num: 5, suit: 0 }, { num: 6, suit: 0 },
    ];
    s.players[2].hand = [
      { num: 3, suit: 1 }, { num: 4, suit: 1 }, { num: 5, suit: 1 }, { num: 6, suit: 1 },
      { num: 7, suit: 1 }, { num: 8, suit: 1 }, { num: 9, suit: 1 },
    ];
    const rows = computeScores(s);
    expect(rows.map((r) => r.score)).toEqual([11, -1, -10]);
  });

  it("2 타일 보유 시 남은 타일수 2배 페널티", () => {
    const s = newGame(3);
    s.players[0].hand = [];
    s.players[1].hand = [{ num: 2, suit: 0 }, { num: 5, suit: 0 }]; // 2장, 2 포함 -> eff 4
    s.players[2].hand = [{ num: 5, suit: 1 }, { num: 6, suit: 1 }]; // 2장 -> eff 2
    const rows = computeScores(s);
    expect(rows.map((r) => r.effective)).toEqual([0, 4, 2]);
    // 제로섬 확인
    expect(rows.reduce((a, r) => a + r.score, 0)).toBe(0);
  });
});

describe("봇 자동 플레이 통합", () => {
  it("전원 봇으로 게임이 정상 종료된다", () => {
    let s = newGame(4, 7);
    let guard = 0;
    while (s.phase === "playing" && guard++ < 2000) {
      const mv = botMove(s, s.turn);
      const r = mv ? play(s, s.turn, mv.tiles) : pass(s, s.turn);
      expect(r.ok).toBe(true);
      s = r.state;
    }
    expect(s.phase).toBe("ended");
    expect(s.finishedOrder.length).toBe(1); // 첫 완주자 발생 시 종료
    const rows = computeScores(s);
    expect(rows.reduce((a, r) => a + r.score, 0)).toBe(0); // 제로섬
  });
});
