# Prompt for Claude / Codex: Premium Integration of Monthly Operating Costs

Please implement a premium, robust, and visually stunning monthly operating cost management and verification system for our custom ERP (Octagon ERP).

---

## 1. Context & Technical Specifications

- **Tech Stack**: Vanilla HTML5, CSS3 (with custom CSS variables/themes), and Vanilla JavaScript (ES6+).
- **Core State**:
  - Operating costs settings are stored in `omni.adminSettings.workshopOperatingCosts`.
  - Schema for items should be:
    ```json
    {
      "id": "diesel",
      "name": "كاز تشغيل المولد",
      "amount": 200000, 
      "active": true,
      "actuals": {
        "2026-03": { 
          "amount": 250000, 
          "verified": true, 
          "paymentDate": "2026-03-15", 
          "paymentSource": "person_pocket", 
          "paidBy": "سيف" 
        }
      }
    }
    ```
- **Active Files in Workspace**:
  - Default items list: `getDefaultWorkshopOperatingCostItems()` in [data-providers.js](file:///c:/Users/Zahraa%20dlbooz/Downloads/odoo-19.0/octagon-erp/modules/data-providers.js).
  - UI triggers: [calendar.html](file:///c:/Users/Zahraa%20dlbooz/Downloads/odoo-19.0/octagon-erp/views/calendar.html).
  - Main calculations & rendering logic: [app.js](file:///c:/Users/Zahraa%20dlbooz/Downloads/odoo-19.0/octagon-erp/app.js).

---

## 2. Core Functional Requirements

We want to build a highly optimized workflow for **Monthly Operating Costs** (like rent, internet, electricity, diesel, ChatGPT) with the following features:

### A. Calendar Page Config & UI Button
- In [calendar.html](file:///c:/Users/Zahraa%20dlbooz/Downloads/odoo-19.0/octagon-erp/views/calendar.html), there is a button called **"مصاريف التشغيل"** (Operating Costs).
- Clicking this opens a premium configuration modal `openMonthlyOperatingCostsModal()`.

### B. Premium Configuration Modal UI & Experience
- Render a high-end **Glassmorphism modal** (using the system's `showOmniModal` component).
- List the 6 default recurring items (Rent, Internet, Electricity, Water, Diesel/كاز, ChatGPT) and allow adding custom items.
- For each item, show:
  1. **اسم المصروف** (Expense Name).
  2. **الافتراضي التقديري** (Default Estimated Amount): Used for future forecasts on the calendar.
  3. **الفعلي المشتري** (Actual Amount Paid): Pre-populated from actual records or entered manually.
  4. **زر توثيق / اعتماد** (Verify Toggle).
- **Inline Expandable Verification Form**: When checking the "توثيق" box for an item, slide open a small settings card containing:
  - **تاريخ الدفع الفعلي** (Actual Payment Date) field.
  - **التأثير على القاصة** (Cashbox Impact) toggle:
    - **نعم (يخصم من قاصة الورشة)**: Deducts from the main workshop cashbox balance.
    - **لا (دفع مباشر من جيب المالك - سيف)**: Logs the expense for daily cost sharing and project net profit calculations, but **does not** subtract any money from the workshop cashbox balance.
  - **اعتماد القيمة كافتراضي مستقبلي** (Set as new default) checkbox: If checked, updates the default `amount` of this item so that future months automatically inherit this latest paid price (Adaptive Default).

### C. Automatic Matching with Expenses Ledger
- When the configuration modal is opened, search the system's **Expenses database** for any recorded transactions of matching categories for the active month (e.g., category "كاز" or "إنترنت").
- Sum these transactions and auto-populate them in the **"الفعلي المشتري"** (Actual Amount) input field as a suggestion.

### D. Daily Share Calculation & Presentation
- Update `getWorkshopOperatingCostBreakdown(year, month)`:
  - For each active item: if verified, use the verified actual amount; otherwise, fallback to the default estimated amount.
  - Sum them up to get the monthly total, and divide by the number of days in the month to get the `dailyShare`.
- Update `renderCalendarDayDetails(dayData)`:
  - Display the operating costs list on the day details panel.
  - Color-code the items: Green badge **(موثق)** for verified costs, and Yellow badge **(مقدّر)** for unverified estimated costs.

---

## 3. Implementation Request

Please refactor and write clean, fully functional, and visually premium CSS/JS codes in [app.js](file:///c:/Users/Zahraa%20dlbooz/Downloads/odoo-19.0/octagon-erp/app.js) and other files to complete this implementation flawlessly.
