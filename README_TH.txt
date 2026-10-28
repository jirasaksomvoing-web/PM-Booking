THAIKALI PM BOOKING — Cloudflare Pages + Google Apps Script + Google Sheets

สิ่งที่อยู่ในชุดนี้
- public/index.html : หน้าเว็บจอง PM ที่เปิดผ่าน Cloudflare Pages (ไม่แสดง footer ของ Apps Script)
- functions/api/[[path]].js : Cloudflare Pages Function ทำหน้าที่ proxy ไป Apps Script โดยเก็บ token ฝั่ง server
- GoogleAppsScript_Code.gs : โค้ด backend ที่รวมจาก Code.gs รุ่นล่าสุด พร้อม API doPost

ข้อจำกัดสำคัญ
- ชุดนี้เป็น source package สำหรับติดตั้ง ไม่ใช่ระบบที่ deploy แล้ว และยังไม่มี URL Cloudflare จริงจนกว่าจะ deploy ด้วยบัญชีบริษัท
- ต้องใช้ Google Sheets ฐานข้อมูลเดิมที่มีชีต User และ รายการคอมพิวเตอร์_พร้อมแผน ตามโค้ดเดิม
- การใช้ลิงก์อย่างเดียวไม่สามารถยืนยันตัวตนจริงของพนักงานได้ ผู้ใช้เลือกชื่อจากชีต User ได้ตามความต้องการเดิม

ขั้นตอน A — เตรียม Apps Script backend
1. เปิด Google Sheets ฐานข้อมูล PM เดิม > Extensions > Apps Script
2. สำรอง Code.gs เดิมไว้ก่อน แล้วแทนที่ด้วยเนื้อหาไฟล์ GoogleAppsScript_Code.gs ในชุดนี้
3. ใน Apps Script เปิด Project Settings > Script Properties > Add script property
   Name: PM_API_TOKEN
   Value: สร้าง secret แบบสุ่มยาวอย่างน้อย 32 ตัวอักษร (เก็บไว้ใช้ใน Cloudflare ด้วย)
4. ตรวจสอบว่าโค้ดผูกกับ Spreadsheet ฐานข้อมูลที่ถูกต้อง และรัน setupPMSystem() หากยังไม่ได้สร้างชีตระบบ
5. Deploy > New deployment > Web app
   Execute as: Me
   Who has access: Anyone (เพราะ Cloudflare เรียก API แบบ server-to-server; การป้องกัน API ใช้ PM_API_TOKEN)
6. คัดลอก URL ที่ลงท้าย /exec เก็บไว้ ใช้เป็น GAS_URL

ขั้นตอน B — Deploy Cloudflare Pages
1. แตก ZIP แล้วอัปโหลดโฟลเดอร์โปรเจกต์เข้า GitHub repository (แนะนำ) หรือใช้วิธี Direct Upload ที่รองรับ Pages Functions
2. Cloudflare Dashboard > Workers & Pages > Create > Pages > Connect to Git
3. Framework preset: None
   Build command: เว้นว่าง
   Build output directory: public
4. หลังสร้างโปรเจกต์ ไปที่ Settings > Variables and Secrets (หรือ Environment variables)
   เพิ่ม GAS_URL = URL /exec ของ Apps Script
   เพิ่ม PM_API_TOKEN = ค่าเดียวกับ Script Property ใน Apps Script (ตั้งเป็น Secret)
5. Deploy ใหม่ แล้วเปิด URL *.pages.dev ที่ Cloudflare ให้มา

ทดสอบ
- เปิดเว็บจาก Cloudflare Pages
- ตรวจสอบว่าชื่อพนักงานโหลดจากชีต User
- เลือกชื่อ/แผนก วันที่ และช่วงเวลา แล้วจองจำนวน 1 เครื่อง
- ตรวจสอบแถวใหม่ในชีต PM_Bookings
- ทดสอบจองเกินจำนวนโควตาของแผนก เพื่อยืนยันว่าระบบปฏิเสธ

ข้อควรทราบ
- ช่วงเวลาที่รองรับตามโค้ด: 11:00–12:00, 12:00–13:00, 14:00–15:00, 16:00–17:00
- โควตาตรวจจาก getDepartmentCapacity_() ใน backend; ระบบยังตรวจซ้ำก่อนบันทึก
- Cloudflare Pages Functions ต้องเปิดใช้งานในโปรเจกต์ ไม่ใช่การอัปโหลดไฟล์ public อย่างเดียว
- อย่าใส่ PM_API_TOKEN ใน public/index.html หรือไฟล์ที่ผู้ใช้เว็บดาวน์โหลดได้
- ถ้า Apps Script deployment เก่ามี URL อยู่แล้ว ให้สร้าง deployment ใหม่หลังแก้โค้ด และนำ URL /exec ที่ถูกต้องมาใส่ใน GAS_URL
