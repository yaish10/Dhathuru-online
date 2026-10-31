/* Operations readiness helpers — Cursor 2026-10-24.
   Client compute + RPC wrappers; soft-falls back when 0055+ not applied.
   Lifecycle vs conditions: Delayed is a condition, never a lifecycle state. */
(function () {
  var LIFECYCLE = ["Scheduled", "Cleared", "Boarding", "Departed", "Arrived", "Completed", "Cancelled"];
  var CLOSED_LIFE = ["Completed", "Cancelled"];

  function db() { return window.veyoraDb; }

  function rpc(name, args) {
    return db().rpc(name, args).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
  }

  function missingRpc(err) {
    return err && /function|does not exist|schema cache|Could not find/i.test(String(err.message || err));
  }

  /** Map legacy trip.status + cleared_at → lifecycle label. */
  function lifecycleOf(trip) {
    var r = trip.raw || trip;
    if (r.lifecycle && LIFECYCLE.indexOf(r.lifecycle) >= 0) return r.lifecycle;
    var st = r.status || trip.status || "Scheduled";
    if (st === "Cancelled") return "Cancelled";
    if (st === "Completed") return "Completed";
    if (st === "Arrived") return "Arrived";
    if (st === "Departed" || st === "In transit" || st === "En Route") return "Departed";
    if (st === "Boarding") return "Boarding";
    if (r.cleared_at) return "Cleared";
    if (st === "Delayed" || st === "On time" || st === "Scheduled") return r.cleared_at ? "Cleared" : "Scheduled";
    return "Scheduled";
  }

  function delayCondition(trip) {
    var r = trip.raw || trip;
    if (r.ops_flags && r.ops_flags.delay) return r.ops_flags.delay;
    if ((r.status || trip.status) === "Delayed") return "delayed";
    return "on_time";
  }

  function conditionsOf(trip) {
    var r = trip.raw || trip;
    var flags = Object.assign({}, r.ops_flags || {});
    if ((r.status || trip.status) === "Delayed") flags.delay = "delayed";
    if (!flags.delay) flags.delay = "on_time";
    return flags;
  }

  function isOpsReadOnly(trip) {
    var life = lifecycleOf(trip);
    return CLOSED_LIFE.indexOf(life) >= 0;
  }

  function canEditAfterArrive(trip) {
    return lifecycleOf(trip) === "Arrived";
  }

  function issue(code, severity, message, fix) {
    return { code: code, severity: severity, message: message, fix: fix || null };
  }

  /**
   * Client-side readiness (fallback when trip_readiness RPC missing).
   * ctx: { vessels, crewMixFn, tripCrewCount, captainId, booked, capacity, defectsByVessel, rules }
   */
  function compute(trip, ctx) {
    ctx = ctx || {};
    var r = trip.raw || trip;
    var issues = [];
    var vessel = (ctx.vessels || []).filter(function (v) { return v.id === (trip.vessel_id || r.vessel_id); })[0];
    var rules = ctx.rules || {};

    if (!trip.vessel_id && !r.vessel_id) {
      issues.push(issue("no_vessel", "blocking", "Assign a vessel.", "vessel"));
    } else if (vessel) {
      if (vessel.status === "Out of service") {
        issues.push(issue("vessel_oos", "blocking", (vessel.name || "Vessel") + " is out of service.", "vessel"));
      } else if (vessel.status === "Maintenance" || vessel.status === "Restricted") {
        issues.push(issue("vessel_maint", "blocking", (vessel.name || "Vessel") + " is " + String(vessel.status).toLowerCase() + ".", "vessel"));
      }
      if (ctx.defectsByVessel && ctx.defectsByVessel[vessel.id]) {
        issues.push(issue("stopping_defect", "blocking", (vessel.name || "Vessel") + " has a stopping defect.", "safety"));
      }
    }

    var needCaptain = rules.crew !== false;
    var captainId = trip.raw && trip.raw.captain_id != null ? trip.raw.captain_id : trip.captain_id;
    if (needCaptain && !captainId && !trip.captain) {
      issues.push(issue("no_captain", "blocking", "Assign a captain.", "crew"));
    }

    var mix = typeof ctx.crewMixFn === "function" ? ctx.crewMixFn(trip) : [];
    if (mix && mix.length) {
      var need = mix.reduce(function (n, x) { return n + (Number(x.n) || 0); }, 0);
      var have = ctx.tripCrewCount != null ? ctx.tripCrewCount : ((trip.captain ? 1 : 0) + (trip.crewCount || 0));
      if (need && have < need) {
        issues.push(issue("crew_short", "blocking", "Crew short: " + have + " of " + need + " required.", "crew"));
      }
    }

    var booked = trip.booked != null ? Number(trip.booked) : (ctx.booked != null ? Number(ctx.booked) : null);
    var capacity = trip.capacity != null ? Number(trip.capacity) : (ctx.capacity != null ? Number(ctx.capacity) : (vessel && vessel.passenger_capacity != null ? Number(vessel.passenger_capacity) : null));
    if (booked != null && capacity != null && booked > capacity) {
      issues.push(issue("over_capacity", "blocking", "Passengers (" + booked + ") exceed capacity (" + capacity + ").", "pax"));
    } else if (booked != null && capacity != null && capacity > 0 && booked / capacity >= 0.95) {
      issues.push(issue("near_capacity", "warning", "Almost full (" + booked + " / " + capacity + ").", "pax"));
    }

    if (rules.weather !== false) {
      issues.push(issue("weather_unconfirmed", "warning", "Confirm weather check before clearance.", "safety"));
    }
    if (rules.checklist !== false) {
      issues.push(issue("checklist_missing", "warning", "Confirm safety checklist before clearance.", "safety"));
    }

    var blocking = issues.filter(function (i) { return i.severity === "blocking"; }).length;
    var warnings = issues.filter(function (i) { return i.severity === "warning"; }).length;
    var summary = {
      vessel_ok: !issues.some(function (i) { return i.fix === "vessel" && i.severity === "blocking"; }),
      crew_ok: !issues.some(function (i) { return i.fix === "crew" && i.severity === "blocking"; }),
      pax_ok: !issues.some(function (i) { return i.fix === "pax" && i.severity === "blocking"; }),
      safety_ok: !issues.some(function (i) { return (i.fix === "safety" || i.code === "stopping_defect") && i.severity === "blocking"; })
    };
    return {
      ready: blocking === 0,
      blocking: blocking,
      warnings: warnings,
      issues: issues,
      summary: summary,
      source: "client"
    };
  }

  function fetchReadiness(tripId, fallbackCompute) {
    return rpc("trip_readiness", { p_trip: tripId }).then(function (data) {
      if (data && typeof data === "object") {
        data.source = "rpc";
        return data;
      }
      return fallbackCompute();
    }).catch(function (e) {
      if (missingRpc(e) && typeof fallbackCompute === "function") return fallbackCompute();
      throw e;
    });
  }

  function assignVessel(tripId, vesselId, reason, expectedUpdatedAt) {
    return rpc("assign_trip_vessel", {
      p_trip: tripId,
      p_vessel: vesselId,
      p_reason: reason || null,
      p_expected_updated_at: expectedUpdatedAt || null
    }).catch(function (e) {
      if (!missingRpc(e)) throw e;
      return db().from("trips").update({ vessel_id: vesselId }).eq("id", tripId).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return res.data;
      });
    });
  }

  function unassignVessel(tripId, reason, expectedUpdatedAt) {
    return rpc("unassign_trip_vessel", {
      p_trip: tripId,
      p_reason: reason || null,
      p_expected_updated_at: expectedUpdatedAt || null
    }).catch(function (e) {
      if (!missingRpc(e)) throw e;
      return db().from("trips").update({ vessel_id: null }).eq("id", tripId).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return res.data;
      });
    });
  }

  function clearTrip(tripId, checks, note, overrideReason) {
    var args = { p_id: tripId, p_checks: checks || {}, p_note: note || null };
    if (overrideReason) args.p_override_reason = overrideReason;
    return rpc("clear_trip", args).catch(function (e) {
      // Older clear_trip has no override arg
      if (overrideReason && /p_override_reason|unexpected|argument/i.test(e.message)) {
        return rpc("clear_trip", { p_id: tripId, p_checks: checks || {}, p_note: (note || "") + (overrideReason ? " OVERRIDE: " + overrideReason : "") });
      }
      throw e;
    });
  }

  function setLifecycle(tripId, lifecycle, reason, expectedUpdatedAt) {
    return rpc("set_trip_lifecycle", {
      p_trip: tripId,
      p_lifecycle: lifecycle,
      p_reason: reason || null,
      p_expected_updated_at: expectedUpdatedAt || null
    }).catch(function (e) {
      if (!missingRpc(e)) throw e;
      // Map lifecycle → legacy status (never send Delayed here)
      var map = { Cleared: "Scheduled", Boarding: "Boarding", Departed: "Departed", Arrived: "Arrived", Completed: "Completed", Cancelled: "Cancelled", Scheduled: "Scheduled" };
      return rpc("set_trip_status", { p_id: tripId, p_status: map[lifecycle] || lifecycle, p_reason: reason || null });
    });
  }

  function setCondition(tripId, flagsPatch, reason) {
    return rpc("set_trip_condition", {
      p_trip: tripId,
      p_flags_patch: flagsPatch || {},
      p_reason: reason || null
    }).catch(function (e) {
      if (!missingRpc(e)) throw e;
      if (flagsPatch && flagsPatch.delay === "delayed") {
        return rpc("set_trip_status", { p_id: tripId, p_status: "Delayed", p_reason: reason || "Delayed" });
      }
      throw e;
    });
  }

  function reconcile(tripId, payload) {
    return rpc("reconcile_trip_passengers", { p_trip: tripId, p_payload: payload || {} });
  }

  function completeTrip(tripId, payload) {
    return rpc("complete_trip", { p_trip: tripId, p_payload: payload || {} }).catch(function (e) {
      if (!missingRpc(e)) throw e;
      return rpc("set_trip_status", { p_id: tripId, p_status: "Completed", p_reason: (payload && payload.note) || null });
    });
  }

  function arriveTrip(tripId, actualArrive, note) {
    return rpc("arrive_trip", { p_trip: tripId, p_actual_arrive: actualArrive || null, p_note: note || null }).catch(function (e) {
      if (!missingRpc(e)) throw e;
      return rpc("set_trip_status", { p_id: tripId, p_status: "Arrived", p_reason: note || null });
    });
  }

  function recordDisruption(tripId, payload) {
    return rpc("record_trip_disruption", { p_trip: tripId, p_payload: payload || {} });
  }

  function reportIncident(companyId, row) {
    return rpc("report_incident", { p_company: companyId, p_row: row });
  }

  function readinessTone(pack) {
    if (!pack) return "unknown";
    if (pack.blocking > 0) return "bad";
    if (pack.warnings > 0) return "warn";
    return "ok";
  }

  function readinessLabel(pack) {
    var t = readinessTone(pack);
    if (t === "ok") return "Ready";
    if (t === "warn") return "Check";
    if (t === "bad") return "Blocked";
    return "—";
  }

  window.VeyoraOpsReadiness = {
    LIFECYCLE: LIFECYCLE,
    lifecycleOf: lifecycleOf,
    delayCondition: delayCondition,
    conditionsOf: conditionsOf,
    isOpsReadOnly: isOpsReadOnly,
    canEditAfterArrive: canEditAfterArrive,
    compute: compute,
    fetchReadiness: fetchReadiness,
    assignVessel: assignVessel,
    unassignVessel: unassignVessel,
    clearTrip: clearTrip,
    setLifecycle: setLifecycle,
    setCondition: setCondition,
    reconcile: reconcile,
    completeTrip: completeTrip,
    arriveTrip: arriveTrip,
    recordDisruption: recordDisruption,
    reportIncident: reportIncident,
    readinessTone: readinessTone,
    readinessLabel: readinessLabel,
    missingRpc: missingRpc
  };
})();
