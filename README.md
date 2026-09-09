# IDox

마작패로 즐기는 클라이밍 카드게임. 웹 기술(Vite + TypeScript) 기반, 모바일 세로화면 최적화, 봇 연습 + 온라인 멀티(권한 서버) 지원.

## 빠른 시작

```bash
npm install

# 1) 클라이언트 (개발 서버, 포트 5174)
npm run dev

# 2) 온라인 게임 서버 (WebSocket, 포트 3001)  — 온라인 대전 시에만 필요
npm run server           # 봇 딜레이 800ms
BOT_MS=0 npm run server  # 봇 즉시 (테스트용)
```

브라우저에서 `http://localhost:5174` 접속 → **봇과 연습**은 서버 없이 바로 가능.

## 온라인 대전

메뉴 → **친구와 온라인 대전** → 닉네임 / 방 코드 / **서버 주소** 입력 후 접속.
같은 방 코드로 들어온 사람끼리 매칭되고, 방장이 봇을 추가해 3~5인을 채운 뒤 시작합니다.

### 이 노트북을 서버로 쓰기

- **같은 집 와이파이(LAN)**: 친구 폰이 이 PC에 붙어야 합니다.
  - 서버 주소에 `ws://<이 PC의 LAN IP>:3001` 입력 (예: `ws://192.168.0.12:3001`).
  - ⚠️ **WSL2 주의**: 서버가 WSL 안에서 돌면 Windows 호스트에서 포트 포워딩이 필요합니다.
    Windows PowerShell(관리자)에서:
    ```powershell
    # <WSL_IP> = WSL에서 `hostname -I` 로 확인 (예: 172.29.118.84)
    netsh interface portproxy add v4tov4 listenport=3001 listenaddress=0.0.0.0 connectport=3001 connectaddress=<WSL_IP>
    netsh advfirewall firewall add rule name="IDox3001" dir=in action=allow protocol=TCP localport=3001
    ```
    이제 다른 기기는 `ws://<Windows PC의 LAN IP>:3001` 로 접속.

- **집 밖 친구(인터넷)**: 공유기 포트포워딩 + DDNS + TLS는 번거롭습니다. **터널**이 가장 쉽습니다.
  ```bash
  # 예: cloudflared (설치 후)
  cloudflared tunnel --url tcp://localhost:3001
  # 또는 ngrok
  ngrok tcp 3001
  ```
  발급된 주소를 서버 주소 칸에 `ws://...` (또는 https 페이지면 `wss://...`)로 입력.

> HTTPS 페이지에서 접속하면 브라우저가 `wss://`(보안 WebSocket)만 허용합니다. 터널은 대개 TLS를 붙여주므로 `wss://` 사용.

## 환경 변수 (서버)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | 3001 | WebSocket 포트 |
| `BOT_MS` | 800 | 봇 착수 간 지연(ms). 0이면 즉시 |

## 구조

```
src/engine/       순수 규칙 엔진 (클라이언트/서버 공유, DOM/네트워크 무의존)
  types, tiles    타입 · 숫자/타일 강함 순위 · 인원별 덱
  combos          조합 평가/비교 (싱글~스트레이트플러시)
  game            딜/턴/패스/라운드종료/점수 (제로섬 · 2 페널티)
  moves           합법수 열거 + 봇 AI
  rng             시드 셔플(재현·테스트용)
src/main.ts       DOM UI 컨트롤러 (로컬/온라인 공용 보드 렌더)
src/net.ts        WebSocket 클라이언트
server/index.ts   권한 서버 (ws) — 각 클라에 본인 손패만 전송(치팅 방지)
tests/            엔진 단위 테스트 (vitest)
```

## 규칙 요약

- 타일 1~15 × 4무늬(구름☁ < 별★ < 달☾ < 해☀). 인원별: 3인 1~9/12장, 4인 1~13/13장, 5인 1~15/12장.
- 숫자 강함: 3 < 4 < … < 15 < 1 < 2. 선 = 구름3 보유자.
- 조합: 싱글 / 페어 / 트리플 / 5장(스트레이트 < 플러시 < 풀하우스 < 포카드 < 스트레이트 플러시).
  스트레이트는 1-2-3-4-5 ~ 12-13-14-15-1.
- 앞 조합과 같은 장수로 더 강하게 받아치거나 패스. 손패를 먼저 비우면 라운드 종료.
- 점수(제로섬): `내 점수 = 전체 남은타일합 − 인원수 × 내 남은타일`. 손패에 2 타일이 있으면 남은 타일 수를 2배로 계산.

## 향후

- Capacitor 로 안드로이드 APK 포장 가능(웹 자산 그대로 래핑).
- 방 재접속/관전, 연속 라운드 누적 점수, 봇 난이도 개선 등.
```
