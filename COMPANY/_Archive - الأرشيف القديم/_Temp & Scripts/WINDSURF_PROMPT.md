# PROMPT FOR WINDSURF — Workshop ERP System
# Copy this ENTIRE file and paste it as the first prompt in Windsurf

---

## CONTEXT

I am building a complete Workshop ERP system for "Al-Safwa Engineering Workshop" (الورشة الهندسية) in Basra, Iraq. The system manages 32 employees across attendance, payroll, finance, inventory, projects, and internal regulations.

Read the file `WORKSHOP_ERP_PRD_v2.md` for the full database schema, route structure, tech stack, and all employee/client/inventory seed data.

This prompt focuses on the **SALARY CALCULATION ENGINE** — the most critical and complex part of the system. Every rule below MUST be implemented exactly as described.

---

## TECH STACK

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma + PostgreSQL (Supabase)
- NextAuth.js (Credentials Provider, 4 roles: ADMIN, MANAGER, ACCOUNTANT, EMPLOYEE)
- SheetJS (xlsx) for Excel parsing
- Recharts for charts
- Full Arabic RTL interface (dir="rtl")
- Font: IBM Plex Arabic or Noto Kufi Arabic

---

## START WITH PHASE 1: Foundation + Attendance + Payroll Engine

Build the following in order:

### Step 1: Project Setup
- Create Next.js 14 app with TypeScript, Tailwind, App Router, src directory
- Install all dependencies from PRD
- Setup Prisma with PostgreSQL
- Create full database schema from PRD
- Seed with 32 employees data (names, roles, salaries from PRD)
- Setup NextAuth with 4 roles
- Create Arabic RTL layout with right sidebar navigation

### Step 2: Excel Upload & Attendance Processing
- Build `/attendance/upload` page
- Accept Excel files with this structure (each sheet = one employee):
  - Columns: التاريخ (Date) | دخول (Check-in) | خروج (Check-out) | الساعات (Hours) | السعر (Price) | ملاحظات (Notes)
  - Sheet name format: "code-name" (e.g., "3-حيدر يافوز")
  - Last row = الإجمالي (Total) — skip this row
  - "---" in hours/price = missing data (MISSING_CHECKOUT status)
  - Some check-ins show "03:00 am" = manual entries

- Also accept timesheets with day status column:
  - Possible statuses: دوام (Regular) | إجازة مدفوعة (Paid Leave) | إجازة غير مدفوعة (Unpaid Leave) | غياب (Absence)

### Step 3: The Salary Calculation Engine

**THIS IS THE MOST CRITICAL PART. Implement these rules EXACTLY:**

```typescript
// ============================================================
// SALARY CALCULATION RULES — الورشة الهندسية
// ============================================================

// --- CONSTANTS ---
const DAILY_WORK_HOURS = 9; // includes 1 hour paid break
const WORK_DAYS_PER_WEEK = 6; // Saturday to Thursday
const DAY_OFF = "Friday";
const TRANSPORT_FOOD_ALLOWANCE = 100_000; // IQD per actual attendance day
const OVERTIME_MULTIPLIER = 1.5;
const FRIDAY_MULTIPLIER_COMPLIANT = 2.0; // worked full 6 days that week
const FRIDAY_MULTIPLIER_NON_COMPLIANT = 1.0; // had absence/leave that week
const LATE_PENALTY_MULTIPLIER = 2.0; // double deduction for being late
const ABSENCE_PENALTY_DAYS = 2; // unauthorized absence = 2 days deducted
const ADVANCE_MIN_MONTHS = 3; // minimum months before eligible for advance
const ADVANCE_MAX_PERCENT = 0.30; // max 30% of nominal salary
const RESIGNATION_NOTICE_DAYS = 15;

// --- RULE 1: Daily Rate Calculation ---
// Daily rate is NOT fixed — it depends on the number of days in THAT month
function calcDailyRate(nominalSalary: number, month: number, year: number): number {
  const daysInMonth = new Date(year, month, 0).getDate(); // 28, 29, 30, or 31
  return nominalSalary / daysInMonth;
}

function calcHourlyRate(dailyRate: number): number {
  return dailyRate / DAILY_WORK_HOURS; // 9 hours
}

// --- RULE 2: Daily Allowance ---
// 100,000 IQD transport+food — ONLY for actual attendance days
function calcDailyAllowance(dayStatus: DayStatus): number {
  if (dayStatus === "REGULAR" || dayStatus === "OVERTIME") {
    return TRANSPORT_FOOD_ALLOWANCE / 26; // ~3,846 IQD per day
  }
  return 0; // No allowance for leave or absence
}

// --- RULE 3: Friday Pay Entitlement ---
// Employee EARNS Friday pay ONLY if they worked all 6 days (Sat-Thu) that week
// Any leave or absence in the week = NO Friday pay
function isFridayPayEntitled(weekAttendance: Attendance[]): boolean {
  const workDays = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
  for (const day of workDays) {
    const record = weekAttendance.find(a => getDayName(a.date) === day);
    if (!record || record.dayStatus === "ABSENCE" || record.dayStatus === "LEAVE_PAID" || record.dayStatus === "LEAVE_UNPAID") {
      return false; // Any non-attendance day = no Friday pay
    }
  }
  return true;
}

// --- RULE 4: Overtime Calculation ---
// After completing 9 hours: OT rate = hourlyRate × 1.5
function calcOvertimePay(totalHours: number, hourlyRate: number): number {
  if (totalHours <= DAILY_WORK_HOURS) return 0;
  const overtimeHours = totalHours - DAILY_WORK_HOURS;
  return overtimeHours * hourlyRate * OVERTIME_MULTIPLIER;
}

// --- RULE 5: Friday Work Pay ---
// If employee worked all 6 days: Friday hours × hourlyRate × 2.0
// If employee had absence/leave: Friday = compensatory day at regular rate + daily allowance
function calcFridayPay(
  fridayHours: number,
  hourlyRate: number,
  dailyAllowance: number,
  isCompliant: boolean // worked 6 days?
): number {
  if (isCompliant) {
    return fridayHours * hourlyRate * FRIDAY_MULTIPLIER_COMPLIANT;
  } else {
    // Compensatory day: regular rate + daily allowance
    return (fridayHours * hourlyRate) + dailyAllowance;
  }
}

// --- RULE 6: Evening Work Allowance (سماحية الصباح) ---
// If OT yesterday > 2 hours → today's allowance = (OT - 2) hours late arrival permitted
// If employee arrives later than the allowance → deduct DOUBLE the excess
// OT for this employee today starts after completing 9 hours from ACTUAL check-in
function calcMorningAllowance(previousDayOvertimeHours: number): number {
  if (previousDayOvertimeHours > 2) {
    return previousDayOvertimeHours - 2; // hours of allowed late arrival
  }
  return 0;
}

function calcLateDeduction(
  checkInTime: string,     // actual check-in
  scheduledStart: string,  // "08:00"
  morningAllowance: number // hours from previous day OT
): { lateMinutes: number; deductionHours: number; adjustedStart: string } {
  const lateMinutes = diffInMinutes(checkInTime, scheduledStart);
  
  if (lateMinutes <= 0) {
    return { lateMinutes: 0, deductionHours: 0, adjustedStart: scheduledStart };
  }
  
  const lateHours = lateMinutes / 60;
  const allowanceHours = morningAllowance;
  
  if (lateHours <= allowanceHours) {
    // Within allowance — no deduction, but OT starts from actual check-in + 9h
    return { lateMinutes, deductionHours: 0, adjustedStart: checkInTime };
  }
  
  // Exceeded allowance — deduct DOUBLE the excess
  const excessHours = lateHours - allowanceHours;
  const deductionHours = excessHours * LATE_PENALTY_MULTIPLIER; // ×2
  return { lateMinutes, deductionHours, adjustedStart: checkInTime };
}

// --- RULE 7: Penalties ---

// 7a. Approved Leave (إجازة بموافقة)
// Deduction: 1 day nominal + daily allowance + Friday pay lost
function calcLeaveDeduction(dailyRate: number, dailyAllowance: number): {
  nominalDeduction: number;
  allowanceDeduction: number;
  fridayLost: boolean;
} {
  return {
    nominalDeduction: dailyRate * 1,     // 1 day
    allowanceDeduction: dailyAllowance,   // that day's share
    fridayLost: true                      // loses Friday pay
  };
}

// 7b. Unauthorized Absence (غياب بدون موافقة)
// Deduction: 2 days nominal + daily allowance + Friday pay lost
function calcAbsenceDeduction(dailyRate: number, dailyAllowance: number): {
  nominalDeduction: number;
  allowanceDeduction: number;
  fridayLost: boolean;
} {
  return {
    nominalDeduction: dailyRate * 2,      // 2 days!
    allowanceDeduction: dailyAllowance,
    fridayLost: true
  };
}

// 7c. Late Arrival (تأخير صباحي)
// Deduction: DOUBLE the late time from nominal salary
function calcLateArrivalPenalty(lateMinutes: number, hourlyRate: number): number {
  const lateHours = lateMinutes / 60;
  return lateHours * LATE_PENALTY_MULTIPLIER * hourlyRate; // ×2
}

// 7d. Fingerprint Manipulation (تلاعب بالبصمة)
// Treated as intentional absence: 2 days + allowance + Friday
function calcFingerprintFraudPenalty(dailyRate: number, dailyAllowance: number) {
  return calcAbsenceDeduction(dailyRate, dailyAllowance);
}

// 7e. Early Departure (مغادرة مبكرة)
// With permission: deduct double the early time, Friday affected only if > 4.5 hours
// Without permission: treated as unauthorized absence
function calcEarlyDeparturePenalty(
  earlyMinutes: number,
  hourlyRate: number,
  withPermission: boolean,
  dailyRate: number,
  dailyAllowance: number
): { deduction: number; fridayLost: boolean } {
  if (!withPermission) {
    const absence = calcAbsenceDeduction(dailyRate, dailyAllowance);
    return { deduction: absence.nominalDeduction, fridayLost: true };
  }
  const earlyHours = earlyMinutes / 60;
  const deduction = earlyHours * LATE_PENALTY_MULTIPLIER * hourlyRate;
  const fridayLost = earlyHours > 4.5; // more than half day
  return { deduction, fridayLost };
}

// --- RULE 8: Monthly Salary Calculation (the big one) ---
function calcMonthlySalary(
  employee: Employee,
  monthAttendance: Attendance[],
  month: number,
  year: number
): MonthlySalaryResult {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyRate = employee.nominalSalary / daysInMonth;
  const hourlyRate = dailyRate / DAILY_WORK_HOURS;
  
  let totalRegularPay = 0;
  let totalOvertimePay = 0;
  let totalFridayPay = 0;
  let totalAllowance = 0;
  let totalDeductions = 0;
  let totalBonuses = 0;
  let totalAdvances = 0;
  
  // Group attendance by week (Sat-Fri)
  const weeks = groupByWeek(monthAttendance);
  
  for (const week of weeks) {
    const fridayEntitled = isFridayPayEntitled(week.workDays);
    
    for (const day of week.allDays) {
      const prevDay = getPreviousDay(day, monthAttendance);
      const prevOT = prevDay?.overtimeHours || 0;
      const morningAllowance = calcMorningAllowance(prevOT);
      
      if (day.dayName === "Friday") {
        if (day.totalHours > 0) { // Worked on Friday
          totalFridayPay += calcFridayPay(
            day.totalHours, hourlyRate,
            TRANSPORT_FOOD_ALLOWANCE / 26,
            fridayEntitled
          );
          totalAllowance += TRANSPORT_FOOD_ALLOWANCE / 26;
        } else if (fridayEntitled) {
          // Didn't work Friday but entitled to pay
          totalRegularPay += dailyRate;
        }
        continue;
      }
      
      switch (day.dayStatus) {
        case "REGULAR":
          // Regular hours pay
          const regHours = Math.min(day.totalHours, DAILY_WORK_HOURS);
          totalRegularPay += regHours * hourlyRate;
          
          // Overtime
          totalOvertimePay += calcOvertimePay(day.totalHours, hourlyRate);
          
          // Allowance
          totalAllowance += TRANSPORT_FOOD_ALLOWANCE / 26;
          
          // Late check?
          const lateResult = calcLateDeduction(
            day.checkIn, "08:00", morningAllowance
          );
          if (lateResult.deductionHours > 0) {
            totalDeductions += lateResult.deductionHours * hourlyRate;
          }
          break;
          
        case "LEAVE_PAID":
          const leaveD = calcLeaveDeduction(dailyRate, TRANSPORT_FOOD_ALLOWANCE / 26);
          totalDeductions += leaveD.nominalDeduction + leaveD.allowanceDeduction;
          break;
          
        case "LEAVE_UNPAID":
          totalDeductions += dailyRate + (TRANSPORT_FOOD_ALLOWANCE / 26);
          break;
          
        case "ABSENCE":
          const absD = calcAbsenceDeduction(dailyRate, TRANSPORT_FOOD_ALLOWANCE / 26);
          totalDeductions += absD.nominalDeduction + absD.allowanceDeduction;
          break;
      }
    }
  }
  
  const grossPay = totalRegularPay + totalOvertimePay + totalFridayPay + totalAllowance + totalBonuses;
  const netPay = grossPay - totalDeductions - totalAdvances;
  
  return {
    employee,
    month, year,
    dailyRate,
    hourlyRate,
    totalRegularPay,
    totalOvertimePay,
    totalFridayPay,
    totalAllowance,
    totalBonuses,
    totalDeductions,
    totalAdvances,
    grossPay,
    netPay,
    daysWorked: monthAttendance.filter(a => a.dayStatus === "REGULAR").length,
    totalHours: monthAttendance.reduce((s, a) => s + (a.totalHours || 0), 0),
  };
}

// --- RULE 9: Advance/Loan Rules ---
// - Not eligible until 3 months of actual work
// - Max 30% of nominal salary
// - Deducted from same month's salary
function isAdvanceEligible(employee: Employee): boolean {
  const monthsWorked = diffInMonths(employee.joinDate, new Date());
  return monthsWorked >= ADVANCE_MIN_MONTHS;
}

function maxAdvanceAmount(nominalSalary: number): number {
  return nominalSalary * ADVANCE_MAX_PERCENT;
}

// --- RULE 10: Emergency Notification ---
// If employee reports emergency → "Absence" converts to "Regular Leave"
// Only removes the EXTRA day penalty (1 day instead of 2)
function convertAbsenceToLeave(attendance: Attendance): Attendance {
  if (attendance.dayStatus === "ABSENCE") {
    return { ...attendance, dayStatus: "LEAVE_PAID" };
  }
  return attendance;
}
```

### Step 4: Attendance & Payroll Dashboard Pages

Build these pages with Arabic RTL:

1. **`/attendance`** — Monthly attendance grid (all employees × days, color-coded)
2. **`/attendance/upload`** — Drag & drop Excel upload with progress + validation report
3. **`/attendance/daily`** — Today's attendance: who's here, who's late, who's absent
4. **`/employees/[id]`** — Full employee profile:
   - Personal info + photo placeholder
   - Current month attendance calendar (color-coded: green=present, red=absent, yellow=leave, blue=Friday)
   - Salary breakdown (regular + OT + Friday + allowance - deductions - advances = net)
   - Attendance history chart (months)
   - Penalties & bonuses log
   - Advances & loans

5. **`/finance/payroll`** — Monthly payroll calculator:
   - All employees in a table
   - Auto-calculated based on attendance
   - Columns: الموظف | أيام الحضور | الساعات | الاسمي المستحق | الإضافي | الجمعة | المخصصات | الخصومات | السلف | الصافي
   - Export to Excel/PDF

### Step 5: Main Dashboard (`/`)
- KPI cards: إجمالي الرواتب، الحاضرون اليوم، المتأخرون، الغائبون
- Monthly P&L chart (revenue vs expenses)
- Attendance rate chart (monthly trend)
- Active projects count
- Low inventory alerts

---

## UI REQUIREMENTS

- **Language**: Arabic only, full RTL
- **Font**: IBM Plex Arabic (Google Fonts)
- **Colors**: 
  - Primary: #1a1a2e (dark navy)
  - Secondary: #c4a962 (gold)
  - Background: #f8f9fa
  - Success: #27ae60, Danger: #e74c3c, Warning: #f39c12
- **Sidebar**: Right side (RTL), collapsible, with icons + Arabic labels
- **Tables**: Striped, sortable, searchable, paginated
- **Forms**: Arabic labels, validation messages in Arabic
- **Currency**: Always show as "XXX,XXX IQD" with thousands separator
- **Responsive**: Desktop-first but mobile-friendly

---

## DATABASE SEED DATA

Seed the database with 32 employees from the PRD file. Key employees:
- #1 Accountant (حيدر مضر) — 350,000 IQD — Role: ACCOUNTANT
- #8 حيدر مضر — 650,000 IQD — Role: ACCOUNTANT  
- #31 يوسف احمد — 750,000 IQD — Role: MANAGER (مدير تنفيذي)
- سيف (not in employee list) — Role: ADMIN (المدير العام)
- All others — Role: EMPLOYEE

Also seed the 13 PENTAGON regulations from the PRD.

---

## IMPORTANT NOTES

1. The hourly rate is NOT fixed — it changes based on the number of days in each month
2. Friday pay is conditional — must check weekly compliance
3. Morning allowance (سماحية) from previous day OT is a unique rule — implement carefully
4. Late penalty is DOUBLE the late time, not equal
5. Unauthorized absence = 2 days deduction (not 1)
6. Transport/food allowance (100K IQD) is only for actual attendance days
7. All monetary values in Iraqi Dinars (IQD) — no decimals needed for display
8. Timesheet may include day status: دوام | إجازة مدفوعة | إجازة غير مدفوعة | غياب

---

## BEGIN

Start by setting up the project, creating the database schema, and building the attendance upload + payroll calculation engine. The salary calculation engine is the foundation — everything else depends on it being correct.
