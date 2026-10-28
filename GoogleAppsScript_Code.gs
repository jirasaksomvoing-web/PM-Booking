/**
 * THAIKALI PM BOOKING SYSTEM
 * Google Apps Script Web App
 * Time zone: Asia/Bangkok
 *
 * First setup:
 * 1) Create/open the Google Sheets database.
 * 2) Open Extensions > Apps Script and add Code.gs + Index.html.
 * 3) Run setupPMSystem() once and authorize.
 * 4) Run runImportAssets() to import assets and the employee list is derived from those assets.
 * 5) Optional: fill Users sheet with authorized IT/Admin accounts to enable PM record functions.
 * 6) Deploy as Web app: Execute as Me. Link holders can book; employee names must match the imported list.
 * NOTE: link-only booking does not verify the identity of the selected employee.
 */

const CFG = {
  TZ: 'Asia/Bangkok',
  SHEETS: {
    ASSETS: 'Assets', DEPARTMENTS: 'Departments', USERS: 'Users',
    BOOKINGS: 'PM_Bookings', RECORDS: 'PM_Records', LOG: 'Audit_Log', SETTINGS: 'Settings'
  },
  ROLES: { ADMIN: 'ADMIN', IT: 'IT', HEAD: 'HEAD' },
  BOOKING_ACTIVE: ['BOOKED', 'APPROVED', 'IN_PROGRESS'],
  TIME_SLOTS: ['11:00-12:00', '12:00-13:00', '14:00-15:00', '16:00-17:00'],
  CHECKLIST: [
    'ตรวจสอบสภาพภายนอกและความสะอาด', 'ทำความสะอาดเครื่องและช่องระบายอากาศ',
    'ตรวจสอบสายไฟและสายสัญญาณ', 'ตรวจสอบจอภาพ คีย์บอร์ด และเมาส์',
    'ตรวจสอบพื้นที่จัดเก็บข้อมูลและพื้นที่ว่าง', 'ตรวจสอบ RAM และการทำงานของอุปกรณ์',
    'ตรวจสอบระบบปฏิบัติการและการอัปเดต', 'ตรวจสอบ Antivirus / Endpoint Protection',
    'ตรวจสอบการสำรองข้อมูลตามนโยบาย', 'ตรวจสอบการทำงานของโปรแกรมที่จำเป็น',
    'ทดสอบเปิดใช้งานและบันทึกปัญหาที่พบ'
  ]
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('THAIKALI | PM Booking')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Cloudflare Pages API bridge. Set Script Property PM_API_TOKEN to the same secret
 * configured in Cloudflare Pages environment variables. */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('PM_API_TOKEN');
    if (!expected || !body.token || body.token !== expected) {
      return jsonResponse_({ ok:false, error:'Unauthorized' });
    }
    let result;
    switch (String(body.action || '')) {
      case 'getAppData': result = getAppData(); break;
      case 'createBooking': result = createBooking(body.payload || {}); break;
      default: return jsonResponse_({ ok:false, error:'Unknown action' });
    }
    return jsonResponse_({ ok:true, data:result });
  } catch (err) {
    return jsonResponse_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupPMSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('กรุณาเปิด Apps Script จาก Google Sheets ฐานข้อมูลก่อน');
  const definitions = [
    [CFG.SHEETS.ASSETS, ['AssetID','AssetItem','SerialNo','AssetName','Location','Department','ResponsibleName','EmployeeID','ResponsibleEmail','SourceStatus','Active']],
    [CFG.SHEETS.DEPARTMENTS, ['Department','AssetCount','HeadEmail','Enabled','Notes']],
    [CFG.SHEETS.USERS, ['Email','FullName','Department','Role','Active']],
    [CFG.SHEETS.BOOKINGS, ['BookingID','CreatedAt','CreatedBy','CreatedByName','Department','PMDate','TimeSlot','Quantity','Status','Note','UpdatedAt','UpdatedBy']],
    [CFG.SHEETS.RECORDS, ['RecordID','BookingID','PMDate','Department','AssetItem','SerialNo','AssetName','ResponsibleName','TechnicianEmail','ChecklistJSON','OverallResult','IssueNote','ActionTaken','CompletedAt','Status']],
    [CFG.SHEETS.LOG, ['Timestamp','ActorEmail','Action','ObjectType','ObjectID','Details']],
    [CFG.SHEETS.SETTINGS, ['Key','Value']]
  ];
  definitions.forEach(([name, headers]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#166534').setFontColor('#ffffff');
  });
  const settings = ss.getSheetByName(CFG.SHEETS.SETTINGS);
  if (settings.getLastRow() < 2) settings.getRange(2,1,3,2).setValues([
    ['PM_CYCLE','2026-Q4'], ['DEFAULT_SLOT','11:00-12:00'],
    ['BOOKING_RULE','จำนวนจองต่อแผนก/วัน/ช่วงเวลา ต้องไม่เกินจำนวนทรัพย์สิน Active ในแผนก']
  ]);
  SpreadsheetApp.flush();
  return 'สร้างชีตฐานข้อมูลเรียบร้อยแล้ว กรุณาตั้งค่า Users และนำเข้ารายการ Assets';
}

/** Import asset rows from a Google Sheets copy of the existing PM workbook. */
function importAssetsFromSource(sourceSpreadsheetId) {
  if (!sourceSpreadsheetId) throw new Error('กรุณาระบุ Spreadsheet ID ของไฟล์ PM เดิมที่แปลงเป็น Google Sheets แล้ว');
  const source = SpreadsheetApp.openById(sourceSpreadsheetId);
  const target = SpreadsheetApp.getActiveSpreadsheet();
  if (!target) throw new Error('กรุณาเปิด Apps Script จาก Google Sheets ฐานข้อมูล PM');
  if (!target.getSheetByName(CFG.SHEETS.ASSETS)) setupPMSystem();
  const assetSheet = target.getSheetByName(CFG.SHEETS.ASSETS);
  const all = [];
  const seen = new Set();

  source.getSheets().forEach(sh => {
    const values = sh.getDataRange().getDisplayValues();
    if (values.length < 2) return;
    let headerRow = -1, map = {};
    for (let r = 0; r < Math.min(values.length, 12); r++) {
      const normalized = values[r].map(normalizeHeader_);
      const assetCol = findHeader_(normalized, ['asset item','assetitem','รหัสทรัพย์สิน','รหัสสินทรัพย์']);
      const nameCol = findHeader_(normalized, ['name','รายการทรัพย์สิน','asset name','ชื่อทรัพย์สิน']);
      if (assetCol >= 0 && nameCol >= 0) {
        headerRow = r;
        map = {
          asset: assetCol,
          serial: findHeader_(normalized, ['serial_no','serial no.','serial no','serialno','serial number','s/n']),
          name: nameCol,
          location: findHeader_(normalized, ['location_name','สถานที่','location']),
          responsible: findHeader_(normalized, ['ผู้รับผิดชอบคอมพิวเตอร์ (จาก logbook)','ผู้รับผิดชอบคอมพิวเตอร์','ผู้รับผิดชอบ','responsible name','employee']),
          employee: findHeader_(normalized, ['employee code','รหัสพนักงาน','employee id','employeeid']),
          dept: findHeader_(normalized, ['bu name','bu','แผนกผู้ใช้ (จาก logbook)','แผนก','department','ฝ่าย']),
          email: findHeader_(normalized, ['อีเมลผู้ใช้','email','อีเมล']),
          status: findHeader_(normalized, ['status','วิธีจับคู่/สถานะ','สถานะ','source status'])
        };
        break;
      }
    }
    if (headerRow < 0) return;
    for (let r = headerRow + 1; r < values.length; r++) {
      const row = values[r];
      const item = cell_(row, map.asset);
      const name = cell_(row, map.name);
      if (!item || !name || /^รวม/.test(item) || /^จำนวนเครื่อง/.test(item)) continue;
      const itemKey = norm_(item);
      if (seen.has(itemKey)) continue;
      seen.add(itemKey);
      const deptFromRow = cell_(row, map.dept);
      const dept = cleanDepartment_(deptFromRow) || cleanDepartment_(sh.getName());
      all.push([
        item, item, cell_(row, map.serial), name, cell_(row, map.location), dept,
        cell_(row, map.responsible), cell_(row, map.employee), cell_(row, map.email),
        cell_(row, map.status), 'TRUE'
      ]);
    }
  });
  if (!all.length) throw new Error('ไม่พบข้อมูลทรัพย์สิน กรุณาตรวจสอบว่าหัวคอลัมน์มี Asset Item และ NAME');
  const existing = assetSheet.getLastRow();
  if (existing > 1) assetSheet.getRange(2,1,existing-1,11).clearContent();
  assetSheet.getRange(2,1,all.length,11).setValues(all);
  rebuildDepartments_();
  logAction_('IMPORT_ASSETS','Assets',String(all.length),'นำเข้ารายการจากไฟล์ PM เดิม');
  return 'นำเข้าทรัพย์สินสำเร็จ ' + all.length + ' รายการ และสร้างรายชื่อแผนกแล้ว';
}

function getAppData() {
  const user = getOptionalUser_();
  const assets = readObjects_(CFG.SHEETS.ASSETS).filter(a => truthy_(a.Active));
  const bookings = readObjects_(CFG.SHEETS.BOOKINGS);
  const records = (user && ['ADMIN','IT'].includes(user.Role)) ? readObjects_(CFG.SHEETS.RECORDS) : [];
  const departments = readObjects_(CFG.SHEETS.DEPARTMENTS).filter(d => truthy_(d.Enabled));
  const employees = getEmployeeList_();
  const isIT = user && ['ADMIN','IT'].includes(user.Role);
  return {
    user: user || {Email:'',FullName:'',Department:'',Role:'GUEST'},
    checklist: CFG.CHECKLIST,
    timeSlots: CFG.TIME_SLOTS,
    assets: isIT ? assets : assets.map(a=>({AssetItem:a.AssetItem,AssetName:a.AssetName,Department:a.Department,Active:a.Active,ResponsibleName:a.ResponsibleName,EmployeeID:a.EmployeeID})),
    employees, departments, bookings,
    records,
    counts: {
      assets: assets.length,
      bookings: bookings.filter(b => CFG.BOOKING_ACTIVE.includes(String(b.Status))).length,
      completed: readObjects_(CFG.SHEETS.RECORDS).filter(r => String(r.Status) === 'COMPLETED').length
    },
    isIT: !!isIT
  };
}

/**
 * Employee display name and department come from sheet "User".
 * Employee ID is looked up from "รายการคอมพิวเตอร์_พร้อมแผน" as requested.
 */
function getEmployeeList_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('User') || ss.getSheetByName('Users');
  if (!userSheet || userSheet.getLastRow() < 2) throw new Error('ไม่พบชีต User หรือไม่มีรายชื่อพนักงาน');
  const values = userSheet.getDataRange().getDisplayValues();
  // Find the actual header row, in case the sheet has a title above the table.
  let headerRow = -1, headers = [];
  for (let i=0; i<Math.min(values.length,15); i++) {
    const h = values[i].map(normalizeHeader_);
    const n = findHeader_(h, ['fullname','full name','name','employee name','ชื่อพนักงาน','ชื่อ-นามสกุล','ชื่อ นามสกุล','พนักงาน']);
    const d = findHeader_(h, ['department','dept','แผนก','ฝ่าย','หน่วยงาน','แผนกผู้ใช้','bu name','bu']);
    if (n >= 0 && d >= 0) { headerRow=i; headers=h; break; }
  }
  if (headerRow < 0) throw new Error('ชีต User ต้องมีหัวคอลัมน์ชื่อพนักงานและแผนก');
  const nameCol = findHeader_(headers, ['fullname','full name','name','employee name','ชื่อพนักงาน','ชื่อ-นามสกุล','ชื่อ นามสกุล','พนักงาน']);
  const deptCol = findHeader_(headers, ['department','dept','แผนก','ฝ่าย','หน่วยงาน','แผนกผู้ใช้','bu name','bu']);
  const activeCol = findHeader_(headers, ['active','status','สถานะ','ใช้งาน']);
  const inventoryRows = getInventoryRows_();
  const out=[], seen=new Set();
  values.slice(headerRow+1).forEach(row => {
    const name=String(row[nameCol]||'').trim(), department=cleanDepartment_(row[deptCol]);
    if (!name || !department) return;
    if (activeCol >= 0 && String(row[activeCol]).trim() && !truthy_(row[activeCol])) return;
    // Employee ID is informational only. A missing inventory match must NOT prevent booking.
    const match=inventoryRows.find(a => norm_(a.name)===norm_(name) && norm_(a.department)===norm_(department) && a.employeeId);
    const employeeId=match ? match.employeeId : '';
    const key=norm_(name)+'|'+norm_(department);
    if (seen.has(key)) return;
    seen.add(key); out.push({name,department,employeeId,email:''});
  });
  return out.sort((a,b)=>a.name.localeCompare(b.name,'th'));
}

/**
 * Reads the computer inventory table. The DIVISION column is the source of department.
 * Each non-summary row with a DIVISION value represents a computer unless a device identifier
 * is present; duplicate identifiers within the same division are counted once.
 */
function getInventoryRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('รายการคอมพิวเตอร์_พร้อมแผน');
  if (!sh || sh.getLastRow() < 2) {
    throw new Error('ไม่พบชีต "รายการคอมพิวเตอร์_พร้อมแผน" หรือไม่มีข้อมูลอุปกรณ์');
  }

  const data = sh.getDataRange().getDisplayValues();
  let headerRow = -1, headers = [];

  // Locate the header row. Prefer the real DIVISION column, not generic "แผนก"
  // columns that may contain report labels such as "สรุปรายการคอมพิวเตอร์".
  for (let i = 0; i < Math.min(data.length, 40); i++) {
    const h = data[i].map(normalizeHeader_);
    const divExact = h.indexOf('division');
    const device = findHeader_(h, [
      'asset item', 'assetitem', 'asset no', 'asset number', 'asset tag',
      'รหัสทรัพย์สิน', 'รหัสสินทรัพย์', 'serial no', 'serialno',
      'serial number', 's/n', 'computer name', 'hostname', 'ชื่อเครื่อง',
      'อุปกรณ์', 'รายการอุปกรณ์', 'ชื่อคอมพิวเตอร์', 'ชื่อทรัพย์สิน',
      'asset name', 'name', 'รายการคอมพิวเตอร์', 'computer', 'model', 'รุ่น'
    ]);
    if (divExact >= 0 && device >= 0) {
      headerRow = i;
      headers = h;
      break;
    }
    // Fallback only if no exact DIVISION header exists.
    const fallbackDept = findHeader_(h, [
      'division name', 'div', 'department', 'dept', 'แผนก', 'ฝ่าย',
      'หน่วยงาน', 'ชื่อแผนก', 'แผนกผู้ใช้', 'bu name', 'bu'
    ]);
    if (headerRow < 0 && fallbackDept >= 0 && device >= 0) {
      headerRow = i;
      headers = h;
    }
  }
  if (headerRow < 0) {
    throw new Error('ไม่พบหัวตารางที่มีคอลัมน์ DIVISION และรหัส/ชื่ออุปกรณ์ในชีต "รายการคอมพิวเตอร์_พร้อมแผน"');
  }

  let deptCol = headers.indexOf('division');
  if (deptCol < 0) {
    deptCol = findHeader_(headers, [
      'division name', 'div', 'department', 'dept', 'แผนก', 'ฝ่าย',
      'หน่วยงาน', 'ชื่อแผนก', 'แผนกผู้ใช้', 'bu name', 'bu'
    ]);
  }
  const deviceCol = findHeader_(headers, [
    'asset item', 'assetitem', 'asset no', 'asset number', 'asset tag',
    'รหัสทรัพย์สิน', 'รหัสสินทรัพย์', 'serial no', 'serialno',
    'serial number', 's/n', 'computer name', 'hostname', 'ชื่อเครื่อง',
    'อุปกรณ์', 'รายการอุปกรณ์', 'ชื่อคอมพิวเตอร์', 'ชื่อทรัพย์สิน',
    'asset name', 'name', 'รายการคอมพิวเตอร์', 'computer', 'model', 'รุ่น'
  ]);
  const nameCol = findHeader_(headers, [
    'ผู้รับผิดชอบคอมพิวเตอร์ (จาก logbook)', 'ผู้รับผิดชอบคอมพิวเตอร์',
    'ผู้รับผิดชอบ', 'responsible name', 'employee name', 'ชื่อพนักงาน',
    'ชื่อ-นามสกุล', 'พนักงาน', 'employee'
  ]);
  const idCol = findHeader_(headers, [
    'employee code', 'รหัสพนักงาน', 'employee id', 'employeeid',
    'รหัสพนักงาน/employee id', 'รหัส'
  ]);

  const rows = [];
  for (let r = headerRow + 1; r < data.length; r++) {
    const row = data[r];
    if (row.every(v => String(v || '').trim() === '')) continue;

    const rawDepartment = String(row[deptCol] || '').trim();
    const department = cleanDepartment_(rawDepartment);
    if (!department || normalizeHeader_(rawDepartment) === 'division') continue;

    const rawDevice = deviceCol >= 0 ? String(row[deviceCol] || '').trim() : '';
    if (/^(รวม|total|subtotal|จำนวนเครื่อง|grand total)/i.test(rawDevice)) continue;
    if (/^(รวม|total|subtotal|จำนวนเครื่อง|grand total)/i.test(rawDepartment)) continue;

    // Each inventory row is one device. Use the Asset Item identifier where available;
    // otherwise use the physical row number so distinct devices are not lost.
    const device = rawDevice || ('__ROW_' + (r + 1));
    rows.push({
      department: department,
      device: device,
      name: nameCol >= 0 ? String(row[nameCol] || '').trim() : '',
      employeeId: idCol >= 0 ? String(row[idCol] || '').trim() : ''
    });
  }
  return rows;
}

function getOptionalUser_() {
  try {
    const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    if (!email) return null;
    const users = readObjects_(CFG.SHEETS.USERS);
    const user = users.find(u => String(u.Email||'').trim().toLowerCase() === email && truthy_(u.Active));
    if (!user) return null;
    user.Email = email; user.Role = String(user.Role||'').trim().toUpperCase();
    if (!['ADMIN','IT','HEAD'].includes(user.Role)) return null;
    return user;
  } catch (e) { return null; }
}


function createBooking(payload) {
  payload = payload || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const department = String(payload.department || '').trim();
    const date = String(payload.date || '').trim();
    const slot = String(payload.timeSlot || '').trim();
    const quantity = Number(payload.quantity);
    const employeeName = String(payload.employeeName || '').trim();
    const employeeId = String(payload.employeeId || '').trim();

    if (!department) throw new Error('กรุณาเลือกแผนก');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('วันที่ไม่ถูกต้อง');
    if (date < Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd')) throw new Error('ไม่สามารถจองวันที่ย้อนหลังได้');
    if (!CFG.TIME_SLOTS.includes(slot)) throw new Error('ช่วงเวลาจองไม่ถูกต้อง กรุณาเลือกช่วงเวลาที่กำหนด');
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('จำนวนเครื่องต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
    if (!employeeName) throw new Error('กรุณาเลือกชื่อพนักงานจากชีต User');

    const employees = getEmployeeList_();
    const validEmployee = employees.find(e =>
      norm_(e.name) === norm_(employeeName) && norm_(e.department) === norm_(department)
    );
    if (!validEmployee) throw new Error('ชื่อพนักงานหรือแผนกไม่ตรงกับข้อมูลในชีต User กรุณาเลือกใหม่');

    const capacity = getDepartmentCapacity_(department);
    if (capacity < 1) throw new Error('ไม่พบจำนวนคอมพิวเตอร์ของแผนก ' + department + ' ในชีต "รายการคอมพิวเตอร์_พร้อมแผน" กรุณาตรวจสอบข้อมูล');
    const bookingSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEETS.BOOKINGS);
    const all = readObjects_(CFG.SHEETS.BOOKINGS);
    const used = all.filter(b =>
      norm_(b.Department) === norm_(department) &&
      normalizeDate_(b.PMDate) === date &&
      String(b.TimeSlot) === slot &&
      CFG.BOOKING_ACTIVE.includes(String(b.Status))
    ).reduce((sum,b) => sum + Number(b.Quantity || 0), 0);
    const remaining = capacity - used;
    if (quantity > remaining) {
      throw new Error('จองไม่ได้: แผนก ' + department + ' มีจำนวนเครื่องตามแผน PM ' + capacity +
        ' เครื่อง จองช่วงนี้แล้ว ' + used + ' เครื่อง เหลือโควตา ' + Math.max(0,remaining) + ' เครื่อง');
    }

    const now = new Date();
    const id = 'PMB-' + Utilities.formatDate(now, CFG.TZ, 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random()*900+100);
    const actor = getOptionalUser_();
    const actorEmail = actor ? actor.Email : (validEmployee.email || 'LINK_BOOKING');
    const resolvedEmployeeId = String(validEmployee.employeeId || '').trim(); // ID may be blank; it never blocks booking
    bookingSheet.appendRow([id,now,resolvedEmployeeId || actorEmail,employeeName,department,date,slot,quantity,'BOOKED',String(payload.note||''),now,actorEmail]);
    logAction_('CREATE_BOOKING','PM_Bookings',id,JSON.stringify({department,date,slot,quantity,employeeName,employeeId:resolvedEmployeeId,capacity}));
    return {ok:true,message:'จองวัน PM สำเร็จ',bookingId:id,capacity,used:used+quantity,remaining:capacity-used-quantity};
  } finally {
    lock.releaseLock();
  }
}
/** Quota is based on distinct computer rows in 'รายการคอมพิวเตอร์_พร้อมแผน', grouped by DIVISION (or equivalent department column). */
function getDepartmentCapacity_(department) {
  const wanted=norm_(cleanDepartment_(department));
  if (!wanted) return 0;
  const rows=getInventoryRows_().filter(r=>norm_(cleanDepartment_(r.department))===wanted);
  // Count distinct computer identifiers within this DIVISION. Rows without an identifier
  // use their source row number, so separate computers are not collapsed into one.
  const devices=new Set(rows.map(r=>norm_(r.device)).filter(Boolean));
  return devices.size;
}

function normalizeDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd');
}


function cancelBooking(bookingId) {
  const user = getOptionalUser_();
  if (!user || !['ADMIN','IT'].includes(user.Role)) throw new Error('การยกเลิกรายการจองทำได้โดย IT/Admin เท่านั้น กรุณาติดต่อ IT');
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEETS.BOOKINGS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) throw new Error('ไม่พบรายการจอง');
  const headers = values[0], idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
  for (let i=1;i<values.length;i++) {
    if (String(values[i][idx.BookingID]) !== String(bookingId)) continue;
    if (!CFG.BOOKING_ACTIVE.includes(String(values[i][idx.Status]))) throw new Error('รายการนี้ไม่อยู่ในสถานะที่ยกเลิกได้');
    sh.getRange(i+1,idx.Status+1).setValue('CANCELLED');
    sh.getRange(i+1,idx.UpdatedAt+1).setValue(new Date());
    sh.getRange(i+1,idx.UpdatedBy+1).setValue(user.Email);
    logAction_('CANCEL_BOOKING','PM_Bookings',bookingId,'ยกเลิกการจอง');
    return {ok:true,message:'ยกเลิกรายการจองแล้ว'};
  }
  throw new Error('ไม่พบ Booking ID');
}


function savePMRecord(payload) {
  const user = getOptionalUser_();
  if (!user) throw new Error('กรุณาเข้าสู่ระบบบัญชี Google ที่ได้รับสิทธิ์ IT/Admin');
  if (![CFG.ROLES.ADMIN, CFG.ROLES.IT].includes(user.Role)) throw new Error('เฉพาะ IT หรือ ADMIN เท่านั้นที่บันทึกผล PM ได้');
  const bookingId = String(payload.bookingId||'').trim(), assetItem = String(payload.assetItem||'').trim();
  if (!bookingId || !assetItem) throw new Error('กรุณาเลือก Booking ID และ Asset Item');
  const bookings = readObjects_(CFG.SHEETS.BOOKINGS);
  const booking = bookings.find(b => String(b.BookingID) === bookingId);
  if (!booking) throw new Error('ไม่พบรายการจอง');
  const asset = readObjects_(CFG.SHEETS.ASSETS).find(a => String(a.AssetItem) === assetItem && norm_(a.Department) === norm_(booking.Department));
  if (!asset) throw new Error('ไม่พบทรัพย์สินนี้ในแผนกของรายการจอง');
  const existing = readObjects_(CFG.SHEETS.RECORDS).find(r => String(r.BookingID) === bookingId && String(r.AssetItem) === assetItem);
  const checklist = payload.checklist || {};
  const values = CFG.CHECKLIST.map(label => ({item:label,result:String(checklist[label]||'NOT_CHECKED')}));
  const allPassed = values.every(v => v.result === 'PASS' || v.result === 'NA');
  const anyFail = values.some(v => v.result === 'FAIL');
  const overall = anyFail ? 'FAIL' : (values.every(v => v.result !== 'NOT_CHECKED') ? 'PASS' : 'INCOMPLETE');
  const recordId = existing ? String(existing.RecordID) : 'PMR-' + Utilities.formatDate(new Date(),CFG.TZ,'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random()*900+100);
  const row = [recordId,bookingId,booking.PMDate,booking.Department,asset.AssetItem,asset.SerialNo,asset.AssetName,asset.ResponsibleName,user.Email,JSON.stringify(values),overall,String(payload.issueNote||''),String(payload.actionTaken||''),new Date(),'COMPLETED'];
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEETS.RECORDS);
  if (existing) {
    const allRows = sh.getDataRange().getValues(), col = allRows[0].indexOf('RecordID');
    const rowNum = allRows.findIndex((r,i)=>i>0 && String(r[col])===recordId)+1;
    sh.getRange(rowNum,1,1,row.length).setValues([row]);
  } else sh.appendRow(row);
  logAction_('SAVE_PM_RECORD','PM_Records',recordId,JSON.stringify({bookingId,assetItem,overall,allPassed}));
  return {ok:true,message:'บันทึกผล PM สำเร็จ',recordId,overall};
}

function setBookingStatus(bookingId, status) {
  const user = getCurrentUser_();
  if (![CFG.ROLES.ADMIN,CFG.ROLES.IT].includes(user.Role)) throw new Error('เฉพาะ IT หรือ ADMIN เท่านั้น');
  const allowed = ['BOOKED','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED','REJECTED'];
  if (!allowed.includes(status)) throw new Error('สถานะไม่ถูกต้อง');
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEETS.BOOKINGS), data = sh.getDataRange().getValues(), h = data[0];
  const idCol=h.indexOf('BookingID'), statusCol=h.indexOf('Status'), updCol=h.indexOf('UpdatedAt'), byCol=h.indexOf('UpdatedBy');
  for (let i=1;i<data.length;i++) if (String(data[i][idCol])===String(bookingId)) {
    sh.getRange(i+1,statusCol+1).setValue(status); sh.getRange(i+1,updCol+1).setValue(new Date()); sh.getRange(i+1,byCol+1).setValue(user.Email);
    logAction_('UPDATE_BOOKING_STATUS','PM_Bookings',bookingId,status);
    return {ok:true,message:'ปรับสถานะแล้ว'};
  }
  throw new Error('ไม่พบรายการจอง');
}

function rebuildDepartments_() {
  const ss = SpreadsheetApp.getActive(), assets = readObjects_(CFG.SHEETS.ASSETS), map = {};
  assets.forEach(a => {
    const d = String(a.Department||'').trim(); if (!d) return;
    const key = norm_(d); if (!map[key]) map[key] = {name:d,count:0};
    if (truthy_(a.Active)) map[key].count++;
  });
  const sh = ss.getSheetByName(CFG.SHEETS.DEPARTMENTS);
  const existing = sh.getLastRow()>1 ? sh.getRange(2,1,sh.getLastRow()-1,5).getValues() : [], heads = {};
  existing.forEach(r=>{ if(r[0]) heads[norm_(r[0])] = r[2] || ''; });
  if (sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,5).clearContent();
  const rows = Object.values(map).sort((a,b)=>a.name.localeCompare(b.name)).map(d=>[d.name,d.count,heads[norm_(d.name)]||'','TRUE','']);
  if (rows.length) sh.getRange(2,1,rows.length,5).setValues(rows);
}

function getCurrentUser_() {
  const user = getOptionalUser_();
  if (!user) throw new Error('ไม่พบสิทธิ์บัญชี Google นี้ในชีต Users');
  return user;
}
function isAdmin_(user) { return user && user.Role === CFG.ROLES.ADMIN; }
function readObjects_(sheetName) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh || sh.getLastRow()<2) return [];
  const data = sh.getDataRange().getValues(), headers = data.shift().map(h=>String(h).trim());
  return data.filter(row=>row.some(v=>v!=='' && v!==null)).map(row=>{
    const o={}; headers.forEach((h,i)=>o[h]=row[i] instanceof Date ? Utilities.formatDate(row[i],CFG.TZ,'yyyy-MM-dd') : row[i]); return o;
  });
}
function logAction_(action,type,id,details) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEETS.LOG);
  if (sh) sh.appendRow([new Date(),(Session.getActiveUser().getEmail()||'LINK_BOOKING'),action,type,id,details]);
}
function normalizeHeader_(s) { return String(s||'').toLowerCase().replace(/[_\-\n\r]+/g,' ').replace(/[.:]/g,'').replace(/\s+/g,' ').trim(); }
function findHeader_(headers, choices) { const wanted = choices.map(normalizeHeader_); return headers.findIndex(h=>wanted.includes(normalizeHeader_(h))); }
function cell_(row,index) { return index>=0 ? String(row[index]||'').trim() : ''; }
function norm_(v) { return String(v||'').toLowerCase().replace(/\s+/g,' ').trim(); }
function truthy_(v) { return v===true || ['true','yes','1','active','ใช่','เปิด','ใช้งาน'].includes(String(v||'').toLowerCase().trim()); }
function cleanDepartment_(v) {
  let s=String(v||'').trim(); if (!s) return '';
  s=s.replace(/^แผน\s*PM\s*แผนก\s*/i,'').trim();
  s=s.replace(/\s*\/\s*แผนก.*$/,'').trim(); s=s.replace(/\s*-\s*แผนก.*$/,'').trim();
  if (/^(จำนวนเครื่อง|รวม|index|unnamed)/i.test(s)) return '';
  return s;
}

function runImportAssets() {
  const sourceSpreadsheetId = '1C_fry0DzYg8Yca941guu2DBKJYk85lnlYB3BBWBwvV8';
  return importAssetsFromSource(sourceSpreadsheetId);
}
