/* Lally's Cakes & Sweets — owner inbox (Supabase Auth magic link + REST) */
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

  var loginView = document.getElementById("admin-login");
  var inboxView = document.getElementById("admin-inbox");
  var loginForm = document.getElementById("login-form");
  var loginStatus = document.getElementById("login-status");
  var inboxStatus = document.getElementById("inbox-status");
  var inquiryList = document.getElementById("inquiry-list");
  var signedInEmail = document.getElementById("signed-in-email");
  var signOutBtn = document.getElementById("sign-out-btn");

  function anonHeaders() {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    };
  }

  function userHeaders(accessToken) {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    };
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function parseHashSession() {
    var hash = window.location.hash.replace(/^#/, "");
    if (!hash) return null;
    var params = new URLSearchParams(hash);
    var accessToken = params.get("access_token");
    var refreshToken = params.get("refresh_token");
    if (!accessToken) return null;
    var expiresIn = parseInt(params.get("expires_in") || "3600", 10);
    return {
      access_token: accessToken,
      refresh_token: refreshToken || "",
      expires_at: Date.now() + expiresIn * 1000,
      user: null
    };
  }

  function decodeJwtEmail(token) {
    try {
      var payload = token.split(".")[1];
      var json = JSON.parse(
        atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
      );
      return json.email || (json.user_metadata && json.user_metadata.email) || "";
    } catch (e) {
      return "";
    }
  }

  function isOwnerEmail(email) {
    if (!email) return false;
    var lower = email.toLowerCase();
    return OWNERS.some(function (o) {
      return o.toLowerCase() === lower;
    });
  }

  function refreshSession(session) {
    if (!session || !session.refresh_token) {
      return Promise.reject(new Error("No refresh token"));
    }
    return fetch(
      SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
      {
        method: "POST",
        headers: anonHeaders(),
        body: JSON.stringify({ refresh_token: session.refresh_token })
      }
    ).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error(
            (data && data.error_description) ||
              (data && data.msg) ||
              "Refresh failed"
          );
        }
        var next = {
          access_token: data.access_token,
          refresh_token: data.refresh_token || session.refresh_token,
          expires_at: Date.now() + (data.expires_in || 3600) * 1000,
          user: data.user || session.user || null
        };
        if (!next.user || !next.user.email) {
          next.user = next.user || {};
          next.user.email = decodeJwtEmail(next.access_token);
        }
        saveSession(next);
        return next;
      });
    });
  }

  function ensureSession() {
    var fromHash = parseHashSession();
    if (fromHash) {
      fromHash.user = { email: decodeJwtEmail(fromHash.access_token) };
      saveSession(fromHash);
      // Clean hash so refresh doesn't re-parse
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
      return Promise.resolve(fromHash);
    }

    var session = getSession();
    if (!session || !session.access_token) {
      return Promise.resolve(null);
    }

    var skew = 60 * 1000;
    if (session.expires_at && session.expires_at - skew > Date.now()) {
      if (!session.user || !session.user.email) {
        session.user = session.user || {};
        session.user.email = decodeJwtEmail(session.access_token);
        saveSession(session);
      }
      return Promise.resolve(session);
    }

    return refreshSession(session).catch(function (err) {
      console.error("Session refresh failed:", err);
      clearSession();
      return null;
    });
  }

  function showLogin(message) {
    if (loginView) loginView.hidden = false;
    if (inboxView) inboxView.hidden = true;
    if (loginStatus && message) {
      loginStatus.classList.add("is-visible");
      loginStatus.textContent = message;
    }
  }

  function showInbox(session) {
    if (loginView) loginView.hidden = true;
    if (inboxView) inboxView.hidden = false;
    var email =
      (session.user && session.user.email) ||
      decodeJwtEmail(session.access_token) ||
      "signed in";
    if (signedInEmail) signedInEmail.textContent = email;

    if (!isOwnerEmail(email)) {
      if (inboxStatus) {
        inboxStatus.className = "admin-alert admin-alert-warn is-visible";
        inboxStatus.textContent =
          "This email isn’t an owner account. Only bakery owner emails can view inquiries. Sign out and try an owner address.";
      }
      if (inquiryList) inquiryList.innerHTML = "";
      return;
    }

    loadInquiries(session);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (e) {
      return iso;
    }
  }

  function previewText(text, max) {
    if (!text) return "";
    var t = String(text).replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + "…";
  }

  function statusBadgeClass(status) {
    var s = (status || "new").toLowerCase();
    return "status-badge status-" + s;
  }

  function loadInquiries(session) {
    if (inboxStatus) {
      inboxStatus.className = "admin-alert is-visible";
      inboxStatus.textContent = "Loading inquiries…";
    }
    if (inquiryList) inquiryList.innerHTML = "";

    fetch(
      SUPABASE_URL +
        "/rest/v1/inquiries?select=*&order=created_at.desc",
      {
        method: "GET",
        headers: userHeaders(session.access_token)
      }
    )
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw { kind: "forbidden", status: res.status };
        }
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error("Load failed (" + res.status + "): " + t);
          });
        }
        return res.json();
      })
      .then(function (rows) {
        if (inboxStatus) {
          inboxStatus.className = "admin-alert";
          inboxStatus.textContent = "";
          inboxStatus.classList.remove("is-visible");
        }
        renderInquiries(rows || [], session);
      })
      .catch(function (err) {
        if (err && err.kind === "forbidden") {
          if (inboxStatus) {
            inboxStatus.className = "admin-alert admin-alert-warn is-visible";
            inboxStatus.textContent =
              "This email isn’t an owner account. RLS denied access to inquiries. Sign out and use an owner email.";
          }
          if (inquiryList) inquiryList.innerHTML = "";
          return;
        }
        console.error(err);
        if (inboxStatus) {
          inboxStatus.className = "admin-alert admin-alert-error is-visible";
          inboxStatus.textContent =
            "Couldn’t load inquiries. Try signing out and back in.";
        }
      });
  }

  function renderInquiries(rows, session) {
    if (!inquiryList) return;
    inquiryList.innerHTML = "";

    if (!rows.length) {
      inquiryList.innerHTML =
        '<p class="admin-empty">No inquiries yet. New contact-form submissions will appear here.</p>';
      return;
    }

    rows.forEach(function (row) {
      var card = document.createElement("article");
      card.className = "inquiry-card";
      card.dataset.id = row.id;

      var status = row.status || "new";
      var head = document.createElement("button");
      head.type = "button";
      head.className = "inquiry-card-head";
      head.setAttribute("aria-expanded", "false");
      head.innerHTML =
        '<div class="inquiry-card-meta">' +
        '<strong class="inquiry-name"></strong>' +
        '<span class="' +
        statusBadgeClass(status) +
        '">' +
        escapeHtml(status) +
        "</span>" +
        "</div>" +
        '<div class="inquiry-card-sub">' +
        '<span class="inquiry-email"></span>' +
        '<span class="inquiry-when"></span>' +
        "</div>" +
        '<p class="inquiry-preview"></p>';

      head.querySelector(".inquiry-name").textContent = row.name || "—";
      head.querySelector(".inquiry-email").textContent = row.email || "";
      head.querySelector(".inquiry-when").textContent = formatDate(
        row.created_at
      );
      head.querySelector(".inquiry-preview").textContent = previewText(
        row.message,
        120
      );

      var body = document.createElement("div");
      body.className = "inquiry-card-body";
      body.hidden = true;

      var details = document.createElement("dl");
      details.className = "inquiry-details";
      details.innerHTML =
        "<div><dt>Email</dt><dd><a class='inq-email' href='#'></a></dd></div>" +
        "<div><dt>Phone</dt><dd class='inq-phone'></dd></div>" +
        "<div><dt>Event date</dt><dd class='inq-event'></dd></div>" +
        "<div><dt>Received</dt><dd class='inq-created'></dd></div>";
      details.querySelector(".inq-email").textContent = row.email || "—";
      details.querySelector(".inq-email").href =
        "mailto:" + encodeURIComponent(row.email || "");
      details.querySelector(".inq-phone").textContent = row.phone || "—";
      details.querySelector(".inq-event").textContent = row.event_date || "—";
      details.querySelector(".inq-created").textContent = formatDate(
        row.created_at
      );

      var msgBlock = document.createElement("div");
      msgBlock.className = "inquiry-message";
      msgBlock.innerHTML = "<h3>Message</h3><p></p>";
      msgBlock.querySelector("p").textContent = row.message || "";

      var form = document.createElement("form");
      form.className = "inquiry-edit";
      form.innerHTML =
        '<div class="form-group">' +
        '<label for="status-' +
        row.id +
        '">Status</label>' +
        '<select id="status-' +
        row.id +
        '" name="status">' +
        '<option value="new">new</option>' +
        '<option value="replied">replied</option>' +
        '<option value="booked">booked</option>' +
        '<option value="archived">archived</option>' +
        "</select>" +
        "</div>" +
        '<div class="form-group">' +
        '<label for="notes-' +
        row.id +
        '">Notes</label>' +
        '<textarea id="notes-' +
        row.id +
        '" name="notes" rows="3" placeholder="Private notes (only owners see these)"></textarea>' +
        "</div>" +
        '<div class="inquiry-edit-actions">' +
        '<button type="submit" class="btn btn-primary">Save</button>' +
        '<span class="inquiry-save-msg" role="status"></span>' +
        "</div>";

      form.querySelector("select").value = status;
      form.querySelector("textarea").value = row.notes || "";

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        e.stopPropagation();
        saveInquiry(row.id, form, session, head);
      });

      body.appendChild(details);
      body.appendChild(msgBlock);
      body.appendChild(form);

      head.addEventListener("click", function () {
        var open = body.hidden;
        body.hidden = !open;
        head.setAttribute("aria-expanded", open ? "true" : "false");
        card.classList.toggle("is-open", open);
      });

      card.appendChild(head);
      card.appendChild(body);
      inquiryList.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function saveInquiry(id, form, session, head) {
    var status = form.querySelector("select").value;
    var notes = form.querySelector("textarea").value;
    var msg = form.querySelector(".inquiry-save-msg");
    var btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    if (msg) msg.textContent = "";

    fetch(SUPABASE_URL + "/rest/v1/inquiries?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: Object.assign(userHeaders(session.access_token), {
        Prefer: "return=minimal"
      }),
      body: JSON.stringify({ status: status, notes: notes })
    })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw { kind: "forbidden" };
        }
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error("Save failed (" + res.status + "): " + t);
          });
        }
        if (msg) msg.textContent = "Saved.";
        var badge = head.querySelector(".status-badge");
        if (badge) {
          badge.className = statusBadgeClass(status);
          badge.textContent = status;
        }
      })
      .catch(function (err) {
        console.error(err);
        if (msg) {
          msg.textContent =
            err && err.kind === "forbidden"
              ? "Not allowed — owner only."
              : "Couldn’t save. Try again.";
        }
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Save";
        }
      });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var emailInput = document.getElementById("owner-email");
      var email = (emailInput && emailInput.value.trim()) || "";
      var submitBtn = loginForm.querySelector('button[type="submit"]');
      if (!email) {
        if (loginStatus) {
          loginStatus.classList.add("is-visible");
          loginStatus.textContent = "Enter your owner email address.";
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending…";
      }
      if (loginStatus) {
        loginStatus.classList.add("is-visible");
        loginStatus.textContent = "Sending login link…";
      }

      // Redirect back to this admin page after magic-link click
      var redirectTo =
        window.location.origin +
        window.location.pathname.replace(/[^/]+$/, "admin.html");
      if (!/admin\.html$/i.test(redirectTo)) {
        redirectTo = window.location.origin + "/admin.html";
      }

      fetch(SUPABASE_URL + "/auth/v1/otp", {
        method: "POST",
        headers: anonHeaders(),
        body: JSON.stringify({
          email: email,
          options: { emailRedirectTo: redirectTo }
        })
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          }).catch(function () {
            return { ok: res.ok, data: null };
          });
        })
        .then(function (result) {
          if (result.ok) {
            if (loginStatus) {
              loginStatus.classList.add("is-visible");
              loginStatus.textContent =
                "Check your email for a login link. Only owner emails can see inquiries.";
            }
          } else {
            var errMsg =
              (result.data &&
                (result.data.error_description ||
                  result.data.msg ||
                  result.data.error)) ||
              "Couldn’t send login link. Try again.";
            if (loginStatus) {
              loginStatus.classList.add("is-visible");
              loginStatus.textContent = errMsg;
            }
          }
        })
        .catch(function () {
          if (loginStatus) {
            loginStatus.classList.add("is-visible");
            loginStatus.textContent =
              "Couldn’t send login link. Check your connection and try again.";
          }
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Send login link";
          }
        });
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", function () {
      clearSession();
      showLogin("Signed out. Enter your owner email to get a new login link.");
    });
  }

  ensureSession().then(function (session) {
    if (session && session.access_token) {
      showInbox(session);
    } else {
      showLogin("");
      if (loginStatus) {
        loginStatus.classList.remove("is-visible");
        loginStatus.textContent = "";
      }
    }
  });
})();
