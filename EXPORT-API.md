# Checkin App — Export API

## API ใหม
`GET /api/attendance?all=1&from=YYYY-MM-DD&to=YYYY-MM-DD`
- ดึงข้อมูลทังชวงวันที่
- สดกลบเป็น JSON array: `{"records": [...]}`
- รองรรับ API เกา `GET /api/attendance?date=YYYY-MM-DD` ดว้ย

## Export Flow บน UI
1. กด "Export" บนหน้า Home
2. เลือกวันที่เรมและสงสุด
3. กด "โหลดข้อมูล"
4. สราง HTML table file → ดาวโหลด

## HTML Export
- สรุกรายงาน (ชวงวันที่, จำนวน, รวมชวงโมง, เฉลีย)
- ตาราง: ชือ, วันทีก, IN, OUT, ชวงโมง, สถานะ
