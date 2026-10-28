THAIKALI PM BOOKING — Cloudflare Pages + Wrangler + Google Apps Script
เวอร์ชัน: จองผ่าน Link ได้เลย ไม่ต้องผ่านการอนุมัติ

ไฟล์ในชุด
- public/index.html                  หน้าเว็บจอง PM
- functions/api/[[path]].js          API proxy จาก Cloudflare ไป Google Apps Script
- wrangler.toml                      ค่าตั้งต้น Wrangler สำหรับ Cloudflare Pages
- GoogleAppsScript_Code.gs           Backend สำหรับอ่านชีตและบันทึกการจอง

สำคัญ
- ชุดนี้เป็น Cloudflare Pages project ที่ deploy ด้วย Wrangler CLI (ไม่ใช่ไฟล์ .gs อย่างเดียว)
- Backend ใช้ชีต "รายการคอมพิวเตอร์_พร้อมแผน" และชีต "User" หรือ "Users" ตามหัวตารางที่โค้ดรองรับ
- การจองไม่ต้องอนุมัติ โดยบันทึกสถานะ BOOKED
- ชื่อที่เลือกจากชีตเป็นการระบุชื่อที่ผู้จองเลือก ไม่ได้ยืนยันตัวตนจริงของบุคคล
- ต้องตั้งค่า Google Apps Script และ Cloudflare Secrets ก่อนใช้งานจริง

A) ติดตั้ง Google Apps Script backend
1. เปิด Google Sheets ฐานข้อมูล PM ที่ต้องการใช้
2. Extensions > Apps Script
3. สำรองโค้ดเดิมก่อน จากนั้นนำเนื้อหาไฟล์ GoogleAppsScript_Code.gs ในชุดนี้ไปใส่ใน Code.gs ของโปรเจกต์ backend นี้
4. Save แล้วรัน setupPMSystem() หนึ่งครั้งเพื่ออนุญาตสิทธิ์ (หากมีข้อมูลชีตเดิม ให้สำรองก่อน อย่ารัน setup โดยไม่ตรวจสอบข้อมูลเดิม)
5. Apps Script > Project Settings > Script Properties เพิ่ม:
   Name: PM_API_TOKEN
   Value: สร้าง secret แบบสุ่มยาวอย่างน้อย 32 ตัวอักษร
6. Deploy > New deployment > Web app
   Execute as: Me
   Who has access: Anyone
7. คัดลอก URL ที่ลงท้าย /exec ไว้เป็น GAS_URL

B) เตรียม Wrangler บน Windows
1. ติดตั้ง Node.js รุ่น LTS จากเว็บไซต์ทางการของ Node.js
2. เปิด Command Prompt หรือ PowerShell ในโฟลเดอร์ที่แตก ZIP นี้
3. ตรวจสอบคำสั่ง: node -v และ npx wrangler --version
4. เข้าสู่ระบบ Cloudflare: npx wrangler login
5. สร้าง Pages project ครั้งแรก (ทำครั้งเดียว):
   npx wrangler pages project create thaikali-pm-booking
   หากมี project ชื่อนี้อยู่แล้ว ให้ข้ามขั้นตอนนี้

C) ตั้งค่า Secrets
ให้รันจากโฟลเดอร์โปรเจกต์นี้:
   npx wrangler pages secret put GAS_URL --project-name thaikali-pm-booking
จากนั้นวาง URL /exec ของ Apps Script แล้วกด Enter

   npx wrangler pages secret put PM_API_TOKEN --project-name thaikali-pm-booking
จากนั้นวางค่า token เดียวกับ Script Property ใน Apps Script แล้วกด Enter

อย่าใส่ token ลงใน public/index.html หรือ commit ลง Git

D) Deploy ขึ้น Cloudflare Pages ด้วย Wrangler
รันจากโฟลเดอร์โปรเจกต์นี้ (โฟลเดอร์ที่มี wrangler.toml และ functions/):
   npx wrangler pages deploy public --project-name thaikali-pm-booking

หลัง deploy สำเร็จ Wrangler จะแสดง URL ของเว็บไซต์ เช่น https://thaikali-pm-booking.pages.dev
เปิด URL นั้นเพื่อทดลองจอง

E) ตรวจสอบผล
1. เปิดหน้าเว็บ Cloudflare แล้วรอรายชื่อพนักงานโหลด
2. เลือกชื่อพนักงาน แผนก วันที่ ช่วงเวลา และจำนวนเครื่อง
3. กดจอง ระบบต้องแสดงเลขที่การจองและสถานะสำเร็จ
4. เปิดชีต PM_Bookings ตรวจสอบแถวใหม่ สถานะควรเป็น BOOKED
5. หาก API มีปัญหา ให้ตรวจ Apps Script Executions และตรวจว่า GAS_URL/PM_API_TOKEN ถูกต้องทั้งสองฝั่ง

หมายเหตุเรื่องข้อมูล
- ชีต User/Users ต้องมีหัวตารางชื่อพนักงานและแผนก
- ชีต "รายการคอมพิวเตอร์_พร้อมแผน" ต้องมีหัวตารางที่ระบุ DIVISION (หรือชื่อแผนกที่โค้ดรองรับ) และคอลัมน์รหัส/ชื่ออุปกรณ์
- หากชื่อแผนกใน User ไม่ตรงกับข้อมูลในแผน ระบบอาจไม่สามารถตรวจโควตาได้ ต้องปรับชื่อให้ตรงกัน
- ทดสอบด้วยการจอง 1 รายการก่อนเปิดให้ผู้ใช้ทั้งหมด
