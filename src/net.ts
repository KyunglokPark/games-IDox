// WebSocket 클라이언트 래퍼
import { Tile } from "./engine/index.ts";

export interface LobbyMsg {
  t: "lobby";
  room: string;
  you: number;
  host: number;
  players: { name: string; isBot: boolean }[];
  started: boolean;
}
export interface NetPlayer {
  name: string;
  isBot: boolean;
  handCount: number;
  finished: boolean;
  passed: boolean;
}
export interface StateMsg {
  t: "state";
  seat: number;
  turn: number;
  phase: "playing" | "ended";
  players: NetPlayer[];
  hand: Tile[];
  lastPlay: { seat: number; tiles: Tile[]; count: number } | null;
  log: string[];
}
export interface EndedMsg {
  t: "ended";
  scores: { playerIndex: number; name: string; tilesLeft: number; score: number }[];
}
export interface ErrorMsg {
  t: "error";
  msg: string;
}
export type ServerMsg = LobbyMsg | StateMsg | EndedMsg | ErrorMsg;

/**
 * 기본 서버 주소.
 * - 배포 빌드: `VITE_SERVER_URL`(예: wss://lexio.onrender.com) 주입값 사용.
 * - 로컬 개발: 같은 호스트의 3001 포트.
 * 사용자는 온라인 화면의 "서버 주소" 입력으로 항상 덮어쓸 수 있다.
 */
export function defaultServerUrl(): string {
  const injected = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (injected) return injected;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = location.hostname || "localhost";
  return `${proto}//${host}:3001`;
}

export class Net {
  private ws: WebSocket | null = null;
  onMessage: (m: ServerMsg) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};

  connect(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onOpen();
    this.ws.onclose = () => this.onClose();
    this.ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  join(room: string, name: string) {
    this.send({ t: "join", room, name });
  }
  addBot() {
    this.send({ t: "addbot" });
  }
  removeBot() {
    this.send({ t: "removebot" });
  }
  start() {
    this.send({ t: "start" });
  }
  play(tiles: Tile[]) {
    this.send({ t: "play", tiles });
  }
  pass() {
    this.send({ t: "pass" });
  }
  close() {
    this.ws?.close();
    this.ws = null;
  }
}
