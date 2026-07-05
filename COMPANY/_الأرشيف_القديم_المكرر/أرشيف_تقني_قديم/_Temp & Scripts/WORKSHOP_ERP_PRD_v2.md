# Workshop ERP — Full PRD v2
## نظام إدارة الورشة الشامل — وثيقة المتطلبات الكاملة

---

## 1. نظرة عامة (Overview)

**المشروع:** نظام ERP شامل للورشة الهندسية
**المالك:** سيف — المدير العام
**الهدف:** تحويل جميع بيانات الورشة (دوام، مالية، جرد، مشاريع، قوانين) إلى نظام ويب متكامل ذكي
**اللغة:** عربي فقط (RTL)
**المستخدمون:** 32 موظف + إدارة (4 مستويات صلاحيات)
**مصادر البيانات:** ملفات Excel + بصمة إلكترونية + ClickUp API + إدخال يدوي

---

## 2. التقنيات (Tech Stack)

```
Framework:       Next.js 14 (App Router) + TypeScript
UI:              React + Tailwind CSS + shadcn/ui
Database:        PostgreSQL (Supabase)
ORM:             Prisma
Auth:            NextAuth.js (Credentials Provider)
File Parsing:    SheetJS (xlsx)
Charts:          Recharts
PDF Export:      jsPDF + html2canvas
AI Integration:  Claude API (Anthropic) — لتحليل الصور وجرد المواد
Task Management: ClickUp API integration
QR/Barcode:      qrcode + react-barcode
Deployment:      Vercel أو VPS
Direction:       RTL (Arabic)
```

---

## 3. نظام الصلاحيات (4 Roles)

| الدور | الكود | يرى | يعدّل | لا يقدر |
|---|---|---|---|---|
| مدير عام (سيف) | `ADMIN` | كل شيء | كل شيء | — |
| مدير تنفيذي (يوسف) | `MANAGER` | كل شيء | موظفين، مشاريع، جرد | حذف، إعدادات نظام |
| محاسب (حيدر مضر) | `ACCOUNTANT` | مالية + رواتب + سلف | مالية، رواتب، سلف | موظفين، مشاريع |
| موظف | `EMPLOYEE` | بياناته الشخصية فقط | لا شيء | كل شيء آخر |

---

## 4. هيكل قاعدة البيانات (Database Schema)

### 4.1 الموظفون (employees)
```prisma
model Employee {
  id             String   @id @default(cuid())
  code           Int      @unique              // 1, 2, 3... من سجل الموظفين
  fullName       String                         // اسم الموظف
  nameEn         String?                        // الاسم بالإنجليزي
  roleAr         String                         // الدور بالعربي (محاسب، مساعد، تنفيذ...)
  roleEn         String                         // Role (Accountant, Assistant, Production...)
  monthlySalary  Float                          // الراتب الشهري الاسمي
  hourlyRate     Float?                         // سعر الساعة (محسوب أو مُدخل)
  joinDate       DateTime?
  phone          String?
  status         EmployeeStatus @default(ACTIVE) // نشط، غير نشط، مُنهى
  userRole       UserRole @default(EMPLOYEE)
  notes          String?

  attendances    Attendance[]
  penalties      Penalty[]
  bonuses        Bonus[]
  salaryRecords  SalaryRecord[]
  advances       Advance[]

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

// بيانات الـ 32 موظف الحاليين (من سجل الموظفين):
// #1  Accountant (حيدر مضر)  — محاسب      — 350,000 IQD
// #2  ابراهيم              — مساعد       — 300,000 IQD
// #3  احمد امين            — تنفيذ       — 750,000 IQD
// #4  انوار كريم           — مساعد       — 300,000 IQD
// #5  بؤوري               — مساعد       — 350,000 IQD
// #6  حسين سالم            — تنفيذ       — 850,000 IQD
// #7  حسين سعد             — مساعد       — 350,000 IQD
// #8  حيدر مضر             — محاسب       — 650,000 IQD
// #9  حيدر يافوز           — تنفيذ       — 550,000 IQD
// #10 خضر عبد الخالق       — تنفيذ       — 500,000 IQD
// #11 زكي صادق             — مساعد       — 400,000 IQD
// #12 سجاد الحداد          — حداد        — 750,000 IQD
// #13 سجاد رعد             — تنفيذ       — 600,000 IQD
// #14 سراج نزار            — تنفيذ       — 600,000 IQD
// #15 سيف الدين علي        — تنفيذ       — 950,000 IQD
// #16 عباس احمد            — مساعد       — 300,000 IQD
// #17 عبدالرضا عقيل        — ساينج وتسويق — 650,000 IQD
// #18 عبدالله الاسمر       — تنفيذ       — 750,000 IQD
// #19 عبدالله الصباغ       — صباغ        — 500,000 IQD
// #20 عبدالله عامر         — تنفيذ       — 750,000 IQD
// #21 عبدالله هاشم         — تنفيذ       — 750,000 IQD
// #22 علي الباكستاني       — تنفيذ       — 350,000 IQD
// #23 علي المظفر           — مصمم        — 400,000 IQD
// #24 علي رجاء             — تنفيذ       — 750,000 IQD
// #25 علي عدنان            — تنفيذ       — 750,000 IQD
// #26 محمد حسن             — مساعد       — 300,000 IQD
// #27 محمد فؤاد سالم       — تنفيذ       — 750,000 IQD
// #28 مصطفى حسين           — تنفيذ       — 750,000 IQD
// #29 مصطفى عبد الخالق     — تنفيذ       — 750,000 IQD
// #30 مصطفى عدي            — تنفيذ       — 400,000 IQD
// #31 يوسف احمد            — مدير تنفيذي  — 750,000 IQD
// #32 يوسف يعقوب           — تنفيذ       — 700,000 IQD
// إجمالي الرواتب الشهرية: 18,600,000 IQD
```

### 4.2 الحضور (attendances)
```prisma
model Attendance {
  id             String   @id @default(cuid())
  employeeId     String
  employee       Employee @relation(fields: [employeeId], references: [id])

  date           DateTime
  dayName        String?             // السبت، الأحد... الجمعة
  checkIn        DateTime?
  checkOut       DateTime?
  totalHours     Float?
  regularHours   Float?              // الساعات العادية (حد أقصى 9)
  overtimeHours  Float?              // الساعات الإضافية (ما فوق 9)

  dayType        DayType @default(REGULAR)
  dailyPay       Float?              // الأجر اليومي المحسوب
  nominalSalary  Float?              // الراتب الاسمي (مرجع)
  hourlyRateUsed Float?              // سعر الساعة المستخدم

  advanceAmount  Float?  @default(0) // سلفة مأخوذة في هذا اليوم
  bonusAmount    Float?  @default(0) // مكافأة في هذا اليوم

  status         AttendanceStatus @default(VALID)
  source         DataSource @default(FINGERPRINT)
  period         String?             // مثل "Jul-Aug 2025", "Sep-Dec 2025", "Jan-Feb 2026"
  notes          String?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([employeeId, date, checkIn])
}

enum DayType { REGULAR  FRIDAY  HOLIDAY }
enum AttendanceStatus { VALID  MISSING_CHECKOUT  MANUAL_ENTRY  DISPUTED }
enum DataSource { FINGERPRINT  MANUAL  EXCEL_IMPORT  CLICKUP }
```

### 4.3 السلف والقروض (advances)
```prisma
model Advance {
  id          String   @id @default(cuid())
  employeeId  String
  employee    Employee @relation(fields: [employeeId], references: [id])

  type        AdvanceType          // سلفة، قرض، خصم مسبق
  amount      Float                // المبلغ
  date        DateTime
  repaidAmount Float  @default(0)  // المبلغ المُسدَّد
  remaining   Float                // المتبقي
  status      AdvanceStatus @default(PENDING)
  notes       String?

  createdAt   DateTime @default(now())
}

enum AdvanceType { SALARY_ADVANCE  LOAN  DEDUCTION }
enum AdvanceStatus { PENDING  PARTIAL  PAID  CANCELLED }
```

### 4.4 الواردات اليومية (daily_income)
```prisma
model DailyIncome {
  id          String   @id @default(cuid())
  itemName    String               // البند (بورد، مبخرة، بوكس فلوس...)
  date        DateTime
  amount      Float                // القيمة بالدينار
  clientName  String?              // اسم الزبون
  agentName   String?              // المندوب (حسين، الورشة...)
  status      PaymentStatus        // مستلم، جزئي، دين
  profit      Float?               // الربح
  notes       String?

  clientId    String?
  client      Client? @relation(fields: [clientId], references: [id])
  projectId   String?
  project     Project? @relation(fields: [projectId], references: [id])

  createdAt   DateTime @default(now())
}

enum PaymentStatus { RECEIVED  PARTIAL  DEBT }
```

### 4.5 المصروفات اليومية (daily_expenses)
```prisma
model DailyExpense {
  id          String   @id @default(cuid())
  itemName    String               // البند (صحيات، كهربائيات، شراء اقمشة...)
  date        DateTime
  amount      Float                // المبلغ
  department  String?              // الجهة (المكتب، الورشة)
  category    String?              // التصنيف (تكاليف تطوير، استهلاكيات، مواد خام...)
  notes       String?

  projectId   String?              // ربط بمشروع (اختياري)
  project     Project? @relation(fields: [projectId], references: [id])

  createdAt   DateTime @default(now())
}
```

### 4.6 العملاء (clients)
```prisma
model Client {
  id          String   @id @default(cuid())
  name        String
  type        String   @default("زبون / Client")
  phone       String?
  address     String?
  lastProject String?
  totalPaid   Float    @default(0)
  status      String   @default("نشط / Active")
  notes       String?

  incomes     DailyIncome[]
  projects    Project[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### 4.7 المشاريع (projects)
```prisma
model Project {
  id              String   @id @default(cuid())
  name            String
  clientId        String?
  client          Client? @relation(fields: [clientId], references: [id])
  startDate       DateTime?
  deliveryDate    DateTime?
  value           Float?             // القيمة الإجمالية
  collected       Float?  @default(0) // المُحصَّل
  remaining       Float?             // المتبقي
  stage           ProjectStage @default(IN_PROGRESS)
  owner           String?            // المسؤول
  priority        ProjectPriority @default(HIGH)
  notes           String?
  businessLine    BusinessLine?      // خط العمل

  // ربط بالمواد المستخدمة
  materialUsages  ProjectMaterial[]
  expenses        DailyExpense[]
  incomes         DailyIncome[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum ProjectStage { INTAKE  DESIGN  COSTING  PRODUCTION  QC  DELIVERY  COMPLETED  ON_HOLD  CANCELLED }
enum ProjectPriority { HIGH  MEDIUM  LOW }
enum BusinessLine { PRINTING  SIGNAGE  PRODUCTS  ARCHITECTURE  COMMUNITY }
```

### 4.8 المخزون والجرد (inventory) — نظام متقدم مع QR
```prisma
// الأصناف الثابتة (معدات، أثاث، أجهزة)
model InventoryAsset {
  id          String   @id @default(cuid())
  name        String               // الصنف
  room        String               // الغرفة (الادارة، الورشة الداخلية...)
  roomEn      String?              // Room name in English
  quantity    Int                  // العدد
  condition   String  @default("سليم")  // سليم، يحتاج صيانة، تالف
  lastCheck   DateTime?
  notes       String?
  qrCode      String?  @unique     // رمز QR فريد

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// المواد الخام (أكريلك، فوم، خشب، فينيل...)
model RawMaterial {
  id            String   @id @default(cuid())
  name          String                 // اسم المادة
  materialType  String                 // نوع المادة (أكريلك، فوم، MDF، فينيل...)
  thickness     Float?                 // السمك (مم)
  width         Float?                 // العرض (سم)
  height        Float?                 // الطول (سم)
  color         String?                // اللون
  unit          String                 // وحدة القياس (قطعة، متر، متر مربع، كغ)
  quantity      Float                  // الكمية المتاحة
  minQuantity   Float    @default(0)   // الحد الأدنى (تنبيه)
  unitCost      Float?                 // سعر الوحدة
  supplier      String?                // المورد
  location      String?                // مكان التخزين
  qrCode        String?  @unique       // رمز QR يحتوي كل المعلومات
  barcode       String?  @unique       // باركود

  // تتبع الاستخدام
  usages        ProjectMaterial[]
  movements     MaterialMovement[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// استخدام المواد في المشاريع (الربط الحيوي!)
model ProjectMaterial {
  id              String   @id @default(cuid())
  projectId       String
  project         Project @relation(fields: [projectId], references: [id])
  materialId      String
  material        RawMaterial @relation(fields: [materialId], references: [id])

  quantityNeeded  Float          // الكمية المطلوبة للمشروع
  quantityUsed    Float          // الكمية المستخدمة فعلياً
  surplus         Float          // الفائض = المشتراة - المستخدمة فعلياً
  surplusStatus   SurplusStatus @default(AVAILABLE)
  surplusNote     String?        // ملاحظة عن الفائض (قياسات، حالة)

  createdAt       DateTime @default(now())
}

enum SurplusStatus {
  AVAILABLE        // متاح للاستخدام في مشروع آخر
  RESERVED         // محجوز لمشروع قادم
  USED             // تم استخدامه
  WASTE            // تالف/غير قابل للاستخدام
}

// حركة المواد (دخول/خروج)
model MaterialMovement {
  id          String   @id @default(cuid())
  materialId  String
  material    RawMaterial @relation(fields: [materialId], references: [id])
  type        MovementType
  quantity    Float
  reason      String?
  projectId   String?
  movedBy     String
  date        DateTime @default(now())

  createdAt   DateTime @default(now())
}

enum MovementType { IN  OUT  RETURN  TRANSFER  ADJUSTMENT }
```

### 4.9 الصيانة (maintenance)
```prisma
model MaintenanceLog {
  id            String   @id @default(cuid())
  machineName   String             // اسم المعدة
  location      String?
  type          String             // دورية، طارئة، وقائية
  scheduledDate DateTime?
  actualDate    DateTime?
  performedBy   String?
  cost          Float    @default(0)
  status        String   @default("مجدول / Scheduled")
  notes         String?

  createdAt     DateTime @default(now())
}
```

### 4.10 الأنظمة والقوانين — نظام PENTAGON
```prisma
model Regulation {
  id          String   @id @default(cuid())
  section     String             // القسم (الحضور، المال، الجودة، السلوك، التطوير، الإنتاج)
  ruleName    String             // اسم البند
  details     String             // التفاصيل
  penalty     String?            // العقوبة
  reference   String?            // المرجع (النظام §1, §2...)
  isActive    Boolean @default(true)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// القوانين الحالية (13 بند من نظام PENTAGON):
// الحضور §1: الدوام من 8:00 صباحاً — تأخير = خصم بسعر الساعة
// الحضور §2: غياب بدون إذن = خصم يومي كامل — 3 مخالفات = إنذار رسمي
// المال §5: صرف المواد بإذن المدير أو توقيع المحاسب فقط
// المال §6: التسعير حق حصري للإدارة
// الجودة §8: كل مشروع يمر بـ QC قبل التسليم
// الجودة §9: لا تعديلات مجانية بعد موافقة العميل
// السلوك §12: معلومات الزبائن سرية — مشاركتها = إنهاء عقد
// السلوك §3: كل موظف يعمل ضمن صلاحياته فقط
// التطوير §15: حضور التدريب الداخلي إلزامي
// التطوير §16: مراجعة KPIs شهرية — تؤثر على المكافأة
// الإنتاج §7: Workflow إلزامي: Intake → Design → Costing → Production → QC → Delivery
// الإنتاج §10: الإدارة تحدد أولوية المشاريع
```

### 4.11 الربح والخسارة الشهري
```prisma
model MonthlyPnL {
  id           String @id @default(cuid())
  month        String             // "2025-01", "2025-02"...
  revenue      Float              // الواردات
  expenses     Float              // المصروفات
  net          Float              // الصافي
  marginPct    Float?             // نسبة الربح %
  invoiceCount Int?               // عدد الفواتير
  expenseCount Int?               // عدد المصروفات
  notes        String?

  createdAt    DateTime @default(now())
}

// بيانات 2025 الفعلية:
// يناير:   واردات 22,559,500 | مصروفات 8,949,500  | صافي +13,610,000 (60.3%)
// فبراير:  واردات 32,188,000 | مصروفات 18,584,250 | صافي +13,603,750 (42.3%)
// مارس:    واردات 56,179,000 | مصروفات 47,032,500 | صافي +9,146,500  (16.3%)
// أبريل:   واردات 26,481,000 | مصروفات 38,124,750 | صافي -11,643,750 (-44%)
// مايو:    واردات 49,706,000 | مصروفات 41,458,500 | صافي +8,247,500  (16.6%)
// إجمالي 2025: واردات 205,879,500 | مصروفات 194,082,500 | صافي 11,797,000
```

### 4.12 الأهداف الاستراتيجية
```prisma
model StrategicGoal {
  id           String @id @default(cuid())
  category     String             // الفئة
  title        String
  description  String?
  target       String?
  status       String @default("نشط / Active")
  deadline     DateTime?
  notes        String?

  createdAt    DateTime @default(now())
}

// خطوط العمل الخمسة:
// 1. الطباعة (Printing) — طباعة عريضة، UV، ملصقات، فينيل
// 2. الساينج (Signage) — لوحات مضيئة، حروف بارزة، واجهات
// 3. المنتجات (Products) — هدايا، ليزر، مناسبات، B2C
// 4. التصاميم المعمارية (Architecture) — واجهات، ديكور
// 5. المجتمعية (Community) — خدمات مجتمعية
```

---

## 5. قواعد الحسابات (Business Logic)

### 5.1 حساب الدوام والرواتب
```javascript
const WORK_START = "08:00";          // بداية الدوام
const REGULAR_HOURS = 9;             // ساعات الدوام اليومية
const OVERTIME_MULTIPLIER = 1.5;     // مضاعف الإضافي
const FRIDAY_MULTIPLIER = 2.0;       // مضاعف الجمعة
const WORK_DAYS = ["SAT", "SUN", "MON", "TUE", "WED", "THU"]; // السبت-الخميس
const DAY_OFF = "FRI";              // الجمعة عطلة

// حساب سعر الساعة من الراتب الشهري
function calcHourlyRate(monthlySalary) {
  // 30 يوم - 4 جمع = 26 يوم عمل × 9 ساعات = 234 ساعة
  return monthlySalary / (26 * 9);
}

// حساب الأجر اليومي
function calcDailyPay(hours, hourlyRate, dayType) {
  if (dayType === "FRIDAY") return hours * hourlyRate * FRIDAY_MULTIPLIER;
  if (dayType === "HOLIDAY") return hours * hourlyRate * FRIDAY_MULTIPLIER;
  if (hours <= REGULAR_HOURS) return hours * hourlyRate;
  const regular = REGULAR_HOURS * hourlyRate;
  const overtime = (hours - REGULAR_HOURS) * hourlyRate * OVERTIME_MULTIPLIER;
  return regular + overtime;
}

// حساب التأخير (من نظام PENTAGON §1)
function calcLateDeduction(checkInTime, hourlyRate) {
  const start = parseTime("08:00");
  const actual = parseTime(checkInTime);
  const lateMinutes = (actual - start) / 60000;
  if (lateMinutes <= 0) return 0;
  const lateHours = lateMinutes / 60;
  return lateHours * hourlyRate; // خصم بسعر الساعة
}

// حساب الراتب الشهري الصافي
function calcMonthlyNet(employee, month) {
  const earned = employee.attendances
    .filter(a => a.month === month)
    .reduce((sum, a) => sum + a.dailyPay, 0);
  const bonuses = employee.bonuses
    .filter(b => b.month === month)
    .reduce((sum, b) => sum + b.amount, 0);
  const penalties = employee.penalties
    .filter(p => p.month === month)
    .reduce((sum, p) => sum + p.amount, 0);
  const advances = employee.advances
    .filter(a => a.month === month)
    .reduce((sum, a) => sum + a.amount, 0);
  return earned + bonuses - penalties - advances;
}
```

### 5.2 نظام تتبع فائض المواد (Surplus Tracking)
```javascript
// السيناريو: مشروع يحتاج 5.5 قطعة أكريلك → نشتري 6 → فائض 0.5 قطعة
// هذا الفائض يُسجَّل بكل تفاصيله ويظهر عند شراء مواد لمشروع جديد

function trackMaterialSurplus(project, material, purchased, actualUsed) {
  const surplus = purchased - actualUsed;
  return {
    materialId: material.id,
    projectId: project.id,
    purchased: purchased,
    used: actualUsed,
    surplus: surplus,
    surplusDetails: {
      name: material.name,
      type: material.materialType,
      thickness: material.thickness,
      dimensions: `${material.width}×${material.height} سم`,
      color: material.color,
      qrCode: generateQR({
        id: material.id,
        name: material.name,
        type: material.materialType,
        surplus: surplus,
        dimensions: `${material.width}×${material.height}`,
        thickness: material.thickness
      })
    },
    status: surplus > 0 ? "AVAILABLE" : "USED"
  };
}

// عند بدء مشروع جديد — عرض المواد المتاحة من فوائض سابقة
function getAvailableSurplus(materialType, minDimensions) {
  return db.projectMaterial.findMany({
    where: {
      surplusStatus: "AVAILABLE",
      surplus: { gt: 0 },
      material: {
        materialType: materialType,
        width: { gte: minDimensions.width },
        height: { gte: minDimensions.height }
      }
    },
    include: { material: true, project: true }
  });
}
```

---

## 6. ميزات AI المتقدمة

### 6.1 تحليل صور الجرد (Image-based Inventory)
```javascript
// رفع صورة للمخزن → AI يتعرف على المواد ويقارنها بالسجل
async function analyzeInventoryImage(imageBase64) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: imageBase64 }
          },
          {
            type: "text",
            text: `حلل هذه الصورة وحدد المواد الموجودة فيها.
            لكل مادة أذكر: الاسم، النوع، الكمية التقريبية، الحالة.
            أرجع النتيجة كـ JSON فقط بدون أي نص إضافي.
            الصيغة: [{"name":"","type":"","quantity":0,"condition":""}]`
          }
        ]
      }]
    })
  });
  return response.json();
}
```

### 6.2 تحليل ملفات Excel التلقائي
```javascript
// رفع أي ملف إكسل → AI يحلله ويضع البيانات في المكان الصحيح
async function autoRouteExcelData(fileContent) {
  // 1. قراءة الملف وتحديد نوعه
  // 2. إرسال البيانات لـ Claude لتصنيفها
  // 3. توجيه كل قسم للجدول المناسب تلقائياً
  // (حضور → جدول الحضور، مصروفات → جدول المصروفات، إلخ)
}
```

### 6.3 ClickUp Integration
```javascript
// سحب التاسكات من ClickUp وعرضها في الداشبورد
// ClickUp MCP Server متصل بالنظام

async function syncClickUpTasks() {
  // استخدام ClickUp API لسحب:
  // - المهام اليومية لكل موظف
  // - حالة المشاريع
  // - الوقت المسجل على كل مهمة
  // وربطها بنظام الحضور والمشاريع
}
```

---

## 7. هيكل الصفحات (Route Structure)

```
/                                → لوحة التحكم الرئيسية (KPIs + charts)
/login                           → تسجيل الدخول

## الحضور والدوام
/attendance                      → ملخص الحضور الشهري
/attendance/upload               → رفع ملف إكسل (معالجة تلقائية بـ AI)
/attendance/daily                → عرض يومي مفصّل
/attendance/monthly/[month]      → عرض شهري

## الموظفون
/employees                       → قائمة الـ 32 موظف
/employees/[id]                  → بروفايل شامل (حضور + راتب + سلف + عقوبات + مكافآت)
/employees/[id]/attendance       → سجل الحضور التفصيلي
/employees/[id]/salary           → سجل الرواتب
/employees/[id]/advances         → السلف والقروض

## المالية
/finance                         → لوحة مالية (P&L + charts)
/finance/income                  → الواردات اليومية (894+ سجل)
/finance/expenses                → المصروفات اليومية (1209+ سجل)
/finance/payroll                 → كشف الرواتب الشهري
/finance/pnl                     → الربح والخسارة الشهري
/finance/advances                → السلف والقروض

## المشاريع
/projects                        → قائمة المشاريع (5 خطوط عمل)
/projects/[id]                   → تفاصيل المشروع + المواد المستخدمة + التكاليف

## الجرد والمخزون
/inventory                       → لوحة الجرد الرئيسية
/inventory/assets                → الأصول الثابتة (198 صنف، 8 غرف)
/inventory/materials             → المواد الخام (أكريلك، فوم، خشب...)
/inventory/materials/[id]        → تفاصيل المادة + QR + حركة الاستخدام
/inventory/surplus               → ★ صفحة الفوائض — كل المواد الزائدة من مشاريع سابقة
/inventory/scan                  → ★ مسح QR / تحليل صورة بـ AI
/inventory/alerts                → تنبيهات نقص المخزون

## العملاء
/clients                         → دليل العملاء (80 عميل)
/clients/[id]                    → ملف العميل + المشاريع + المدفوعات

## الصيانة
/maintenance                     → جدول صيانة المعدات

## الأنظمة
/regulations                     → نظام PENTAGON — القوانين والعقوبات
/regulations/[section]           → عرض حسب القسم

## الأهداف
/strategy                        → الأهداف الاستراتيجية 2026 + خطوط العمل

## التقارير
/reports                         → مركز التقارير
/reports/attendance              → تقرير حضور
/reports/financial               → تقرير مالي
/reports/inventory               → تقرير جرد
/reports/export                  → تصدير PDF/Excel

## الإعدادات
/settings                        → إعدادات النظام
/settings/users                  → إدارة المستخدمين والصلاحيات
/settings/holidays               → تقويم العطل الرسمية
/settings/clickup                → ★ ربط ClickUp
/settings/ai                     → ★ إعدادات AI
```

---

## 8. تصميم الواجهة (UI Design Specs)

### الألوان (Basra Signage System)
```css
--primary:    #1a1a2e;   /* كحلي غامق — الخلفية الرئيسية */
--secondary:  #c4a962;   /* ذهبي — العناصر المميزة */
--accent:     #e2e2e2;   /* فضي — الحدود والخلفيات الثانوية */
--surface:    #f8f9fa;   /* أبيض مائل للرمادي — البطاقات */
--dark-gray:  #2d2d3d;   /* رمادي غامق — نصوص ثانوية */
--danger:     #e74c3c;   /* أحمر — عقوبات، خسائر */
--success:    #27ae60;   /* أخضر — أرباح، حوافز */
--warning:    #f39c12;   /* برتقالي — تنبيهات */
--info:       #3498db;   /* أزرق — معلومات */
```

### Layout
- **Sidebar يمين** (RTL): قائمة الأقسام مع أيقونات
- **Header**: اسم المستخدم + دوره + إشعارات + بحث
- **Main area**: بطاقات KPI + جداول + charts
- **Mobile responsive**: القائمة تصير hamburger menu

---

## 9. مراحل التنفيذ (6 مراحل)

### المرحلة 1: الأساس + الحضور (أسبوع 1-2)
- إعداد Next.js + Prisma + Supabase
- نظام تسجيل دخول + صلاحيات 4 مستويات
- واجهة RTL عربية + sidebar + layout
- رفع ملفات إكسل للحضور + معالجة تلقائية
- عرض الحضور اليومي/الشهري
- بروفايل الموظف الشامل

### المرحلة 2: المالية (أسبوع 2-3)
- واردات يومية + مصروفات يومية
- حاسبة الرواتب الشهرية
- السلف والقروض
- P&L الشهري + Charts

### المرحلة 3: المشاريع + العملاء (أسبوع 3-4)
- إدارة المشاريع (5 خطوط عمل)
- Workflow: Intake → Design → Costing → Production → QC → Delivery
- دليل العملاء (80 عميل)
- ربط مشاريع بعملاء وواردات

### المرحلة 4: الجرد المتقدم (أسبوع 4-5)
- أصول ثابتة (198 صنف)
- مواد خام مع QR codes
- نظام تتبع الفوائض (surplus tracking)
- حركة المواد (دخول/خروج/إرجاع)
- تنبيهات نقص المخزون
- تحليل صور AI

### المرحلة 5: الأنظمة + ClickUp (أسبوع 5-6)
- نظام PENTAGON — القوانين والعقوبات
- الأهداف الاستراتيجية
- ClickUp integration
- صيانة المعدات

### المرحلة 6: التقارير + AI (أسبوع 6-7)
- مركز التقارير
- تصدير PDF/Excel
- AI: تحليل تلقائي للملفات المرفوعة
- AI: تصنيف ذكي للبيانات
- لوحة تحكم رئيسية شاملة

---

## 10. أوامر بدء المشروع

```bash
# إنشاء المشروع
npx create-next-app@latest workshop-erp --typescript --tailwind --app --src-dir --use-npm

cd workshop-erp

# تثبيت المكتبات الأساسية
npm install prisma @prisma/client
npm install next-auth @auth/prisma-adapter bcryptjs
npm install xlsx recharts
npm install @radix-ui/react-icons lucide-react
npm install jspdf html2canvas
npm install qrcode react-barcode
npm install date-fns
npm install zod react-hook-form @hookform/resolvers

# Dev dependencies
npm install -D @types/bcryptjs @types/qrcode

# إعداد Prisma
npx prisma init --datasource-provider postgresql

# بعد نسخ الـ schema
npx prisma migrate dev --name init
npx prisma generate

# Seed البيانات الأولية (32 موظف + 13 قانون + 80 عميل)
npx prisma db seed

# تشغيل
npm run dev
```

---

## 11. ملاحظات مهمة للمطوّر (Windsurf/Cursor)

1. **الاتجاه**: كل الواجهة RTL — استخدم `dir="rtl"` على `<html>` و Tailwind RTL utilities
2. **الخط**: استخدم خط عربي واضح (IBM Plex Arabic أو Noto Kufi Arabic)
3. **العملة**: كل المبالغ بالدينار العراقي (IQD) — format: `1,000,000 IQD`
4. **التاريخ**: الصيغة `YYYY-MM-DD` داخلياً، عرض بالعربي `2026/03/31`
5. **الـ Seed Data**: يجب تحميل بيانات الـ 32 موظف و 80 عميل و 198 صنف جرد كبيانات أولية
6. **ClickUp MCP**: URL = `https://mcp.clickup.com/mcp`
7. **AI**: استخدم `claude-sonnet-4-20250514` لتحليل الصور والملفات
8. **QR Code**: كل مادة خام تحصل على QR يحتوي: الاسم، النوع، القياسات، السمك، اللون
