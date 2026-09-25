/* Lally's Cakes & Sweets — owner order board
 * Plain JS, no build step. Talks to Supabase REST (PostgREST) + Auth.
 * Access is enforced server-side by RLS (owner emails only). */
(function () {
  "use strict";

  var SUPABASE_URL = "https://xpvytjomwmvycxfgyxcg.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwdnl0am9td212eWN4Zmd5eGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjkxODQsImV4cCI6MjEwNTgwNTE4NH0.5X1xXV-pZzBbDxMm_uuBhMsHEqYXCvQk--6ezya2LB0";
  var OWNERS = [
    "devonl721@gmail.com",
    "lallyscakesandsweets@gmail.com",
    "devonl721@icloud.com"
  ];
  var SESSION_KEY = "lallys_admin_session";
  var PREFS_KEY = "lallys_admin_prefs";
  var TZ = "America/New_York";

  /* ---------------- Stages ---------------- */
  var STAGES = [
    { key: "new", label: "New", short: "New" },
    { key: "contacted", label: "Contacted / Quoted", short: "Quoted" },
    { key: "confirmed", label: "Confirmed", short: "Confirmed" },
    { key: "baking", label: "Baking", short: "Baking" },
    { key: "ready", label: "Ready for pickup", short: "Ready" },
    { key: "completed", label: "Picked up", short: "Picked up" },
    { key: "declined", label: "Declined", short: "Declined", closed: true },
    { key: "archived", label: "Archived", short: "Archived", closed: true }
  ];
  var FLOW = ["new", "contacted", "confirmed", "baking", "ready", "completed"];
  var OPEN_STAGES = ["new", "contacted", "confirmed", "baking", "ready"];
  var DEPOSIT_STAGES = ["confirmed", "baking", "ready"];
  var LEGACY_TO_NEW = { replied: "contacted", booked: "confirmed" };
  // When the DB hasn't been migrated yet, only these stages can be saved.
  var NEW_TO_LEGACY = { new: "new", contacted: "replied", confirmed: "booked", archived: "archived" };
  var SOURCES = { website: "Website", phone: "Phone", facebook: "Facebook", in_person: "In person", other: "Other" };
  var NEW_COLUMNS = ["event_type", "pickup_date", "pickup_time", "items", "price", "deposit_paid",
    "deposit_amount", "paid_in_full", "priority", "source", "updated_at"];

  function stage(key) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return STAGES[i];
    return { key: key, label: key, short: key };
  }

  /* ---------------- State ---------------- */
  var state = {
    session: null,
    rows: [],
    legacy: false, // true when migration 002 hasn't been applied
    view: "board",
    showClosed: false,
    listFilter: "active",
    listSort: "pickup",
    search: "",
    editingId: null // null = closed, "new" = creating
  };

  /* ---------------- DOM ---------------- */
  function $(id) { return document.getElementById(id); }
  var authWrap = $("admin-auth"), appWrap = $("admin-app"), hero = $("admin-hero");
  var loginStatus = $("login-status"), appStatus = $("app-status");
  var signinPanel = $("signin-panel"), resetPanel = $("reset-panel");
  var forgotPanel = $("forgot-password-panel"), toggleForgot = $("toggle-forgot-password");
  var modal = $("order-modal"), orderForm = $("order-form");
  var toastEl = $("toast");

  /** Small DOM builder. Strings become text nodes (safe for customer input). */
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === "string" || typeof child === "number"
      ? document.createTextNode(String(child)) : child);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------------- Toast / alerts ---------------- */
  var toastTimer = null;
  function toast(msg, kind) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "toast is-visible" + (kind === "error" ? " toast-error" : " toast-ok");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-visible");
      setTimeout(function () { toastEl.hidden = true; }, 250);
    }, kind === "error" ? 5000 : 2200);
  }
  function setAlert(el, msg, kind) {
    if (!el) return;
    if (!msg) { el.className = "admin-alert"; clear(el); return; }
    el.className = "admin-alert is-visible" + (kind ? " admin-alert-" + kind : "");
    clear(el);
    append(el, msg);
  }
  function setLoginStatus(message, isError) {
    if (!loginStatus) return;
    if (!message) { loginStatus.classList.remove("is-visible", "is-error"); loginStatus.textContent = ""; return; }
    loginStatus.classList.add("is-visible");
    loginStatus.classList.toggle("is-error", !!isError);
    loginStatus.textContent = message;
  }

  /* ---------------- Session / auth ---------------- */
  function anonHeaders() {
    return { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  }
  function userHeaders(token) {
    return { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" };
  }
  function getSession() {
    try { var raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveSession(s) { state.session = s; try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { state.session = null; try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function decodeJwtEmail(token) {
    try {
      var p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (p.length % 4) p += "=";
      var json = JSON.parse(atob(p));
      return json.email || (json.user_metadata && json.user_metadata.email) || "";
    } catch (e) { return ""; }
  }
  function isOwnerEmail(email) {
    var lower = String(email || "").toLowerCase();
    return OWNERS.some(function (o) { return o === lower; });
  }
  function adminRedirectUrl() {
    var url = window.location.origin + window.location.pathname.replace(/[^/]*$/, "admin.html");
    if (!/admin\.html$/i.test(url)) url = window.location.origin + "/admin.html";
    return url;
  }
  function clearHash() { history.replaceState(null, "", window.location.pathname + window.location.search); }

  function sessionFromTokenResponse(data, fallbackEmail) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: { email: (data.user && data.user.email) || decodeJwtEmail(data.access_token) || fallbackEmail || "" }
    };
  }

  function parseJson(res) {
    return res.text().then(function (t) {
      var data = null;
      try { data = t ? JSON.parse(t) : null; } catch (e) { data = { message: t }; }
      return { ok: res.ok, status: res.status, data: data };
    });
  }

  function friendlyAuthError(data, fallback) {
    var raw = (data && (data.error_description || data.msg || data.error || data.message)) || "";
    var lower = String(raw).toLowerCase();
    if (/invalid login|invalid_grant|invalid credentials/.test(lower)) return "Invalid email or password. Try again, or use “Forgot password?”.";
    if (/not confirmed/.test(lower)) return "Please confirm your email first (check your inbox), then sign in.";
    if (/rate limit|email rate/.test(lower)) return "Too many emails were sent recently. Wait about an hour before requesting another reset email. Signing in with your password still works.";
    if (/should be different|same password/.test(lower)) return "Your new password must be different from the old one.";
    if (/password/.test(lower) && /(weak|short|at least|characters)/.test(lower)) return "Please choose a stronger password (at least 8 characters).";
    if (/expired|invalid.*(token|jwt)/.test(lower)) return "That link or session has expired. Request a new reset email.";
    return raw || fallback || "Something went wrong. Try again.";
  }

  var refreshing = null;
  function refreshSession() {
    var s = state.session || getSession();
    if (!s || !s.refresh_token) return Promise.reject(new Error("No refresh token"));
    if (refreshing) return refreshing;
    refreshing = fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: anonHeaders(), body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(parseJson).then(function (r) {
      if (!r.ok || !r.data || !r.data.access_token) throw new Error("Refresh failed");
      var next = sessionFromTokenResponse(r.data, s.user && s.user.email);
      saveSession(next);
      return next;
    }).finally(function () { refreshing = null; });
    return refreshing;
  }

  function validSession() {
    var s = state.session || getSession();
    if (!s || !s.access_token) return Promise.resolve(null);
    if (s.expires_at && s.expires_at - 60000 > Date.now()) { state.session = s; return Promise.resolve(s); }
    return refreshSession().catch(function () { clearSession(); return null; });
  }

  /** Authenticated REST call. Retries once after refreshing an expired token. */
  function api(method, path, body, prefer, retried) {
    return validSession().then(function (s) {
      if (!s) throw { kind: "auth" };
      var headers = userHeaders(s.access_token);
      if (prefer) headers.Prefer = prefer;
      return fetch(SUPABASE_URL + path, {
        method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body)
      }).then(parseJson).then(function (r) {
        if (r.status === 401 && !retried) {
          return refreshSession().then(function () { return api(method, path, body, prefer, true); },
            function () { clearSession(); throw { kind: "auth" }; });
        }
        if (r.status === 401) throw { kind: "auth" };
        if (r.status === 403) throw { kind: "forbidden", data: r.data };
        if (!r.ok) throw { kind: "http", status: r.status, data: r.data };
        return r.data;
      });
    });
  }

  function isMissingColumnError(err) {
    var d = err && err.data;
    if (!d) return false;
    var msg = String(d.message || "");
    return d.code === "42703" || d.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(msg);
  }
  function isStatusCheckError(err) {
    var d = err && err.data;
    return !!d && d.code === "23514";
  }
  function describeError(err) {
    if (!err) return "Something went wrong.";
    if (err.kind === "auth") return "Your session expired. Please sign in again.";
    if (err.kind === "forbidden") return "Not allowed — owner accounts only.";
    if (isMissingColumnError(err) || isStatusCheckError(err)) return "The database needs the order-board upgrade (migration 002) before this can be saved.";
    if (err.kind === "http") return "Save failed (" + err.status + "). Try again.";
    return "Network problem — check your connection and try again.";
  }
  function handleAuthLoss(err) {
    if (err && err.kind === "auth") {
      clearSession();
      showLogin("Your session expired. Please sign in again.", true);
      return true;
    }
    return false;
  }

  /* ---------------- Dates ---------------- */
  function todayISO() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function addDays(iso, n) {
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function isISODate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function fmtDay(iso, opts) {
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).toLocaleDateString("en-US",
      Object.assign({ timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }, opts || {}));
  }
  function fmtTime(t) {
    if (!t) return "";
    var m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return String(t);
    var hh = +m[1], ampm = hh >= 12 ? "PM" : "AM";
    hh = hh % 12 || 12;
    return hh + ":" + m[2] + " " + ampm;
  }
  function fmtStamp(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return iso; }
  }
  function money(n) {
    if (n === null || n === undefined || n === "" || isNaN(+n)) return "";
    var v = +n;
    return "$" + (v % 1 ? v.toFixed(2) : String(v));
  }

  /* ---------------- Row helpers ---------------- */
  function normalize(row) {
    var r = Object.assign({}, row);
    r.status = LEGACY_TO_NEW[r.status] || r.status || "new";
    if (STAGES.every(function (s) { return s.key !== r.status; })) r.status = "new";
    if (state.legacy) {
      r.source = r.source || "website";
      r.deposit_paid = !!r.deposit_paid;
      r.paid_in_full = !!r.paid_in_full;
      r.priority = !!r.priority;
    }
    return r;
  }
  /** Pickup date used for scheduling: pickup_date, else a clean event_date. */
  function dueDate(r) {
    if (r.pickup_date) return String(r.pickup_date).slice(0, 10);
    if (isISODate(r.event_date)) return r.event_date;
    return null;
  }
  function isOpen(r) { return OPEN_STAGES.indexOf(r.status) !== -1; }
  function needsDeposit(r) { return DEPOSIT_STAGES.indexOf(r.status) !== -1 && !r.deposit_paid && !r.paid_in_full; }
  /** Balance due at pickup, or null when no price has been set. */
  function balanceDue(r) {
    if (r.price === null || r.price === undefined || r.price === "" || isNaN(+r.price)) return null;
    if (r.paid_in_full) return 0;
    var paid = r.deposit_paid && r.deposit_amount ? +r.deposit_amount : 0;
    return Math.max(0, Math.round((+r.price - paid) * 100) / 100);
  }
  function balanceLine(r) {
    var b = balanceDue(r);
    if (b === null || r.status === "declined" || r.status === "archived") return null;
    if (b === 0) return h("div", { class: "card-balance is-paid", text: "Paid in full · $0 due" });
    return h("div", { class: "card-balance" + (r.status === "completed" ? " is-late" : "") },
      (r.status === "completed" ? "Still owed: " : "Due at pickup: "), h("b", { text: money(b) }));
  }
  function summaryText(r) {
    var bits = [];
    if (r.items) return r.items;
    if (r.event_type) bits.push(r.event_type);
    if (r.message) bits.push(r.message);
    return bits.join(" — ");
  }
  function preview(text, max) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length <= max ? t : t.slice(0, max - 1) + "…";
  }
  function dueInfo(r) {
    var d = dueDate(r);
    if (!d) {
      if (r.event_date) return { text: "Event: " + r.event_date, cls: "due-none" };
      return { text: "No pickup date", cls: "due-none" };
    }
    var today = todayISO();
    var time = fmtTime(r.pickup_time);
    var label, cls;
    var active = isOpen(r);
    if (d < today && active) { label = "Overdue · " + fmtDay(d); cls = "due-overdue"; }
    else if (d === today) { label = "Today"; cls = active ? "due-today" : "due-later"; }
    else if (d === addDays(today, 1)) { label = "Tomorrow"; cls = active ? "due-tomorrow" : "due-later"; }
    else { label = fmtDay(d); cls = "due-later"; }
    if (!r.pickup_date) label = "Event: " + label;
    return { text: label + (time ? " · " + time : ""), cls: cls };
  }
  function depositBadge(r) {
    if (r.paid_in_full) return h("span", { class: "badge badge-paid", text: "Paid in full" });
    if (r.deposit_paid) return h("span", { class: "badge badge-paid", text: "Deposit" + (r.deposit_amount ? " " + money(r.deposit_amount) : "") + " ✓" });
    if (r.status === "new" || r.status === "declined" || r.status === "archived") return null;
    if (r.status === "completed") return h("span", { class: "badge badge-muted", text: "No payment logged" });
    return h("span", { class: "badge badge-unpaid", text: "No deposit" });
  }
  function sortRows(rows, mode) {
    var copy = rows.slice();
    copy.sort(function (a, b) {
      if (mode === "created") return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      if (mode === "completed") {
        return String(dueDate(b) || b.updated_at || "").localeCompare(String(dueDate(a) || a.updated_at || ""));
      }
      if (!!b.priority !== !!a.priority) return b.priority ? 1 : -1;
      var da = dueDate(a), db = dueDate(b);
      if (da && db && da !== db) return da < db ? -1 : 1;
      if (da && !db) return -1;
      if (!da && db) return 1;
      if (da && db) {
        var ta = a.pickup_time || "99", tb = b.pickup_time || "99";
        if (ta !== tb) return ta < tb ? -1 : 1;
      }
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
    return copy;
  }
  function findRow(id) {
    for (var i = 0; i < state.rows.length; i++) if (String(state.rows[i].id) === String(id)) return state.rows[i];
    return null;
  }

  /* ---------------- Loading ---------------- */
  function detectSchema() {
    return api("GET", "/rest/v1/inquiries?select=" + NEW_COLUMNS.join(",") + "&limit=1")
      .then(function () { state.legacy = false; })
      .catch(function (err) {
        if (isMissingColumnError(err)) { state.legacy = true; return; }
        throw err;
      });
  }

  function loadRows(quiet) {
    if (!quiet) setAlert(appStatus, "Loading orders…");
    return detectSchema()
      .then(function () { return api("GET", "/rest/v1/inquiries?select=*&order=created_at.desc"); })
      .then(function (rows) {
        state.rows = (rows || []).map(normalize);
        showSchemaNotice();
        renderAll();
      })
      .catch(function (err) {
        if (handleAuthLoss(err)) return;
        console.error(err);
        if (err && err.kind === "forbidden") {
          setAlert(appStatus, "This account isn’t allowed to view orders. Sign out and use an owner email.", "warn");
        } else {
          setAlert(appStatus, "Couldn’t load orders. " + describeError(err), "error");
        }
      });
  }

  function showSchemaNotice() {
    if (state.legacy) {
      setAlert(appStatus, [
        h("strong", { text: "Database upgrade needed. " }),
        "The order-board columns (pickup date, price, deposit…) aren’t in the database yet, so those fields are read-only and only New / Contacted / Confirmed / Archived can be saved. Run supabase/migrations/002_order_board.sql in the Supabase SQL editor, then reload."
      ], "warn");
    } else {
      setAlert(appStatus, "");
    }
    var addBtn = $("add-order-btn");
    if (addBtn) {
      addBtn.disabled = state.legacy;
      addBtn.title = state.legacy ? "Available after the database upgrade" : "";
    }
  }

  /* ---------------- Saving ---------------- */
  function patchRow(id, fields) {
    var body = Object.assign({}, fields);
    if (state.legacy) {
      if (body.status !== undefined) {
        if (!NEW_TO_LEGACY[body.status]) {
          return Promise.reject({ kind: "legacy", message: "“" + stage(body.status).label + "” needs the database upgrade (migration 002)." });
        }
        body.status = NEW_TO_LEGACY[body.status];
      }
      NEW_COLUMNS.forEach(function (c) { delete body[c]; });
    }
    return api("PATCH", "/rest/v1/inquiries?id=eq." + encodeURIComponent(id), body, "return=representation")
      .then(function (rows) {
        var saved = rows && rows[0];
        if (!saved) throw { kind: "forbidden" };
        return normalize(saved);
      });
  }

  function replaceRow(saved) {
    for (var i = 0; i < state.rows.length; i++) {
      if (String(state.rows[i].id) === String(saved.id)) { state.rows[i] = saved; return; }
    }
    state.rows.unshift(saved);
  }

  function moveTo(id, newStatus) {
    var row = findRow(id);
    if (!row || row.status === newStatus) return;
    var prev = row.status;
    row.status = newStatus; // optimistic
    renderAll();
    patchRow(id, { status: newStatus })
      .then(function (saved) {
        replaceRow(saved);
        renderAll();
        toast("Saved · " + (row.name || "Order") + " → " + stage(newStatus).label);
      })
      .catch(function (err) {
        row.status = prev;
        renderAll();
        if (handleAuthLoss(err)) return;
        toast(err && err.kind === "legacy" ? err.message : describeError(err), "error");
      });
  }

  /* ---------------- Rendering ---------------- */
  function renderAll() {
    renderSummary();
    if (state.view === "board") renderBoard();
    else if (state.view === "list") renderList();
    else renderWeek();
  }

  function renderSummary() {
    var today = todayISO(), end = addDays(today, 6);
    var nNew = 0, nWeek = 0, nOverdue = 0, nUnpaid = 0;
    state.rows.forEach(function (r) {
      if (r.status === "new") nNew++;
      var d = dueDate(r);
      if (isOpen(r) && d) {
        if (d >= today && d <= end) nWeek++;
        else if (d < today) nOverdue++;
      }
      if (needsDeposit(r)) nUnpaid++;
    });
    $("sum-new").textContent = nNew;
    $("sum-week").textContent = nWeek;
    $("sum-week-sub").textContent = nOverdue ? nOverdue + " overdue" : "";
    $("sum-unpaid").textContent = nUnpaid;
    document.querySelector('[data-summary="new"]').classList.toggle("is-hot", nNew > 0);
    document.querySelector('[data-summary="week"]').classList.toggle("is-hot", nOverdue > 0);
    document.querySelector('[data-summary="unpaid"]').classList.toggle("is-hot", nUnpaid > 0);
  }

  var canDrag = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (canDrag) document.body.classList.add("can-drag");

  function stageSelect(r, onChange, compact) {
    var sel = h("select", { class: compact ? "card-stage" : "", "aria-label": "Stage for " + (r.name || "order") });
    STAGES.forEach(function (s) {
      var opt = h("option", { value: s.key, text: s.label });
      if (state.legacy && !NEW_TO_LEGACY[s.key]) opt.disabled = true;
      sel.appendChild(opt);
    });
    sel.value = r.status;
    sel.addEventListener("click", function (e) { e.stopPropagation(); });
    sel.addEventListener("change", function (e) { e.stopPropagation(); onChange(sel.value); });
    return sel;
  }

  function orderCard(r, opts) {
    opts = opts || {};
    var due = dueInfo(r);
    var idx = FLOW.indexOf(r.status);
    var prevKey = idx > 0 ? FLOW[idx - 1] : null;
    var nextKey = idx !== -1 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;
    var closed = stage(r.status).closed;

    var card = h("article", {
      class: "order-card" + (r.priority ? " is-priority" : "") + (due.cls === "due-overdue" ? " is-overdue" : ""),
      tabindex: "0",
      dataset: { id: r.id },
      draggable: canDrag ? "true" : null,
      "aria-label": (r.name || "Order") + ", " + stage(r.status).label + ", " + due.text
    },
      h("div", { class: "card-top" },
        h("strong", { class: "card-name" }, r.priority ? h("span", { class: "star", title: "Priority", text: "★ " }) : null, r.name || "(no name)"),
        r.price !== null && r.price !== undefined && r.price !== "" ? h("span", { class: "card-price", text: money(r.price) }) : null
      ),
      h("div", { class: "card-due " + due.cls, text: due.text }),
      summaryText(r) ? h("p", { class: "card-summary", text: preview(summaryText(r), 110) }) : null,
      balanceLine(r),
      h("div", { class: "card-badges" },
        opts.showStage ? h("span", { class: "badge stage-badge stage-" + r.status, text: stage(r.status).short }) : null,
        depositBadge(r),
        r.source && r.source !== "website" ? h("span", { class: "badge badge-source", text: SOURCES[r.source] || r.source }) : null
      ),
      h("div", { class: "card-actions" },
        h("button", {
          type: "button", class: "card-step", "aria-label": prevKey ? "Move back to " + stage(prevKey).label : "Move back",
          disabled: !prevKey || (state.legacy && !NEW_TO_LEGACY[prevKey]) ? true : null,
          onclick: function (e) { e.stopPropagation(); if (prevKey) moveTo(r.id, prevKey); }
        }, "‹"),
        stageSelect(r, function (v) { moveTo(r.id, v); }, true),
        closed
          ? h("button", { type: "button", class: "card-step card-step-next", "aria-label": "Restore to New",
              onclick: function (e) { e.stopPropagation(); moveTo(r.id, "new"); } }, "Restore")
          : h("button", {
              type: "button", class: "card-step card-step-next",
              "aria-label": nextKey ? "Move forward to " + stage(nextKey).label : "Move forward",
              disabled: !nextKey || (state.legacy && !NEW_TO_LEGACY[nextKey]) ? true : null,
              onclick: function (e) { e.stopPropagation(); if (nextKey) moveTo(r.id, nextKey); }
            }, nextKey ? stage(nextKey).short + " ›" : "›")
      )
    );

    card.addEventListener("click", function () { openModal(r.id); });
    card.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target === card) { e.preventDefault(); openModal(r.id); }
    });
    if (canDrag) {
      card.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", String(r.id));
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("is-dragging");
        document.body.classList.add("is-dragging-card");
      });
      card.addEventListener("dragend", function () {
        card.classList.remove("is-dragging");
        document.body.classList.remove("is-dragging-card");
      });
    }
    return card;
  }

  function boardStages() {
    return STAGES.filter(function (s) { return state.showClosed || !s.closed; });
  }

  function renderBoard() {
    var board = $("board"), jump = $("stage-jump");
    clear(board); clear(jump);
    boardStages().forEach(function (s) {
      var rows = state.rows.filter(function (r) { return r.status === s.key; });
      rows = sortRows(rows, s.key === "completed" || s.closed ? "completed" : "pickup");
      var list = h("div", { class: "column-cards" });
      if (!rows.length) list.appendChild(h("p", { class: "column-empty", text: canDrag ? "Drop orders here" : "Nothing here" }));
      rows.forEach(function (r) { list.appendChild(orderCard(r)); });

      var col = h("section", { class: "column column-" + s.key + (s.closed ? " column-closed" : ""), id: "col-" + s.key, dataset: { stage: s.key } },
        h("header", { class: "column-head" },
          h("h3", { text: s.label }),
          h("span", { class: "column-count", text: String(rows.length) })
        ),
        list
      );
      if (canDrag) {
        col.addEventListener("dragover", function (e) {
          if (state.legacy && !NEW_TO_LEGACY[s.key]) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move"; col.classList.add("is-drop-target");
        });
        col.addEventListener("dragleave", function (e) {
          if (!col.contains(e.relatedTarget)) col.classList.remove("is-drop-target");
        });
        col.addEventListener("drop", function (e) {
          e.preventDefault(); col.classList.remove("is-drop-target");
          var id = e.dataTransfer.getData("text/plain");
          if (id) moveTo(id, s.key);
        });
      }
      board.appendChild(col);

      jump.appendChild(h("button", {
        type: "button", class: "jump-chip stage-" + s.key,
        onclick: function () {
          var target = $("col-" + s.key);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
        }
      }, s.short + " ", h("b", { text: String(rows.length) })));
    });
  }

  function fillListFilter() {
    var sel = $("list-filter");
    clear(sel);
    [["active", "All open orders"], ["unpaid", "Unpaid deposits"]].forEach(function (o) {
      sel.appendChild(h("option", { value: o[0], text: o[1] }));
    });
    var grp = h("optgroup", { label: "Stage" });
    STAGES.forEach(function (s) { grp.appendChild(h("option", { value: s.key, text: s.label })); });
    sel.appendChild(grp);
    sel.appendChild(h("option", { value: "closed", text: "Declined & archived" }));
    sel.appendChild(h("option", { value: "all", text: "Everything" }));
    sel.value = state.listFilter;
  }

  function matchesFilter(r) {
    var f = state.listFilter;
    if (f === "active") {
      if (!(isOpen(r) || (state.showClosed && stage(r.status).closed))) return false;
    } else if (f === "unpaid") { if (!needsDeposit(r)) return false; }
    else if (f === "closed") { if (!stage(r.status).closed) return false; }
    else if (f !== "all") { if (r.status !== f) return false; }
    var q = state.search.trim().toLowerCase();
    if (q) {
      var qDigits = q.replace(/\D/g, "");
      var hay = [r.name, r.email, r.phone, r.items, r.message, r.event_type, r.notes].join(" ").toLowerCase();
      var phoneDigits = String(r.phone || "").replace(/\D/g, "");
      if (hay.indexOf(q) === -1 && !(qDigits.length >= 3 && phoneDigits.indexOf(qDigits) !== -1)) return false;
    }
    return true;
  }

  function renderList() {
    var box = $("order-list");
    clear(box);
    var rows = sortRows(state.rows.filter(matchesFilter), state.listSort);
    $("list-count").textContent = rows.length + (rows.length === 1 ? " order" : " orders");
    if (!rows.length) {
      box.appendChild(h("p", { class: "admin-empty", text: state.rows.length ? "No orders match." : "No orders yet. New contact-form inquiries will appear here." }));
      return;
    }
    rows.forEach(function (r) { box.appendChild(orderCard(r, { showStage: true })); });
  }

  function renderWeek() {
    var box = $("week-list");
    clear(box);
    var today = todayISO();
    var groups = [];
    var overdue = state.rows.filter(function (r) { var d = dueDate(r); return isOpen(r) && d && d < today; });
    if (overdue.length) groups.push({ key: "overdue", title: "Overdue", sub: "Past pickup date and not picked up", rows: overdue });
    for (var i = 0; i < 7; i++) {
      var day = addDays(today, i);
      var title = i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmtDay(day, { weekday: "long", month: undefined, day: undefined });
      groups.push({
        key: day, title: title, sub: fmtDay(day, { weekday: i < 2 ? "long" : undefined }),
        rows: state.rows.filter(function (r) {
          return dueDate(r) === day && (isOpen(r) || r.status === "completed" || (state.showClosed && stage(r.status).closed));
        })
      });
    }
    var weekOrders = 0, weekDue = 0;
    groups.forEach(function (g) {
      g.due = 0;
      g.rows.forEach(function (r) {
        if (!isOpen(r)) return;
        var b = balanceDue(r);
        if (b) g.due += b;
      });
      if (g.key !== "overdue") {
        weekOrders += g.rows.filter(isOpen).length;
        weekDue += g.due;
      }
    });
    box.appendChild(h("div", { class: "week-summary" },
      h("div", { class: "week-summary-text" },
        h("strong", { text: weekOrders + (weekOrders === 1 ? " order" : " orders") + " due this week" }),
        h("span", { text: " · " + money(Math.round(weekDue * 100) / 100 || 0) + " to collect at pickup" })
      ),
      h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: function () { openPrintChooser(); } }, "🖨 Print prep list")
    ));
    groups.forEach(function (g) {
      var sorted = sortRows(g.rows, "pickup");
      var sec = h("section", { class: "week-day" + (g.key === "overdue" ? " week-overdue" : "") + (g.key === today ? " week-today" : "") },
        h("header", { class: "week-head" },
          h("h3", { text: g.title }),
          h("span", { class: "week-sub", text: g.sub }),
          g.due ? h("span", { class: "week-due", text: money(Math.round(g.due * 100) / 100) + " due" }) : null,
          h("span", { class: "column-count", text: String(sorted.length) })
        )
      );
      if (!sorted.length) sec.appendChild(h("p", { class: "week-empty", text: "Nothing due" }));
      var list = h("div", { class: "week-cards" });
      sorted.forEach(function (r) { list.appendChild(orderCard(r, { showStage: true })); });
      sec.appendChild(list);
      box.appendChild(sec);
    });
  }

  function setView(v, remember) {
    state.view = v;
    if (remember) state.viewChosen = true;
    document.querySelectorAll(".view-tab").forEach(function (t) {
      t.setAttribute("aria-selected", t.dataset.view === v ? "true" : "false");
    });
    $("view-board").hidden = v !== "board";
    $("view-list").hidden = v !== "list";
    $("view-week").hidden = v !== "week";
    savePrefs();
    renderAll();
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        view: state.viewChosen ? state.view : null, showClosed: state.showClosed, listSort: state.listSort
      }));
    } catch (e) {}
  }
  function isPhone() { return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches); }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (p.view === "board" || p.view === "list" || p.view === "week") { state.view = p.view; state.viewChosen = true; }
      else state.view = isPhone() ? "week" : "board";
      state.showClosed = !!p.showClosed;
      if (p.listSort) state.listSort = p.listSort;
    } catch (e) { state.view = isPhone() ? "week" : "board"; }
  }

  /* ---------------- Modal ---------------- */
  var F = {
    status: $("f-status"), source: $("f-source"), name: $("f-name"), phone: $("f-phone"), email: $("f-email"),
    event_type: $("f-event-type"), event_date: $("f-event-date"), pickup_date: $("f-pickup-date"), pickup_time: $("f-pickup-time"),
    items: $("f-items"), price: $("f-price"), deposit_amount: $("f-deposit-amount"), deposit_paid: $("f-deposit-paid"),
    paid_in_full: $("f-paid-full"), priority: $("f-priority"), notes: $("f-notes")
  };
  STAGES.forEach(function (s) { F.status.appendChild(h("option", { value: s.key, text: s.label })); });

  var lastFocus = null;
  function openModal(id) {
    var creating = id === "new";
    var r = creating ? {
      status: "confirmed", source: "phone", name: "", phone: "", email: "", event_type: "", event_date: "",
      pickup_date: "", pickup_time: "", items: "", price: null, deposit_amount: null, deposit_paid: false,
      paid_in_full: false, priority: false, notes: "", message: ""
    } : findRow(id);
    if (!r) return;
    state.editingId = creating ? "new" : r.id;
    lastFocus = document.activeElement;

    $("modal-eyebrow").textContent = creating ? "New order" : stage(r.status).label;
    $("modal-title").textContent = creating ? "Add an order" : (r.name || "Order");

    Array.prototype.forEach.call(F.status.options, function (o) {
      o.disabled = state.legacy && !NEW_TO_LEGACY[o.value];
    });
    F.status.value = r.status || "new";
    F.source.value = r.source || "website";
    F.name.value = r.name || "";
    F.phone.value = r.phone || "";
    F.email.value = r.email || "";
    F.event_type.value = r.event_type || "";
    F.event_date.value = r.event_date || "";
    F.pickup_date.value = r.pickup_date ? String(r.pickup_date).slice(0, 10) : "";
    F.pickup_time.value = /^\d{1,2}:\d{2}/.test(r.pickup_time || "") ? String(r.pickup_time).slice(0, 5).padStart(5, "0") : "";
    F.items.value = r.items || "";
    F.price.value = r.price !== null && r.price !== undefined ? r.price : "";
    F.deposit_amount.value = r.deposit_amount !== null && r.deposit_amount !== undefined ? r.deposit_amount : "";
    F.deposit_paid.checked = !!r.deposit_paid;
    F.paid_in_full.checked = !!r.paid_in_full;
    F.priority.checked = !!r.priority;
    F.notes.value = r.notes || "";

    // Pickup date placeholder hint from customer's event date
    F.pickup_date.title = !r.pickup_date && isISODate(r.event_date) ? "Customer event date: " + r.event_date : "";

    document.querySelectorAll("[data-new-col]").forEach(function (el) {
      el.disabled = state.legacy;
      var grp = el.closest(".form-group, .check");
      if (grp) grp.classList.toggle("is-locked", state.legacy);
    });

    renderContactQuick();
    renderModalBalance();
    var msgBox = $("customer-message");
    msgBox.hidden = !r.message;
    $("customer-message-text").textContent = r.message || "";

    var meta = [];
    if (!creating) {
      meta.push("Received " + fmtStamp(r.created_at));
      if (r.updated_at) meta.push("updated " + fmtStamp(r.updated_at));
      if (r.source) meta.push("via " + (SOURCES[r.source] || r.source));
    }
    $("modal-meta").textContent = meta.join(" · ");
    $("archive-btn").hidden = creating || r.status === "archived";

    modal.hidden = false;
    document.body.classList.add("modal-open");
    modal.querySelector(".modal-body").scrollTop = 0;
    setTimeout(function () { (creating ? F.name : modal.querySelector(".modal-close")).focus(); }, 30);
  }

  function renderContactQuick() {
    var box = $("contact-quick");
    clear(box);
    var phone = F.phone.value.trim(), email = F.email.value.trim();
    if (phone) {
      var tel = phone.replace(/[^\d+]/g, "");
      box.appendChild(h("a", { class: "quick-btn", href: "tel:" + tel }, "📞 Call"));
      box.appendChild(h("a", { class: "quick-btn", href: "sms:" + tel }, "💬 Text"));
    }
    if (email) {
      var subj = "Your order with Lally's Cakes & Sweets";
      box.appendChild(h("a", { class: "quick-btn", href: "mailto:" + encodeURIComponent(email).replace(/%40/g, "@") + "?subject=" + encodeURIComponent(subj) }, "✉️ Email"));
    }
    box.hidden = !box.firstChild;
  }
  function renderModalBalance() {
    var el = $("modal-balance");
    var b = balanceDue({
      price: F.price.value === "" ? null : +F.price.value,
      deposit_paid: F.deposit_paid.checked,
      deposit_amount: F.deposit_amount.value === "" ? null : +F.deposit_amount.value,
      paid_in_full: F.paid_in_full.checked
    });
    clear(el);
    if (b === null) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle("is-paid", b === 0);
    append(el, b === 0 ? ["Balance due: ", h("b", { text: "$0" }), " · Paid in full"] : ["Balance due at pickup: ", h("b", { text: money(b) })]);
  }
  [F.price, F.deposit_amount].forEach(function (i) { i.addEventListener("input", renderModalBalance); });
  [F.deposit_paid, F.paid_in_full].forEach(function (i) { i.addEventListener("change", renderModalBalance); });
  F.phone.addEventListener("input", renderContactQuick);
  F.email.addEventListener("input", renderContactQuick);
  F.paid_in_full.addEventListener("change", function () { if (F.paid_in_full.checked) F.deposit_paid.checked = true; renderModalBalance(); });
  F.deposit_amount.addEventListener("input", function () { if (F.deposit_amount.value && +F.deposit_amount.value > 0) F.deposit_paid.checked = true; renderModalBalance(); });

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    state.editingId = null;
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
  }

  function numOrNull(v) { return v === "" || v === null || isNaN(+v) ? null : Math.round(+v * 100) / 100; }
  function textOrNull(v) { v = String(v || "").trim(); return v ? v : null; }

  function collectForm() {
    return {
      status: F.status.value,
      source: F.source.value,
      name: F.name.value.trim(),
      phone: textOrNull(F.phone.value),
      email: textOrNull(F.email.value),
      event_type: textOrNull(F.event_type.value),
      event_date: textOrNull(F.event_date.value),
      pickup_date: F.pickup_date.value || null,
      pickup_time: F.pickup_time.value || null,
      items: textOrNull(F.items.value),
      price: numOrNull(F.price.value),
      deposit_amount: numOrNull(F.deposit_amount.value),
      deposit_paid: F.deposit_paid.checked,
      paid_in_full: F.paid_in_full.checked,
      priority: F.priority.checked,
      notes: textOrNull(F.notes.value)
    };
  }

  orderForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = collectForm();
    if (!data.name) { toast("Please enter the customer’s name.", "error"); F.name.focus(); return; }
    if (data.price !== null && data.price < 0 || data.deposit_amount !== null && data.deposit_amount < 0) {
      toast("Amounts can’t be negative.", "error"); return;
    }
    var btn = $("save-order-btn");
    btn.disabled = true; btn.textContent = "Saving…";
    var creating = state.editingId === "new";
    var p;
    if (creating) {
      p = api("POST", "/rest/v1/inquiries", data, "return=representation").then(function (rows) {
        if (!rows || !rows[0]) throw { kind: "forbidden" };
        return normalize(rows[0]);
      });
    } else {
      // Before migration 002, email is NOT NULL: don't blank it out.
      if (state.legacy && !data.email) delete data.email;
      p = patchRow(state.editingId, data);
    }
    p.then(function (saved) {
      replaceRow(saved);
      closeModal();
      renderAll();
      toast(creating ? "Order added ✓" : "Saved ✓");
    }).catch(function (err) {
      if (handleAuthLoss(err)) { closeModal(); return; }
      console.error(err);
      if (isMissingColumnError(err) && !state.legacy) { state.legacy = true; showSchemaNotice(); }
      toast(err && err.kind === "legacy" ? err.message : describeError(err), "error");
    }).finally(function () {
      btn.disabled = false; btn.textContent = "Save";
    });
  });

  $("archive-btn").addEventListener("click", function () {
    var id = state.editingId;
    if (!id || id === "new") return;
    closeModal();
    moveTo(id, "archived");
  });

  modal.addEventListener("click", function (e) {
    if (e.target === modal || e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  /* ---------------- Printable prep list ---------------- */
  var PRINT_STAGES = ["confirmed", "baking", "ready"];
  var printModal = $("print-modal");

  function openPrintChooser() {
    printModal.hidden = false;
    document.body.classList.add("modal-open");
    var checked = printModal.querySelector('input[name="print-range"]:checked');
    setTimeout(function () { (checked || printModal.querySelector("input")).focus(); }, 30);
  }
  function closePrintChooser() {
    printModal.hidden = true;
    if (modal.hidden) document.body.classList.remove("modal-open");
  }

  function buildPrintSheet(range, includeEarly) {
    var sheet = $("print-sheet");
    clear(sheet);
    var today = todayISO();
    var days = range === "today" ? [today] : range === "tomorrow" ? [addDays(today, 1)] :
      [0, 1, 2, 3, 4, 5, 6].map(function (n) { return addDays(today, n); });
    var stages = includeEarly ? PRINT_STAGES.concat(["new", "contacted"]) : PRINT_STAGES;
    var wanted = function (r) { return stages.indexOf(r.status) !== -1; };

    var groups = [];
    if (range !== "tomorrow") {
      var overdue = state.rows.filter(function (r) { var d = dueDate(r); return wanted(r) && d && d < today; });
      if (overdue.length) groups.push({ title: "Overdue — not picked up yet", rows: overdue });
    }
    days.forEach(function (d, i) {
      var label = d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : "";
      groups.push({
        title: (label ? label + " — " : "") + fmtDay(d, { weekday: "long", month: "long" }),
        rows: state.rows.filter(function (r) { return wanted(r) && dueDate(r) === d; })
      });
    });

    var rangeLabel = range === "today" ? "Today" : range === "tomorrow" ? "Tomorrow" : "This week";
    var total = 0, count = 0;
    groups.forEach(function (g) { g.rows.forEach(function (r) { count++; total += balanceDue(r) || 0; }); });

    sheet.appendChild(h("header", { class: "ps-head" },
      h("div", {},
        h("div", { class: "ps-brand", text: "Lally’s Cakes & Sweets" }),
        h("h1", { text: "Prep list · " + rangeLabel })
      ),
      h("div", { class: "ps-meta" },
        h("div", { text: count + (count === 1 ? " order" : " orders") + " · " + money(Math.round(total * 100) / 100 || 0) + " to collect" }),
        h("div", { text: "Printed " + fmtStamp(new Date().toISOString()) })
      )
    ));

    groups.forEach(function (g) {
      var sec = h("section", { class: "ps-day" }, h("h2", { text: g.title }));
      if (!g.rows.length) { sec.appendChild(h("p", { class: "ps-empty", text: "No orders." })); sheet.appendChild(sec); return; }
      var tbody = h("tbody");
      sortRows(g.rows, "pickup").forEach(function (r) {
        var b = balanceDue(r);
        var details = [r.items || "", r.event_type && !r.items ? r.event_type : ""].filter(Boolean).join(" · ") ||
          preview(r.message, 180) || "—";
        tbody.appendChild(h("tr", {},
          h("td", { class: "ps-check" }, h("span", { class: "ps-box", "aria-hidden": "true" })),
          h("td", { class: "ps-time", text: fmtTime(r.pickup_time) || "—" }),
          h("td", { class: "ps-cust" },
            h("strong", { text: (r.priority ? "★ " : "") + (r.name || "—") }),
            r.phone ? h("div", { text: r.phone }) : null,
            h("div", { class: "ps-stage", text: stage(r.status).label })
          ),
          h("td", { class: "ps-items" },
            h("div", { text: details }),
            r.notes ? h("div", { class: "ps-notes" }, h("b", { text: "Notes: " }), r.notes) : null
          ),
          h("td", { class: "ps-money", text: r.price !== null && r.price !== undefined && r.price !== "" ? money(r.price) : "—" }),
          h("td", { class: "ps-money ps-bal", text: b === null ? "—" : b === 0 ? "Paid" : money(b) })
        ));
      });
      sec.appendChild(h("table", { class: "ps-table" },
        h("thead", {}, h("tr", {},
          h("th", { class: "ps-check", text: "✓" }), h("th", { text: "Time" }), h("th", { text: "Customer" }),
          h("th", { text: "Items / details" }), h("th", { class: "ps-money", text: "Price" }), h("th", { class: "ps-money", text: "Balance" })
        )),
        tbody
      ));
      sheet.appendChild(sec);
    });
    return sheet;
  }

  function printPrepList(range, includeEarly) {
    buildPrintSheet(range, includeEarly);
    closePrintChooser();
    document.body.classList.add("print-prep");
    var done = function () {
      document.body.classList.remove("print-prep");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(function () { window.print(); }, 50);
  }

  $("print-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var range = (printModal.querySelector('input[name="print-range"]:checked') || {}).value || "today";
    printPrepList(range, $("print-include-early").checked);
  });
  printModal.addEventListener("click", function (e) {
    if (e.target === printModal || e.target.closest("[data-close-print]")) closePrintChooser();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !printModal.hidden) closePrintChooser();
  });
  $("print-btn").addEventListener("click", openPrintChooser);

  /* ---------------- App shell ---------------- */
  function showLogin(message, isError) {
    authWrap.hidden = false;
    appWrap.hidden = true;
    hero.hidden = false;
    document.body.classList.remove("is-authed");
    signinPanel.hidden = false;
    resetPanel.hidden = true;
    setLoginStatus(message || "", isError);
  }

  function showApp(session) {
    var email = (session.user && session.user.email) || decodeJwtEmail(session.access_token) || "";
    authWrap.hidden = true;
    appWrap.hidden = false;
    hero.hidden = true;
    document.body.classList.add("is-authed");
    $("signed-in-email").textContent = email || "signed in";
    $("show-closed").checked = state.showClosed;
    $("list-sort").value = state.listSort;
    fillListFilter();
    setView(state.view);
    if (!isOwnerEmail(email)) {
      setAlert(appStatus, "This email isn’t an owner account. Only bakery owner emails can view orders. Sign out and try an owner address.", "warn");
      return;
    }
    loadRows();
  }

  function showResetPanel(session) {
    authWrap.hidden = false;
    appWrap.hidden = true;
    hero.hidden = false;
    signinPanel.hidden = true;
    resetPanel.hidden = false;
    $("reset-email").textContent = (session.user && session.user.email) || "your account";
    setLoginStatus("", false);
    setTimeout(function () { $("new-password").focus(); }, 30);
  }

  /* Sign in */
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("owner-email").value.trim();
    var pwInput = $("owner-password");
    var btn = e.target.querySelector('button[type="submit"]');
    if (!email || !pwInput.value) { setLoginStatus("Enter your owner email and password.", true); return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    setLoginStatus("", false);
    fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: anonHeaders(), body: JSON.stringify({ email: email, password: pwInput.value })
    }).then(parseJson).then(function (r) {
      if (r.ok && r.data && r.data.access_token) {
        pwInput.value = "";
        var s = sessionFromTokenResponse(r.data, email);
        saveSession(s);
        showApp(s);
      } else {
        setLoginStatus(friendlyAuthError(r.data, "Couldn’t sign in. Check your email and password."), true);
      }
    }).catch(function () {
      setLoginStatus("Couldn’t sign in. Check your connection and try again.", true);
    }).finally(function () { btn.disabled = false; btn.textContent = "Sign in"; });
  });

  /* Forgot password */
  toggleForgot.addEventListener("click", function () {
    forgotPanel.hidden = !forgotPanel.hidden;
    toggleForgot.setAttribute("aria-expanded", forgotPanel.hidden ? "false" : "true");
    if (!forgotPanel.hidden) {
      var main = $("owner-email").value.trim(), rec = $("recover-email");
      if (main && !rec.value) rec.value = main;
      rec.focus();
    }
  });
  $("forgot-password-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("recover-email").value.trim();
    var btn = e.target.querySelector('button[type="submit"]');
    if (!email) { setLoginStatus("Enter your owner email to reset your password.", true); return; }
    btn.disabled = true; btn.textContent = "Sending…";
    fetch(SUPABASE_URL + "/auth/v1/recover?redirect_to=" + encodeURIComponent(adminRedirectUrl()), {
      method: "POST", headers: anonHeaders(), body: JSON.stringify({ email: email })
    }).then(parseJson).then(function (r) {
      if (r.ok) {
        setLoginStatus("If that’s an owner account, a reset link is on its way. Open it on this device to choose a new password.", false);
        forgotPanel.hidden = true;
        toggleForgot.setAttribute("aria-expanded", "false");
      } else {
        setLoginStatus(friendlyAuthError(r.data, "Couldn’t send reset email. Try again."), true);
      }
    }).catch(function () {
      setLoginStatus("Couldn’t send reset email. Check your connection and try again.", true);
    }).finally(function () { btn.disabled = false; btn.textContent = "Send reset email"; });
  });

  /* Set new password (recovery session) */
  $("reset-password-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("new-password").value, pw2 = $("new-password-confirm").value;
    var btn = e.target.querySelector('button[type="submit"]');
    if (pw.length < 8) { setLoginStatus("Use at least 8 characters.", true); return; }
    if (pw !== pw2) { setLoginStatus("Passwords don’t match.", true); return; }
    btn.disabled = true; btn.textContent = "Saving…";
    validSession().then(function (s) {
      if (!s) throw { kind: "auth" };
      return fetch(SUPABASE_URL + "/auth/v1/user", {
        method: "PUT", headers: userHeaders(s.access_token), body: JSON.stringify({ password: pw })
      }).then(parseJson).then(function (r) {
        if (!r.ok) throw { kind: "authapi", data: r.data };
        $("new-password").value = ""; $("new-password-confirm").value = "";
        toast("Password updated ✓");
        showApp(s);
      });
    }).catch(function (err) {
      if (err && err.kind === "auth") {
        clearSession();
        showLogin("That reset link expired. Use “Forgot password?” to get a new one.", true);
        return;
      }
      setLoginStatus(friendlyAuthError(err && err.data, "Couldn’t update password. Try again."), true);
    }).finally(function () { btn.disabled = false; btn.textContent = "Save new password"; });
  });

  /* Signed-in controls */
  $("sign-out-btn").addEventListener("click", function () {
    var s = state.session;
    if (s && s.access_token) {
      fetch(SUPABASE_URL + "/auth/v1/logout", { method: "POST", headers: userHeaders(s.access_token) }).catch(function () {});
    }
    clearSession();
    state.rows = [];
    showLogin("Signed out.", false);
  });
  $("refresh-btn").addEventListener("click", function () { loadRows().then(function () { if (!state.legacy) toast("Up to date ✓"); }); });
  $("add-order-btn").addEventListener("click", function () {
    if (state.legacy) { toast("Adding orders needs the database upgrade (migration 002).", "error"); return; }
    openModal("new");
  });
  document.querySelectorAll(".view-tab").forEach(function (t) {
    t.addEventListener("click", function () { setView(t.dataset.view, true); });
  });
  $("show-closed").addEventListener("change", function (e) { state.showClosed = e.target.checked; savePrefs(); renderAll(); });
  $("list-search").addEventListener("input", function (e) { state.search = e.target.value; renderList(); });
  $("list-filter").addEventListener("change", function (e) { state.listFilter = e.target.value; renderList(); });
  $("list-sort").addEventListener("change", function (e) { state.listSort = e.target.value; savePrefs(); renderList(); });
  document.querySelectorAll("[data-summary]").forEach(function (b) {
    b.addEventListener("click", function () {
      var k = b.dataset.summary;
      if (k === "week") { setView("week", true); return; }
      state.listFilter = k === "new" ? "new" : "unpaid";
      state.search = ""; $("list-search").value = "";
      fillListFilter();
      setView("list", true);
    });
  });
  // Refresh when the owner comes back to the tab/app (keeps phone view fresh).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !appWrap.hidden && state.editingId === null && isOwnerEmail(state.session && state.session.user && state.session.user.email)) {
      loadRows(true);
    }
  });

  /* ---------------- Boot ---------------- */
  function boot() {
    loadPrefs();
    var hash = window.location.hash.replace(/^#/, "");
    var params = hash ? new URLSearchParams(hash) : null;

    if (params && (params.get("error") || params.get("error_description"))) {
      clearHash();
      var desc = (params.get("error_description") || "").replace(/\+/g, " ");
      showLogin(/expired|invalid/i.test(desc + params.get("error_code"))
        ? "That email link has expired or was already used. Use “Forgot password?” to get a new one."
        : (desc || "That link didn’t work. Try again."), true);
      return;
    }

    if (params && params.get("access_token")) {
      var s = sessionFromTokenResponse({
        access_token: params.get("access_token"),
        refresh_token: params.get("refresh_token"),
        expires_in: parseInt(params.get("expires_in") || "3600", 10)
      });
      saveSession(s);
      clearHash();
      if (params.get("type") === "recovery") { showResetPanel(s); return; }
      showApp(s);
      return;
    }

    validSession().then(function (s) {
      if (s) showApp(s); else showLogin("");
    });
  }

  boot();
})();
