// 이메일 발송 (Resend REST). RESEND_API_KEY 없으면 개발용으로 콘솔에 코드 출력.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// 발신 주소: Resend에 도메인을 인증하면 그 주소로. 미인증이면 onboarding@resend.dev(테스트, 본인 메일로만 발송).
const MAIL_FROM = process.env.MAIL_FROM || "RUSELL <onboarding@resend.dev>";

export function mailMode(): string {
  return RESEND_API_KEY ? "Resend" : "콘솔(개발)";
}

export async function sendVerificationCode(email: string, code: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log(`[mail] (개발) ${email} 인증코드: ${code}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [email],
      subject: "RUSELL 이메일 인증코드",
      html: `<div style="font-family:sans-serif">
        <h2 style="margin:0 0 8px">RUSELL 가입 인증</h2>
        <p>아래 6자리 코드를 앱에 입력하세요. (10분 내 유효)</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:4px">${code}</p>
      </div>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
