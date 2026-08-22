/** BUILD-09R-2 Group G: Dock Schedule, Dock Check-In, Staging Board and Cross-Dock Workspace.
 *
 * These four pages are one physical flow, not four lists: a vehicle is scheduled against a dock,
 * arrives and is checked in, is assigned a dock and serviced, its stock lands in a staging lane,
 * and some of that stock may cross-dock straight onto an outbound appointment instead of being
 * put away. Each page is therefore shaped like its step:
 *
 *   - Dock Schedule is a per-dock timeline, because the question it answers is "what is occupying
 *     which dock, when, and does anything collide" - which a flat table physically cannot show.
 *   - Dock Check-In is the gatehouse: expected arrivals, arrival capture, dock assignment, service
 *     start, departure, and a live detention clock for vehicles that arrived late.
 *   - Staging Board is lane capacity: how full each lane is, what is holding it, and release.
 *   - Cross-Dock is the matching desk: eligibility, maker-checker approval, and the canonical
 *     movement request.
 *
 * The boundaries the server owns and this UI must not blur: a dock conflict, a capacity overrun
 * and a cross-dock maker-checker refusal are all server verdicts, surfaced as readable denials;
 * and an approved cross-dock generates a warehouse task plus a canonical stock:move:post request
 * that Inventory posts - the workspace never moves stock itself.
 */
(function dockWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, percent, when, minutes, badge, kpis, scopeLine, stepper, field, select, textarea, lookup, muted } = S;

  const APPOINTMENT_STEPS = [['expected', 'Expected', 'متوقع'], ['checked_in', 'Checked in', 'سُجل الدخول'], ['dock_assigned', 'Dock assigned', 'أُسند الرصيف'], ['unloading', 'In service', 'قيد الخدمة'], ['departed', 'Departed', 'غادر']];
  const STATUS_TONE = { expected: '', scheduled: 'info', checked_in: 'warn', dock_assigned: 'info', unloading: 'info', loading: 'info', staged: 'info', crossdock_review: 'warn', ready_to_depart: 'ok', departed: 'ok', cancelled: 'muted', conflict: 'danger', blocked: 'danger' };
  const MATCH_TONE = { candidate: 'info', partial: 'warn', approved: 'info', task_created: 'info', awaiting_canonical: 'info', completed: 'ok', cancelled: 'muted', exception: 'danger' };
  const STAGING_TONE = { reserved: 'info', occupied: 'warn', partially_released: 'warn', released: 'ok' };
  const STAGING_TYPES = ['staging', 'receiving_dock', 'shipping_dock'];
  const ACTIVE_STAGING = ['reserved', 'occupied', 'partially_released'];
  const OPEN_APPOINTMENT = ['expected', 'scheduled', 'checked_in', 'dock_assigned', 'unloading', 'loading', 'staged', 'crossdock_review', 'ready_to_depart'];

  const statusBadge = (status) => badge(status, STATUS_TONE[status] ?? '');

  // Appointments are stored in UTC, but every other timestamp on these pages renders in the
  // viewer's local zone (via when()). Bucketing and positioning the timeline by UTC instead would
  // put a block at 06:00 whose own tooltip reads 09:00, so the day boundary and the track offset
  // are both computed locally - matching the <input type="date"> the operator picks the day with.
  const pad = (value) => String(value).padStart(2, '0');
  const dayOf = (value) => {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? '' : `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  };
  const localMidnight = (day) => new Date(`${day}T00:00:00`).getTime();
  const isServiceState = (status) => ['unloading', 'loading', 'staged', 'crossdock_review', 'ready_to_depart'].includes(status);

  // In-service statuses collapse onto the 'unloading' step so both directions share one stepper.
  const stepFor = (status) => (isServiceState(status) ? 'unloading' : status === 'scheduled' ? 'expected' : status);

  // ---------------------------------------------------------------- Dock Schedule

  const schedule = S.createWorkspace({
    pageId: 'dock_schedule',
    prefix: 'ds',
    initialState: () => ({ docks: [], appointments: [], day: '', loading: true }),

    async onActivate(state, api) {
      const [docks, appointments] = await Promise.all([api.query('docks'), api.query('dock-appointments')]);
      state.docks = Array.isArray(docks) ? docks : [];
      state.appointments = Array.isArray(appointments) ? appointments : [];
      if (!state.day) {
        // Default to the day the schedule actually has work on, not to wall-clock today - an
        // empty board on a demo or a quiet warehouse reads as a broken page.
        const upcoming = state.appointments.filter((row) => OPEN_APPOINTMENT.includes(row.status)).map((row) => dayOf(row.expectedArrival)).sort();
        state.day = upcoming[0] || dayOf(state.appointments[0]?.expectedArrival) || dayOf(Date.now());
      }
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading the dock schedule…', 'جارِ تحميل جدول الأرصفة…'))}</p></div>`;
      const onDay = state.appointments.filter((row) => dayOf(row.expectedArrival) === state.day && row.status !== 'cancelled');
      const inbound = onDay.filter((row) => row.appointmentType === 'inbound').length;
      return `${scopeLine([`${t('Docks', 'الأرصفة')}: ${esc(num(state.docks.length, 0))}`])}
        ${kpis([
          ['Appointments', 'المواعيد', num(onDay.length, 0)],
          ['Inbound', 'وارد', num(inbound, 0), inbound ? 'info' : ''],
          ['Outbound', 'صادر', num(onDay.length - inbound, 0)],
          ['Unassigned', 'بدون رصيف', num(onDay.filter((row) => !row.dockId).length, 0), onDay.some((row) => !row.dockId) ? 'warn' : 'ok'],
        ])}
        ${timelinePanel(state, onDay)}
        ${appointmentFormPanel(state)}`;
    },

    bind(container, state, api) {
      const day = container.querySelector('[data-role="ds-day"]');
      if (day) day.addEventListener('change', () => { state.day = day.value; api.paint(); });

      const form = container.querySelector('[data-role="ds-appointment-form"]');
      if (form) form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          await api.call('wms:dock_appointment_create', {
            appointment_type: data.appointment_type, dock_id: data.dock_id || undefined,
            expected_arrival: new Date(data.expected_arrival).toISOString(),
            expected_departure: new Date(data.expected_departure).toISOString(),
            carrier_name: data.carrier_name || undefined, vehicle_reference: data.vehicle_reference || undefined,
            expected_units: Number(data.expected_units || 0),
            source_document_type: data.source_document_type || undefined, source_document_id: data.source_document_id || undefined,
          });
          const appointments = await api.query('dock-appointments');
          state.appointments = Array.isArray(appointments) ? appointments : [];
          state.day = dayOf(data.expected_arrival);
        });
      });

      container.querySelectorAll('[data-role="ds-cancel"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        await api.call('wms:dock_cancel', { appointment_id: button.dataset.appointmentId, reason: 'Cancelled from the dock schedule' });
        const appointments = await api.query('dock-appointments');
        state.appointments = Array.isArray(appointments) ? appointments : [];
      })));
    },
  });

  /** Local-day fraction a timestamp falls at, clamped so an overnight window stays on the board. */
  function dayFraction(value, day, fallback) {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return fallback;
    return Math.min(1, Math.max(0, (at.getTime() - localMidnight(day)) / 86400000));
  }

  function timelinePanel(state, onDay) {
    const lanes = [...state.docks.map((dock) => ({ id: dock.id, label: `${dock.code} · ${dock.name}`, type: dock.dockType, capacity: dock.capacityUnits })),
      { id: null, label: t('Unassigned', 'بدون رصيف'), type: 'mixed', capacity: null }];

    const hours = Array.from({ length: 7 }, (unused, index) => index * 4);
    return `<div class="b09r-panel">
      <div class="b09r-panel-head"><h2>${esc(t('Dock schedule', 'جدول الأرصفة'))}</h2>
        <label class="b09-query-field"><span>${esc(t('Day', 'اليوم'))}</span><input type="date" data-role="ds-day" value="${esc(state.day)}"></label></div>
      <div class="b09r-timeline" data-role="ds-timeline">
        <div class="b09r-timeline-axis">${hours.map((hour) => `<span style="inset-inline-start:${(hour / 24 * 100).toFixed(2)}%">${esc(String(hour).padStart(2, '0'))}:00</span>`).join('')}</div>
        ${lanes.map((lane) => laneRow(lane, onDay.filter((row) => (row.dockId || null) === lane.id), state.day)).join('')}
      </div>
      ${onDay.length ? '' : muted('No appointments are scheduled on this day.', 'لا توجد مواعيد مجدولة في هذا اليوم.')}</div>`;
  }

  // No client-side overlap detection here on purpose: platform/wms/docks.mjs refuses a colliding
  // window at both createDockAppointment and assignDock, so two appointments cannot occupy one
  // dock at once. Re-deriving that in the browser would be a second, weaker authority that could
  // disagree with the server. A refused booking surfaces as the server's own denial instead.
  function laneRow(lane, appointments, day) {
    return `<div class="b09r-timeline-lane" data-role="ds-lane" data-dock-id="${esc(lane.id || 'unassigned')}">
      <span class="b09r-timeline-label"><strong>${esc(lane.label)}</strong><small>${esc(lane.type)}${lane.capacity != null ? ` · ${t('cap', 'سعة')} ${num(lane.capacity, 0)}` : ''}</small></span>
      <span class="b09r-timeline-track">
        ${appointments.map((row) => {
          const from = dayFraction(row.expectedArrival, day, 0);
          const to = Math.max(from + 0.01, dayFraction(row.expectedDeparture, day, 1));
          return `<button type="button" class="b09r-timeline-block b09r-timeline-${esc(row.appointmentType)}"
            data-role="ds-block" data-appointment-id="${esc(row.id)}"
            style="inset-inline-start:${(from * 100).toFixed(2)}%;width:${((to - from) * 100).toFixed(2)}%"
            title="${esc(`${row.carrierName || row.vehicleReference || row.id} · ${row.status}`)}">
            <span>${esc(row.carrierName || row.vehicleReference || row.sourceDocumentId || row.id.slice(0, 8))}</span></button>`;
        }).join('')}
      </span>
    </div>`;
  }

  function appointmentFormPanel(state) {
    const dockOptions = [['', t('Unassigned — assign at check-in', 'بدون رصيف — يُسند عند التسجيل'), t('Unassigned — assign at check-in', 'بدون رصيف — يُسند عند التسجيل')],
      ...state.docks.filter((dock) => dock.active).map((dock) => [dock.id, `${dock.code} · ${dock.name} (${dock.dockType})`, `${dock.code} · ${dock.name} (${dock.dockType})`])];
    return `<form class="b09r-panel" data-role="ds-appointment-form">
      <div class="b09r-panel-head"><h2>${esc(t('Schedule an appointment', 'جدولة موعد'))}</h2></div>
      <p>${esc(t('Booking a dock whose direction or time window collides is refused by the server, not hidden here.', 'حجز رصيف يتعارض اتجاهه أو نافذته الزمنية يُرفض من الخادم، ولا يُخفى هنا.'))}</p>
      <div class="b09r-grid-2">
        ${select('appointment_type', 'Direction', 'الاتجاه', [['inbound', 'Inbound', 'وارد'], ['outbound', 'Outbound', 'صادر']], { required: true })}
        ${select('dock_id', 'Dock', 'الرصيف', dockOptions)}
      </div>
      <div class="b09r-grid-2">${field('expected_arrival', 'Expected arrival', 'الوصول المتوقع', { type: 'datetime-local', required: true })}${field('expected_departure', 'Expected departure', 'المغادرة المتوقعة', { type: 'datetime-local', required: true })}</div>
      <div class="b09r-grid-2">${field('carrier_name', 'Carrier', 'الناقل')}${field('vehicle_reference', 'Vehicle reference', 'مرجع المركبة')}</div>
      <div class="b09r-grid-2">${field('source_document_type', 'Source document type', 'نوع الوثيقة المصدر')}${field('source_document_id', 'Source document', 'الوثيقة المصدر')}</div>
      ${field('expected_units', 'Expected units', 'الوحدات المتوقعة', { type: 'number', min: 0, value: '0' })}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Schedule appointment', 'جدولة الموعد'))}</button>
    </form>`;
  }

  // ---------------------------------------------------------------- Dock Check-In

  let tick = null;
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };
  const detentionMinutes = (row) => (row.detentionStartedAt && !row.detentionEndedAt ? Math.max(0, (Date.now() - new Date(row.detentionStartedAt).getTime()) / 60000) : null);

  const checkin = S.createWorkspace({
    pageId: 'dock_checkin',
    prefix: 'dc',
    initialState: () => ({ appointments: [], docks: [], selectedId: null, loading: true }),

    async onActivate(state, api) {
      const [appointments, docks] = await Promise.all([api.query('dock-appointments'), api.query('docks')]);
      state.appointments = (Array.isArray(appointments) ? appointments : []).filter((row) => OPEN_APPOINTMENT.includes(row.status));
      state.docks = Array.isArray(docks) ? docks : [];
      if (state.selectedId && !state.appointments.some((row) => row.id === state.selectedId)) state.selectedId = null;
    },

    render(state) {
      stopTick();
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading expected arrivals…', 'جارِ تحميل الوصولات المتوقعة…'))}</p></div>`;
      if (!state.appointments.length) return `${scopeLine()}<div class="b09r-panel">${muted('No vehicles are expected or on site.', 'لا توجد مركبات متوقعة أو في الموقع.')}</div>`;

      const onSite = state.appointments.filter((row) => row.actualArrival);
      const detained = onSite.filter((row) => detentionMinutes(row) != null);
      const selected = state.appointments.find((row) => row.id === state.selectedId);
      return `${scopeLine()}${kpis([
          ['Expected', 'متوقع', num(state.appointments.length - onSite.length, 0)],
          ['On site', 'في الموقع', num(onSite.length, 0), onSite.length ? 'info' : ''],
          ['Accruing detention', 'يتراكم عليها احتجاز', num(detained.length, 0), detained.length ? 'danger' : 'ok'],
        ])}
        ${gatehousePanel(state)}
        ${selected ? appointmentDetailPanel(selected, state) : ''}`;
    },

    bind(container, state, api) {
      const clocks = container.querySelectorAll('[data-role="dc-detention"]');
      if (clocks.length) {
        tick = setInterval(() => {
          const live = document.querySelectorAll('[data-build09-page="dock_checkin"] [data-role="dc-detention"]');
          if (!live.length) { stopTick(); return; }
          live.forEach((cell) => {
            const since = cell.dataset.since;
            if (since) cell.textContent = minutes(Math.max(0, (Date.now() - new Date(since).getTime()) / 60000));
          });
        }, 1000);
      }

      container.querySelectorAll('[data-role="dc-select"]').forEach((button) => button.addEventListener('click', () => {
        state.selectedId = button.dataset.appointmentId === state.selectedId ? null : button.dataset.appointmentId;
        api.paint();
      }));

      const reload = async (api2) => {
        const appointments = await api2.query('dock-appointments');
        state.appointments = (Array.isArray(appointments) ? appointments : []).filter((row) => OPEN_APPOINTMENT.includes(row.status));
      };

      const checkInForm = container.querySelector('[data-role="dc-checkin-form"]');
      if (checkInForm) checkInForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(checkInForm);
          await api.call('wms:dock_check_in', {
            appointment_id: checkInForm.dataset.appointmentId,
            vehicle_reference: data.vehicle_reference || undefined,
            actual_arrival: data.actual_arrival ? new Date(data.actual_arrival).toISOString() : undefined,
          });
          await reload(api);
        });
      });

      const assignForm = container.querySelector('[data-role="dc-assign-form"]');
      if (assignForm) assignForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(assignForm);
          await api.call('wms:dock_assign', { appointment_id: assignForm.dataset.appointmentId, dock_id: data.dock_id });
          await reload(api);
        });
      });

      [['dc-start', 'wms:dock_start_service'], ['dc-depart', 'wms:dock_depart']].forEach(([role, actionId]) => {
        const button = container.querySelector(`[data-role="${role}"]`);
        if (button) button.addEventListener('click', () => api.guarded(async () => {
          await api.call(actionId, { appointment_id: button.dataset.appointmentId });
          await reload(api);
          if (role === 'dc-depart') state.selectedId = null;
        }));
      });
    },
  });

  function gatehousePanel(state) {
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Gatehouse', 'البوابة'))}</h2></div>
      <div class="b09r-pool-list" data-role="dc-list">${state.appointments.map((row) => {
        const detention = detentionMinutes(row);
        return `<button type="button" class="b09r-queue-row b09r-wave-row${row.id === state.selectedId ? ' b09r-pool-selected' : ''}" data-role="dc-select" data-appointment-id="${esc(row.id)}">
          <span class="b09r-pool-main"><strong>${esc(row.vehicleReference || row.carrierName || row.id.slice(0, 8))}</strong>
            <small>${esc(row.appointmentType)} · ${esc(t('due', 'موعده'))} ${esc(when(row.expectedArrival))} · ${esc(row.dockId ? `${t('dock', 'رصيف')} ${row.dockId}` : t('no dock', 'بدون رصيف'))}</small></span>
          ${detention != null ? `<span class="b09r-detention"><small>${esc(t('detention', 'احتجاز'))}</small><strong data-role="dc-detention" data-since="${esc(row.detentionStartedAt)}">${esc(minutes(detention))}</strong></span>` : ''}
          ${statusBadge(row.status)}</button>`;
      }).join('')}</div></div>`;
  }

  function appointmentDetailPanel(row, state) {
    const dockOptions = state.docks.filter((dock) => dock.active && (dock.dockType === 'mixed' || dock.dockType === row.appointmentType))
      .map((dock) => [dock.id, `${dock.code} · ${dock.name} (${t('cap', 'سعة')} ${dock.capacityUnits})`, `${dock.code} · ${dock.name} (${t('cap', 'سعة')} ${dock.capacityUnits})`]);

    return `<div class="b09r-panel" data-role="dc-detail">
      <div class="b09r-panel-head"><h2>${esc(row.vehicleReference || row.carrierName || row.id)}</h2>${statusBadge(row.status)}</div>
      ${stepper(APPOINTMENT_STEPS, stepFor(row.status))}
      <div class="b09r-scope-line">
        <span>${esc(t('Carrier', 'الناقل'))}: ${esc(row.carrierName || '—')}</span>
        <span>${esc(t('Expected', 'المتوقع'))}: ${esc(when(row.expectedArrival))}</span>
        <span>${esc(t('Arrived', 'وصل'))}: ${esc(when(row.actualArrival))}</span>
        <span>${esc(t('Units', 'الوحدات'))}: ${esc(num(row.expectedUnits, 0))}</span></div>
      ${row.detentionStartedAt ? `<p class="b09r-error" data-role="dc-detention-note">${esc(t('Arrived after its booked window — detention is accruing.', 'وصلت بعد نافذتها المحجوزة — يتراكم الاحتجاز.'))}</p>` : ''}

      ${['expected', 'scheduled'].includes(row.status) ? `<form class="b09r-subform" data-role="dc-checkin-form" data-appointment-id="${esc(row.id)}">
        <div class="b09r-panel-head"><h2>${esc(t('Check in', 'تسجيل الدخول'))}</h2></div>
        <div class="b09r-grid-2">${field('vehicle_reference', 'Vehicle reference', 'مرجع المركبة', { value: row.vehicleReference || '' })}${field('actual_arrival', 'Actual arrival', 'الوصول الفعلي', { type: 'datetime-local' })}</div>
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Check in vehicle', 'تسجيل دخول المركبة'))}</button></form>` : ''}

      ${['expected', 'scheduled', 'checked_in'].includes(row.status) ? `<form class="b09r-subform" data-role="dc-assign-form" data-appointment-id="${esc(row.id)}">
        <div class="b09r-panel-head"><h2>${esc(t('Assign a dock', 'إسناد رصيف'))}</h2></div>
        <p>${esc(t('Only docks matching this direction are offered; capacity and time conflicts are still checked by the server.', 'تُعرض الأرصفة المطابقة لهذا الاتجاه فقط؛ ويبقى الخادم يفحص السعة وتعارض الأوقات.'))}</p>
        ${dockOptions.length ? select('dock_id', 'Dock', 'الرصيف', dockOptions, { required: true }) : muted('No active dock matches this appointment direction.', 'لا يوجد رصيف نشط مطابق لاتجاه هذا الموعد.')}
        ${dockOptions.length ? `<button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Assign dock', 'إسناد الرصيف'))}</button>` : ''}</form>` : ''}

      <div class="b09r-actions-row">
        ${row.status === 'dock_assigned' ? `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="dc-start" data-appointment-id="${esc(row.id)}">${esc(row.appointmentType === 'inbound' ? t('Start unloading', 'بدء التفريغ') : t('Start loading', 'بدء التحميل'))}</button>` : ''}
        ${isServiceState(row.status) ? `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="dc-depart" data-appointment-id="${esc(row.id)}">${esc(t('Depart vehicle', 'مغادرة المركبة'))}</button>` : ''}
      </div>
      ${isServiceState(row.status) ? `<p class="b09r-muted">${esc(t('Departure is refused while any cross-dock task on this vehicle is still open.', 'تُرفض المغادرة ما دامت أي مهمة عبور مباشر على هذه المركبة مفتوحة.'))}</p>` : ''}
    </div>`;
  }

  // ---------------------------------------------------------------- Staging Board

  const staging = S.createWorkspace({
    pageId: 'staging_board',
    prefix: 'sg',
    initialState: () => ({ allocations: [], lanes: [], selectedId: null, loading: true }),

    async onActivate(state, api) {
      const [allocations, locations] = await Promise.all([api.query('staging-allocations'), api.query('locations')]);
      state.allocations = Array.isArray(allocations) ? allocations : [];
      state.lanes = (Array.isArray(locations) ? locations : []).filter((row) => STAGING_TYPES.includes(row.locationType));
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading staging lanes…', 'جارِ تحميل ممرات التجهيز…'))}</p></div>`;
      if (!state.lanes.length) return `${scopeLine()}<div class="b09r-panel">${muted('No staging lanes are configured in this warehouse.', 'لا توجد ممرات تجهيز مهيأة في هذا المستودع.')}</div>`;

      const active = state.allocations.filter((row) => ACTIVE_STAGING.includes(row.status));
      const occupancy = state.lanes.map((lane) => {
        const rows = active.filter((row) => row.staging_location_id === lane.locationId);
        const used = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        return { lane, rows, used, capacity: lane.capacityUnits == null ? null : Number(lane.capacityUnits) };
      });
      const full = occupancy.filter((entry) => entry.capacity != null && entry.used >= entry.capacity).length;

      return `${scopeLine()}${kpis([
          ['Lanes', 'الممرات', num(state.lanes.length, 0)],
          ['Active allocations', 'تخصيصات نشطة', num(active.length, 0), active.length ? 'info' : ''],
          ['Units staged', 'وحدات مجهزة', num(occupancy.reduce((sum, entry) => sum + entry.used, 0))],
          ['Lanes at capacity', 'ممرات ممتلئة', num(full, 0), full ? 'danger' : 'ok'],
        ])}
        <div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Staging lanes', 'ممرات التجهيز'))}</h2></div>
          <div class="b09r-lanes" data-role="sg-lanes">${occupancy.map(laneCard).join('')}</div></div>
        ${allocateFormPanel(state)}`;
    },

    bind(container, state, api) {
      const reload = async () => {
        const allocations = await api.query('staging-allocations');
        state.allocations = Array.isArray(allocations) ? allocations : [];
      };

      const form = container.querySelector('[data-role="sg-allocate-form"]');
      if (form) form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          await api.call('wms:staging_allocate', {
            staging_location_id: data.staging_location_id, source_type: data.source_type,
            source_id: data.source_id, product_id: data.product_id || undefined, quantity: Number(data.quantity),
          });
          await reload();
        });
      });

      container.querySelectorAll('[data-role="sg-release"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        await api.call('wms:staging_release', { allocation_id: button.dataset.allocationId });
        await reload();
      })));
    },
  });

  function laneCard({ lane, rows, used, capacity }) {
    const ratio = capacity ? Math.min(100, (used / capacity) * 100) : null;
    const atCapacity = capacity != null && used >= capacity;
    return `<div class="b09r-lane${atCapacity ? ' b09r-lane-full' : ''}" data-role="sg-lane" data-location-id="${esc(lane.locationId)}">
      <div class="b09r-panel-head"><h2>${esc(lane.locationCode || lane.name)}</h2>${atCapacity ? badge(t('full', 'ممتلئ'), 'danger') : badge(lane.locationType, 'muted')}</div>
      <div class="b09r-lane-meter" data-role="sg-meter" data-used="${esc(String(used))}" data-capacity="${esc(capacity == null ? '' : String(capacity))}">
        ${ratio == null
          ? `<span class="b09r-muted">${esc(t('No capacity configured for this lane.', 'لا توجد سعة مهيأة لهذا الممر.'))}</span>`
          : `<span class="b09r-lane-fill" style="width:${ratio.toFixed(2)}%"></span><em>${esc(`${num(used)} / ${num(capacity)}`)}</em>`}
      </div>
      <div class="b09r-scan-list">${rows.length
        ? rows.map((row) => `<div class="b09r-scan-row">
            <span>${esc(row.source_type)}/${esc(row.source_id)}</span>
            <span>${esc(row.product_id || '—')}</span>
            <span>${esc(num(row.quantity))}</span>
            ${badge(row.status, STAGING_TONE[row.status] ?? '')}
            <button type="button" class="b09-button" data-role="sg-release" data-allocation-id="${esc(row.id)}">${esc(t('Release', 'تحرير'))}</button></div>`).join('')
        : muted('This lane is empty.', 'هذا الممر فارغ.')}</div></div>`;
  }

  function allocateFormPanel(state) {
    const laneOptions = state.lanes.map((lane) => [lane.locationId, `${lane.locationCode || lane.name} (${lane.locationType})`, `${lane.locationCode || lane.name} (${lane.locationType})`]);
    return `<form class="b09r-panel" data-role="sg-allocate-form">
      <div class="b09r-panel-head"><h2>${esc(t('Allocate staging', 'تخصيص تجهيز'))}</h2></div>
      <p>${esc(t('Allocating past a lane’s configured capacity is refused by the server.', 'تخصيص يتجاوز السعة المهيأة للممر يُرفض من الخادم.'))}</p>
      ${select('staging_location_id', 'Staging lane', 'ممر التجهيز', laneOptions, { required: true })}
      <div class="b09r-grid-2">${field('source_type', 'Source type', 'نوع المصدر', { required: true, placeholder: t('e.g. dock_appointment', 'مثال: dock_appointment') })}${field('source_id', 'Source', 'المصدر', { required: true })}</div>
      ${lookup('products', 'product_id', 'Product', 'المنتج')}
      ${field('quantity', 'Quantity', 'الكمية', { type: 'number', step: 'any', min: 0, required: true })}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Allocate to lane', 'تخصيص للممر'))}</button>
    </form>`;
  }

  // ---------------------------------------------------------------- Cross-Dock Workspace

  const crossdock = S.createWorkspace({
    pageId: 'crossdock_workspace',
    prefix: 'xd',
    initialState: () => ({ matches: [], appointments: [], selectedId: null, loading: true }),

    async onActivate(state, api) {
      const [matches, appointments] = await Promise.all([api.query('crossdock-matches'), api.query('dock-appointments')]);
      state.matches = Array.isArray(matches) ? matches : [];
      state.appointments = (Array.isArray(appointments) ? appointments : []).filter((row) => OPEN_APPOINTMENT.includes(row.status));
      if (state.selectedId && !state.matches.some((row) => row.id === state.selectedId)) state.selectedId = null;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading cross-dock matches…', 'جارِ تحميل مطابقات العبور المباشر…'))}</p></div>`;
      const open = state.matches.filter((row) => !['completed', 'cancelled'].includes(row.status));
      const selected = state.matches.find((row) => row.id === state.selectedId);
      return `${scopeLine()}${kpis([
          ['Matches', 'المطابقات', num(state.matches.length, 0)],
          ['Open', 'مفتوحة', num(open.length, 0), open.length ? 'info' : 'ok'],
          ['Awaiting Inventory', 'بانتظار المخزون', num(state.matches.filter((row) => row.status === 'awaiting_canonical').length, 0), 'info'],
          ['Completed', 'مكتملة', num(state.matches.filter((row) => row.status === 'completed').length, 0), 'ok'],
        ])}
        ${matchListPanel(state)}
        ${selected ? matchDetailPanel(selected) : ''}
        ${evaluateFormPanel(state)}`;
    },

    bind(container, state, api) {
      const reload = async () => {
        const matches = await api.query('crossdock-matches');
        state.matches = Array.isArray(matches) ? matches : [];
      };

      container.querySelectorAll('[data-role="xd-select"]').forEach((button) => button.addEventListener('click', () => {
        state.selectedId = button.dataset.matchId === state.selectedId ? null : button.dataset.matchId;
        api.paint();
      }));

      const form = container.querySelector('[data-role="xd-evaluate-form"]');
      if (form) form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          if (!data.product_id) throw new Error(t('Select a product from the search results.', 'اختر منتجاً من نتائج البحث.'));
          const match = await api.call('wms:crossdock_evaluate', {
            inbound_appointment_id: data.inbound_appointment_id || undefined,
            outbound_appointment_id: data.outbound_appointment_id || undefined,
            inbound_source_type: data.inbound_source_type, inbound_source_id: data.inbound_source_id,
            outbound_source_type: data.outbound_source_type, outbound_source_id: data.outbound_source_id,
            product_id: data.product_id, staging_location_id: data.staging_location_id || undefined,
            outbound_location_id: data.outbound_location_id,
            available_quantity: Number(data.available_quantity), demand_quantity: Number(data.demand_quantity),
          });
          await reload();
          state.selectedId = match.id;
        });
      });

      [['xd-approve', 'wms:crossdock_approve'], ['xd-request', 'wms:crossdock_request_post'], ['xd-cancel', 'wms:crossdock_cancel']].forEach(([role, actionId]) => {
        const button = container.querySelector(`[data-role="${role}"]`);
        if (button) button.addEventListener('click', () => api.guarded(async () => {
          await api.call(actionId, { match_id: button.dataset.matchId });
          await reload();
        }));
      });

      const ackForm = container.querySelector('[data-role="xd-ack-form"]');
      if (ackForm) ackForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(ackForm);
          await api.call('wms:crossdock_acknowledge_post', { match_id: ackForm.dataset.matchId, canonical_result_id: data.canonical_result_id });
          await reload();
        });
      });
    },
  });

  function matchListPanel(state) {
    if (!state.matches.length) return `<div class="b09r-panel">${muted('No cross-dock matches have been evaluated.', 'لم يتم تقييم أي مطابقات عبور مباشر.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Matches by eligibility', 'المطابقات حسب الأهلية'))}</h2></div>
      <div class="b09r-pool-list" data-role="xd-list">${state.matches.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row${row.id === state.selectedId ? ' b09r-pool-selected' : ''}" data-role="xd-select" data-match-id="${esc(row.id)}">
        <span class="b09r-score" data-role="xd-score">${esc(num(row.eligibilityScore, 0))}</span>
        <span class="b09r-pool-main"><strong>${esc(row.productId)}</strong><small>${esc(t('matched', 'مطابق'))} ${esc(num(row.matchedQuantity))} ${esc(t('of demand', 'من الطلب'))} ${esc(num(row.demandQuantity))}</small></span>
        ${badge(row.status, MATCH_TONE[row.status] ?? '')}</button>`).join('')}</div></div>`;
  }

  function matchDetailPanel(row) {
    const shortfall = Number(row.demandQuantity) - Number(row.matchedQuantity);
    return `<div class="b09r-panel" data-role="xd-detail">
      <div class="b09r-panel-head"><h2>${esc(row.productId)}</h2>${badge(row.status, MATCH_TONE[row.status] ?? '')}</div>
      ${kpis([
        ['Available', 'المتاح', num(row.availableQuantity)],
        ['Demand', 'الطلب', num(row.demandQuantity)],
        ['Matched', 'المطابق', num(row.matchedQuantity), 'ok'],
        ['Shortfall', 'النقص', num(shortfall), shortfall > 0 ? 'warn' : 'ok'],
      ])}
      <div class="b09r-scope-line">
        <span>${esc(t('Inbound', 'الوارد'))}: ${esc(row.inboundSourceType || '—')}/${esc(row.inboundSourceId || '—')}</span>
        <span>${esc(t('Outbound', 'الصادر'))}: ${esc(row.outboundSourceType || '—')}/${esc(row.outboundSourceId || '—')}</span>
        <span>${esc(t('Staging', 'التجهيز'))}: ${esc(row.stagingLocationId || '—')}</span>
        <span>${esc(t('Outbound location', 'موقع الصادر'))}: ${esc(row.outboundLocationId || '—')}</span></div>
      <div class="b09r-scope-line"><span>${esc(t('Proposed by', 'اقترحها'))}: ${esc(row.proposedBy || '—')}</span><span>${esc(t('Approved by', 'اعتمدها'))}: ${esc(row.approvedBy || '—')}</span><span>${esc(t('Eligibility', 'الأهلية'))}: ${esc(num(row.eligibilityScore, 2))}</span></div>

      ${['candidate', 'partial'].includes(row.status) ? `<p>${esc(t('Approval is a second person: whoever proposed the match cannot approve it. Approving generates a warehouse task and a canonical movement request — it moves no stock.', 'الاعتماد من شخص ثانٍ: من اقترح المطابقة لا يمكنه اعتمادها. الاعتماد يولّد مهمة مستودع وطلب حركة رسمي — ولا يحرّك أي مخزون.'))}</p>` : ''}
      ${row.status === 'task_created' ? canonicalPanel(row) : ''}
      ${row.status === 'awaiting_canonical' ? `<form class="b09r-subform" data-role="xd-ack-form" data-match-id="${esc(row.id)}">
        <div class="b09r-panel-head"><h2>${esc(t('Acknowledge canonical movement', 'الإقرار بالحركة الرسمية'))}</h2></div>
        <p>${esc(t('The server re-verifies the posted move’s product and quantity against this match before accepting it.', 'يعيد الخادم التحقق من منتج وكمية الحركة المرحّلة مقابل هذه المطابقة قبل قبولها.'))}</p>
        ${field('canonical_result_id', 'Canonical stock move id', 'معرّف الحركة المخزنية الرسمية', { required: true })}
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Acknowledge', 'إقرار'))}</button></form>` : ''}
      ${row.status === 'completed' ? `<p class="b09r-success" data-role="xd-completed">✓ ${esc(t('Cross-dock completed', 'اكتمل العبور المباشر'))}: ${esc(row.canonicalResultId || '—')}</p>` : ''}

      <div class="b09r-actions-row">
        ${['candidate', 'partial'].includes(row.status) ? `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="xd-approve" data-match-id="${esc(row.id)}">${esc(t('Approve match', 'اعتماد المطابقة'))}</button>` : ''}
        ${row.status === 'task_created' ? `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="xd-request" data-match-id="${esc(row.id)}">${esc(t('Request canonical movement', 'طلب الحركة الرسمية'))}</button>` : ''}
        ${['candidate', 'partial', 'approved', 'task_created', 'exception'].includes(row.status) ? `<button type="button" class="b09-button b09r-btn-xl" data-role="xd-cancel" data-match-id="${esc(row.id)}">${esc(t('Cancel match', 'إلغاء المطابقة'))}</button>` : ''}
      </div></div>`;
  }

  function canonicalPanel(row) {
    const request = row.canonicalRequest || {};
    return `<div class="b09r-group" data-role="xd-canonical">
      <div class="b09r-group-head">${badge(t('warehouse task created — Inventory still posts the move', 'أُنشئت مهمة مستودع — ويبقى المخزون هو من يرحّل الحركة'), 'info')}</div>
      <div class="b09r-scan-row"><span>stock:move:post</span><span>${esc(request.product_id || row.productId)}</span><span>${esc(num(request.product_qty ?? row.matchedQuantity))}</span><span>${esc(request.location_id || '—')} → ${esc(request.location_dest_id || '—')}</span></div></div>`;
  }

  function evaluateFormPanel(state) {
    const inbound = state.appointments.filter((row) => row.appointmentType === 'inbound').map((row) => [row.id, `${row.vehicleReference || row.carrierName || row.id.slice(0, 8)} · ${when(row.expectedArrival)}`, `${row.vehicleReference || row.carrierName || row.id.slice(0, 8)} · ${when(row.expectedArrival)}`]);
    const outbound = state.appointments.filter((row) => row.appointmentType === 'outbound').map((row) => [row.id, `${row.vehicleReference || row.carrierName || row.id.slice(0, 8)} · ${when(row.expectedDeparture)}`, `${row.vehicleReference || row.carrierName || row.id.slice(0, 8)} · ${when(row.expectedDeparture)}`]);
    if (!inbound.length || !outbound.length) {
      return `<div class="b09r-panel">${muted('Cross-docking needs both an open inbound and an open outbound appointment.', 'العبور المباشر يحتاج موعداً وارداً وآخر صادراً مفتوحين.')}</div>`;
    }
    return `<form class="b09r-panel" data-role="xd-evaluate-form">
      <div class="b09r-panel-head"><h2>${esc(t('Evaluate a match', 'تقييم مطابقة'))}</h2></div>
      <p>${esc(t('Eligibility scores timing and how much of the demand the inbound can cover. Quality-held stock is refused outright.', 'تُقيَّم الأهلية حسب التوقيت وحجم تغطية الوارد للطلب. ويُرفض المخزون المحجوز لأسباب جودة تماماً.'))}</p>
      <div class="b09r-grid-2">${select('inbound_appointment_id', 'Inbound appointment', 'الموعد الوارد', inbound, { required: true })}${select('outbound_appointment_id', 'Outbound appointment', 'الموعد الصادر', outbound, { required: true })}</div>
      <div class="b09r-grid-2">${field('inbound_source_type', 'Inbound source type', 'نوع مصدر الوارد', { required: true })}${field('inbound_source_id', 'Inbound source', 'مصدر الوارد', { required: true })}</div>
      <div class="b09r-grid-2">${field('outbound_source_type', 'Outbound source type', 'نوع مصدر الصادر', { required: true })}${field('outbound_source_id', 'Outbound source', 'مصدر الصادر', { required: true })}</div>
      ${lookup('products', 'product_id', 'Product', 'المنتج')}
      ${lookup('locations', 'staging_location_id', 'Staging location', 'موقع التجهيز')}
      ${lookup('locations', 'outbound_location_id', 'Outbound location', 'موقع الصادر')}
      <div class="b09r-grid-2">${field('available_quantity', 'Available', 'المتاح', { type: 'number', step: 'any', min: 0, required: true })}${field('demand_quantity', 'Demand', 'الطلب', { type: 'number', step: 'any', min: 0, required: true })}</div>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Evaluate match', 'تقييم المطابقة'))}</button>
    </form>`;
  }

  root.Build09DockSchedule = schedule;
  root.Build09DockCheckin = checkin;
  root.Build09StagingBoard = staging;
  root.Build09CrossdockWorkspace = crossdock;
  S.registerOverride('dock_schedule', schedule);
  S.registerOverride('dock_checkin', checkin);
  S.registerOverride('staging_board', staging);
  S.registerOverride('crossdock_workspace', crossdock);
})(window);
