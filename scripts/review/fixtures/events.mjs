'use strict';

// Review Freeze — events fixtures (BUILD-12 event management pack).
//
// Disposable, fictional demo data for human UI/functional review of the
// events:* actions registered in platform/build12/index.mjs, against the
// tables created by
// database/migrations/089_build12_ai_people_marketing_events_pack.mjs:
//   build12_events, build12_event_sessions, build12_event_registrations.
//
// Two requested bullets have no literal match in the real schema's CHECK
// constraints, so they are approximated below rather than silently invented
// — both are flagged again in the returned summary.notes:
//   - "approved event": build12_events.status only allows
//     draft|published|ongoing|completed|cancelled — there is no distinct
//     "approved" state. Mapped to 'published', the nearest real equivalent
//     (an event that has cleared review and gone live).
//   - "no-show example": build12_event_registrations.status only allows
//     registered|waitlisted|checked_in|cancelled — there is no "no_show"
//     state. Modeled as a 'registered' registration on an event whose
//     ends_at already precedes `now` (the event happened; the attendee was
//     never checked in).
//
// All rows are idempotent (ON CONFLICT(id) DO NOTHING) and every id is
// prefixed `rev_` so they are trivially distinguishable from operational
// data and easy to purge from a disposable review database.

const REVIEW_ACTOR = 'system:review-fixture';

function isoPlusDays(baseIso, days) {
  return new Date(new Date(baseIso).getTime() + days * 86400000).toISOString();
}

/**
 * Seed a handful of fictional event fixtures spanning the registration
 * lifecycle: planned, approved/published, open registrations, near
 * capacity, waitlisted, checked-in, and a completed no-show.
 *
 * @returns {Promise<{summary: object}>}
 */
export async function seedEventsFixtures(dialect, { tenantId, companyId, branchId, now } = {}) {
  // companyId/branchId accepted for signature symmetry with the other review
  // fixture seeders; build12_events / build12_event_registrations (migration
  // 089) are tenant-scoped only.
  void companyId;
  void branchId;
  const ts = now || new Date().toISOString();

  const insertEvent = dialect.prepare(`
    INSERT INTO build12_events
      (id, tenant_id, name, status, description, venue, capacity, starts_at, ends_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertRegistration = dialect.prepare(`
    INSERT INTO build12_event_registrations
      (id, tenant_id, event_id, session_id, attendee_name, attendee_email, status, checked_in_at, registered_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  function seedRegistered(eventId, count) {
    for (let n = 1; n <= count; n += 1) {
      insertRegistration.run(
        `${eventId}_reg_${n}`, tenantId, eventId, `[DEMO] Attendee ${n}`,
        `${eventId}.attendee${n}@review.invalid`, 'registered', null, ts,
      );
    }
  }

  // 1. Planned event — still in early draft, not yet published.
  const plannedId = 'rev_evt_planned';
  insertEvent.run(
    plannedId, tenantId, '[DEMO] Autumn Product Preview (Planning)', 'draft',
    'Fictional demo event still being planned. Review environment only.', '[DEMO] Al-Warsha Showroom',
    50, isoPlusDays(ts, 30), isoPlusDays(ts, 31), REVIEW_ACTOR, ts, ts,
  );

  // 2. Approved event — mapped to 'published' (see file header note).
  const approvedId = 'rev_evt_approved';
  insertEvent.run(
    approvedId, tenantId, '[DEMO] Al-Warsha Open House (Approved)', 'published',
    'Fictional demo event approved and published. Review environment only.', '[DEMO] Al-Warsha Main Hall',
    100, isoPlusDays(ts, 10), isoPlusDays(ts, 10.5), REVIEW_ACTOR, ts, ts,
  );

  // 3. Event with open registrations — well under capacity.
  const openRegId = 'rev_evt_open_registration';
  insertEvent.run(
    openRegId, tenantId, '[DEMO] Fiber Laser Demo Day', 'published',
    'Fictional demo event still accepting registrations. Review environment only.', '[DEMO] Workshop Floor B',
    40, isoPlusDays(ts, 20), isoPlusDays(ts, 20.25), REVIEW_ACTOR, ts, ts,
  );
  seedRegistered(openRegId, 2);

  // 4. Event near capacity — 7 of 8 seats booked.
  const nearCapacityId = 'rev_evt_near_capacity';
  insertEvent.run(
    nearCapacityId, tenantId, '[DEMO] CNC Safety Workshop', 'published',
    'Fictional demo event nearly full. Review environment only.', '[DEMO] Training Room 2',
    8, isoPlusDays(ts, 5), isoPlusDays(ts, 5.25), REVIEW_ACTOR, ts, ts,
  );
  seedRegistered(nearCapacityId, 7);

  // 5. Event fully booked plus one waitlisted registration.
  const waitlistId = 'rev_evt_waitlist_demo';
  insertEvent.run(
    waitlistId, tenantId, '[DEMO] Metal Fabrication Masterclass', 'published',
    'Fictional demo event at capacity with a waitlist. Review environment only.', '[DEMO] Fabrication Bay',
    5, isoPlusDays(ts, 3), isoPlusDays(ts, 3.25), REVIEW_ACTOR, ts, ts,
  );
  seedRegistered(waitlistId, 5);
  insertRegistration.run(
    'rev_evt_waitlist_demo_reg_waitlisted', tenantId, waitlistId, '[DEMO] Attendee Waitlisted',
    `${waitlistId}.attendee.waitlisted@review.invalid`, 'waitlisted', null, ts,
  );

  // 6. Event with a checked-in attendee — currently ongoing.
  const checkinId = 'rev_evt_checkin_demo';
  insertEvent.run(
    checkinId, tenantId, '[DEMO] Welding Certification Session', 'ongoing',
    'Fictional demo event in progress with a checked-in attendee. Review environment only.', '[DEMO] Welding Bay',
    30, isoPlusDays(ts, -0.25), isoPlusDays(ts, 0.25), REVIEW_ACTOR, ts, ts,
  );
  insertRegistration.run(
    'rev_evt_checkin_demo_reg_checked_in', tenantId, checkinId, '[DEMO] Attendee Checked-In',
    `${checkinId}.attendee.checkedin@review.invalid`, 'checked_in', ts, ts,
  );

  // 7. Completed event with a no-show — modeled as a 'registered'
  //    registration that was never checked in (see file header note).
  const noShowId = 'rev_evt_completed_noshow';
  insertEvent.run(
    noShowId, tenantId, '[DEMO] Electrical Basics Info Session', 'completed',
    'Fictional demo event already completed. Review environment only.', '[DEMO] Training Room 1',
    20, isoPlusDays(ts, -10), isoPlusDays(ts, -9.75), REVIEW_ACTOR, ts, ts,
  );
  insertRegistration.run(
    'rev_evt_completed_noshow_reg_noshow', tenantId, noShowId, '[DEMO] Attendee No-Show',
    `${noShowId}.attendee.noshow@review.invalid`, 'registered', null, ts,
  );

  const summary = {
    tenantId,
    events: {
      planned: plannedId,
      approved: approvedId,
      openRegistration: openRegId,
      nearCapacity: nearCapacityId,
      waitlistDemo: waitlistId,
      checkinDemo: checkinId,
      completedNoShow: noShowId,
    },
    notes: [
      "'approved event' has no literal status in build12_events; mapped to 'published'.",
      "'no-show example' has no literal status in build12_event_registrations; modeled as a 'registered' row on a completed event.",
    ],
  };
  return { summary };
}
