# 렉시오 정식 배포 가이드

노트북을 꺼도 언제든 친구들이 접속하도록, 두 조각을 각각 올립니다.

| 조각 | 정체 | 올리는 곳(무료) |
|------|------|----------------|
| **ws 서버** | Node WebSocket (`server/index.ts`) | Render (Node 웹 서비스) |
| **게임 화면** | 정적 파일 (`dist/`) | Gabia / Netlify / Cloudflare Pages |

순서 중요: **① 서버 먼저 배포 → 주소 확보 → ② 그 주소로 클라이언트 빌드 → 정적 호스팅**.

---

## 0단계. GitHub에 코드 올리기 (서버 배포에 필요)

`Games/IDox` 폴더가 저장소 루트가 되도록:

```bash
cd Games/IDox
git init
git add .
git commit -m "렉시오 초기 배포"
# GitHub에서 빈 저장소 생성 후:
git remote add origin https://github.com/<사용자>/<저장소>.git
git branch -M main
git push -u origin main
```

> `node_modules/`, `dist/` 는 `.gitignore`로 자동 제외됩니다.

---

## 1단계. ws 서버 → Render (무료)

1. https://render.com 가입(GitHub 계정으로 로그인 추천).
2. **New → Blueprint** → 방금 올린 저장소 선택 → `render.yaml` 자동 인식 → **Apply**.
   - (수동으로 하려면 **New → Web Service**: Build `npm install`, Start `npm run server`, Health Check Path `/health`.)
3. 배포 완료되면 주소가 나옵니다: 예 `https://lexio-server.onrender.com`
4. 확인: 브라우저로 `https://lexio-server.onrender.com/health` → **"Lexio server OK"** 뜨면 성공.
5. **WebSocket 주소**는 여기서 `https` → `wss` 로 바꾼 것: `wss://lexio-server.onrender.com`

> ⚠️ Render 무료 서비스는 15분 미접속 시 잠들고, 다음 접속 때 ~30초 깨어납니다(첫 접속만 느림). 게임엔 무리 없음.

---

## 2단계. 게임 화면 → 정적 호스팅

서버 주소를 **빌드에 주입**해서 정적 파일을 만듭니다:

```bash
cd Games/IDox
VITE_SERVER_URL="wss://lexio-server.onrender.com" npm run build
# 결과물: dist/  (이 폴더를 업로드)
```

호스팅 선택 (하나만):

- **Gabia 웹호스팅**: `dist/` 안의 파일들을 FTP로 업로드 (홈페이지 올리던 방식과 동일).
- **Netlify (CLI)**: `npx netlify-cli deploy --prod --dir dist` (브라우저로 로그인).
- **Cloudflare Pages (CLI)**: `npx wrangler pages deploy dist`.
- **Netlify/Vercel/CF Pages (웹 UI)**: 저장소 연결 → Build `npm run build`, Output `dist`, 환경변수 `VITE_SERVER_URL=wss://lexio-server.onrender.com`.

접속: 호스팅이 준 주소(예 `https://lexio.pages.dev`)를 친구에게 공유.
게임 안 "서버 주소" 칸은 비워둬도 빌드에 주입된 값(`wss://...onrender.com`)을 자동 사용합니다.

---

## 갱신(코드 수정 후)

- **서버 수정**: `git push` → Render가 자동 재배포.
- **클라이언트 수정**: 다시 `VITE_SERVER_URL=... npm run build` → `dist/` 재업로드 (CLI면 재실행).

## 문제 해결

- 게임은 뜨는데 온라인 접속 실패 → 서버 주소(`wss://`)·Render 서비스 살아있는지(`/health`) 확인.
- https 페이지인데 `ws://`로 접속 시도 → 브라우저가 차단(혼합 콘텐츠). 반드시 `wss://`.
- 첫 접속이 느림 → Render 무료 콜드스타트(정상). 30초 후 재시도.
