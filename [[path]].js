export async function onRequestPost({ request, env }) {
  if (!env.GAS_URL || !env.PM_API_TOKEN) {
    return Response.json({ ok:false, error:'ระบบยังตั้งค่าไม่ครบ: ต้องกำหนด GAS_URL และ PM_API_TOKEN ใน Cloudflare Pages' }, { status:503 });
  }

  let incoming;
  try {
    incoming = await request.json();
  } catch (_) {
    return Response.json({ ok:false, error:'ข้อมูลที่ส่งมายัง API ไม่ใช่ JSON ที่ถูกต้อง' }, { status:400 });
  }

  let upstream;
  let bodyText;
  try {
    upstream = await fetch(env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: incoming.action, payload: incoming.payload || {}, token: env.PM_API_TOKEN }),
      redirect: 'follow'
    });
    bodyText = await upstream.text();
  } catch (_) {
    return Response.json({ ok:false, error:'Cloudflare ติดต่อ Google Apps Script ไม่สำเร็จ กรุณาตรวจสอบ GAS_URL' }, { status:502 });
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (_) {
    const contentType = upstream.headers.get('content-type') || 'ไม่ระบุ';
    let hint = 'ตรวจสอบว่า GAS_URL เป็น Web App URL ที่ลงท้ายด้วย /exec และ Deploy ให้ Execute as: Me, Who has access: Anyone';
    if (upstream.status === 401 || upstream.status === 403) hint = 'Google Apps Script ปฏิเสธการเข้าถึง ให้ตรวจสอบสิทธิ์การ Deploy Web App และตั้งค่า GAS_URL';
    return Response.json({
      ok:false,
      error:'Google Apps Script ส่ง HTML กลับมาแทน JSON',
      upstreamStatus:upstream.status,
      upstreamContentType:contentType,
      hint
    }, { status:502 });
  }

  return Response.json(data, { status:upstream.status, headers:{ 'Cache-Control':'no-store' } });
}
