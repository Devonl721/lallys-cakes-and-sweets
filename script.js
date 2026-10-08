/* Lally's Cakes & Sweets — small UX helpers */
(function () {
  "use strict";

  var FB_URL = "https://www.facebook.com/LallysCakesandSweets/";

  // Public Supabase project (anon key + RLS). Embedded for GitHub Pages.
  var SUPABASE_URL = "https://xpvytjomwmvycxfgyxcg.supabase.co";
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhwdnl0am9td212eWN4Zmd5eGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjkxODQsImV4cCI6MjEwNTgwNTE4NH0.5X1xXV-pZzBbDxMm_uuBhMsHEqYXCvQk--6ezya2LB0";

  // Mobile nav
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Menu category tabs
  var tabs = document.querySelectorAll(".menu-tab");
  var panels = document.querySelectorAll(".menu-panel");
  if (tabs.length && panels.length) {
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.getAttribute("data-panel");
        tabs.forEach(function (t) {
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        panels.forEach(function (p) {
          var on = p.id === target;
          p.classList.toggle("is-active", on);
          if (on) p.removeAttribute("hidden");
          else p.setAttribute("hidden", "");
        });
      });
    });
  }

  function saveInquiryToSupabase(fields) {
    var body = {
      name: fields.name,
      email: fields.email,
      phone: fields.phone || null,
      event_date: fields.eventDate || null,
      // Optional order details are appended to the message text as labeled lines
      // (no extra columns, so the public insert and its trigger keep working).
      message: fields.dbMessage || fields.message
    };
    return fetch(SUPABASE_URL + "/rest/v1/inquiries", {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("Supabase insert failed (" + res.status + "): " + t);
        });
      }
    });
  }

  // Contact form → FormSubmit AJAX + Supabase inquiries
  // The text-message alert is no longer sent from the page; it is forwarded
  // from the bakery inbox (see the Brief 27 notes), so no phone address ships here.
  var form = document.getElementById("inquire-form");

  // Spam checks: a hidden honeypot field and a minimum time on the page.
  var MIN_FILL_MS = 3000;
  var formReadyAt = Date.now();

  // Custom-cake notice: event and pickup dates must be at least 14 days out,
  // counted from today in the visitor's own time zone at page load.
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function isoLocal(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  var minDate = new Date();
  minDate.setHours(12, 0, 0, 0);
  minDate.setDate(minDate.getDate() + 14);
  var MIN_DATE_ISO = isoLocal(minDate);
  var MIN_DATE_TEXT = minDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  function checkDateField(input) {
    if (!input) return true;
    var err = document.getElementById(input.id + "-error");
    var v = String(input.value || "");
    var tooSoon = /^\d{4}-\d{2}-\d{2}$/.test(v) && v < MIN_DATE_ISO;
    if (tooSoon) {
      input.setAttribute("aria-invalid", "true");
      if (err) {
        err.textContent = "Please choose " + MIN_DATE_TEXT + " or later. Custom cakes need at least 2 weeks’ notice.";
        err.hidden = false;
      }
    } else {
      input.removeAttribute("aria-invalid");
      if (err) {
        err.textContent = "";
        err.hidden = true;
      }
    }
    return !tooSoon;
  }

  var dateInputs = form ? form.querySelectorAll('input[type="date"][data-min-days]') : [];
  Array.prototype.forEach.call(dateInputs, function (input) {
    input.min = MIN_DATE_ISO;
    input.addEventListener("change", function () { checkDateField(input); });
    input.addEventListener("blur", function () { checkDateField(input); });
  });

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var success = document.getElementById("form-success");
      var honey = (form.querySelector("#hp-website") || {}).value || "";
      var submitBtn = form.querySelector('button[type="submit"]');
      var name = (form.querySelector("#name") || {}).value || "";
      var email = (form.querySelector("#email") || {}).value || "";
      var phone = (form.querySelector("#phone") || {}).value || "";
      var eventDate = (form.querySelector("#event-date") || {}).value || "";
      var message = (form.querySelector("#message") || {}).value || "";

      // Optional order details (label → value); only filled-in ones are sent
      var OPTIONAL_FIELDS = [
        ["#servings", "Number of servings"],
        ["#flavors", "Flavors"],
        ["#design-link", "Design photo link"],
        ["#dietary", "Dietary needs / allergies"],
        ["#pickup-date", "Preferred pickup date"],
        ["#pickup-time", "Preferred pickup time"]
      ];
      var extras = [];
      OPTIONAL_FIELDS.forEach(function (f) {
        var input = form.querySelector(f[0]);
        var v = input ? String(input.value || "").trim() : "";
        if (v) extras.push({ label: f[1], value: v });
      });

      // Honeypot filled in: almost certainly a bot. Pretend it worked and send nothing.
      if (honey.trim()) {
        form.reset();
        if (success) {
          success.classList.add("is-visible");
          success.textContent = "Thanks! Your inquiry is on its way to Lally's Cakes & Sweets. We’ll be in touch soon.";
        }
        return;
      }

      if (!name.trim() || !email.trim() || !message.trim()) {
        if (success) {
          success.classList.add("is-visible");
          success.textContent =
            "Please fill in your name, email, and what you’d like so we can reply.";
        }
        return;
      }

      // Too-soon event or pickup date: show the message under the field and stop.
      var datesOk = true;
      var firstBadDate = null;
      Array.prototype.forEach.call(dateInputs, function (input) {
        if (!checkDateField(input)) {
          datesOk = false;
          if (!firstBadDate) firstBadDate = input;
        }
      });
      if (!datesOk) {
        if (success) {
          success.classList.add("is-visible");
          success.textContent = "Please choose a date at least 2 weeks from today (" + MIN_DATE_TEXT + " or later).";
        }
        if (firstBadDate) firstBadDate.focus();
        return;
      }

      // Submitted faster than a person can fill the form: ask them to try again.
      if (Date.now() - formReadyAt < MIN_FILL_MS) {
        if (success) {
          success.classList.add("is-visible");
          success.textContent = "Please take a moment to check your details, then press Send inquiry again.";
        }
        return;
      }

      var designInput = form.querySelector("#design-link");
      var servingsInput = form.querySelector("#servings");
      if (
        (designInput && designInput.value.trim() && !designInput.checkValidity()) ||
        (servingsInput && servingsInput.value && !servingsInput.checkValidity())
      ) {
        if (success) {
          success.classList.add("is-visible");
          success.textContent =
            designInput && designInput.value.trim() && !designInput.checkValidity()
              ? "Please check the design photo link. It should start with https://"
              : "Please enter the number of servings as a whole number.";
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending…";
      }
      if (success) {
        success.classList.add("is-visible");
        success.textContent = "Sending your inquiry…";
      }

      var trimmed = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        eventDate: eventDate,
        message: message.trim()
      };
      trimmed.dbMessage = extras.length
        ? trimmed.message +
          "\n\n--- Order details (from inquiry form) ---\n" +
          extras.map(function (x) { return x.label + ": " + x.value; }).join("\n")
        : trimmed.message;

      var payload = {
        Name: trimmed.name,
        Email: trimmed.email,
        Phone: trimmed.phone || "—",
        "Event date": trimmed.eventDate || "—",
        Message: trimmed.message,
        _subject: "New inquiry — Lally's Cakes & Sweets",
        _template: "box",
        _captcha: "false",
        _honey: honey,
        _replyto: trimmed.email
      };
      extras.forEach(function (x) {
        payload[x.label] = x.value;
      });

      var emailPromise = fetch(
        "https://formsubmit.co/ajax/lallyscakesandsweets@gmail.com",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(payload)
        }
      ).then(function (res) {
        return res
          .json()
          .then(function (data) {
            return { ok: res.ok, data: data };
          })
          .catch(function () {
            return { ok: res.ok, data: null };
          });
      });

      var supabasePromise = saveInquiryToSupabase(trimmed).catch(function (err) {
        console.error("Could not save inquiry to Supabase:", err);
        return { supabaseFailed: true };
      });

      Promise.all([emailPromise, supabasePromise])
        .then(function (results) {
          var emailResult = results[0];
          var sbResult = results[1];
          // FormSubmit can answer HTTP 200 with {"success":"false"} (e.g. a form that needs activation).
          var emailOk = emailResult.ok && !(emailResult.data && String(emailResult.data.success) === "false");
          var savedOk = !(sbResult && sbResult.supabaseFailed);
          if (!emailOk) console.warn("Inquiry email was not accepted by FormSubmit:", emailResult.data);
          if (emailOk || savedOk) {
            form.reset();
            if (success) {
              success.classList.add("is-visible");
              if (!savedOk) {
                success.textContent =
                  "Thanks! Your inquiry email was sent to Lally's Cakes & Sweets. We’ll be in touch soon.";
              } else {
                success.textContent =
                  "Thanks! Your inquiry is on its way to Lally's Cakes & Sweets. We’ll be in touch soon.";
              }
            }
          } else {
            if (success) {
              success.classList.add("is-visible");
              success.textContent =
                "Sorry — we couldn’t send that just now. Please try again, or use Call, Email, or Facebook below the form.";
            }
          }
        })
        .catch(function () {
          if (success) {
            success.classList.add("is-visible");
            success.textContent =
              "Sorry — we couldn’t send that just now. Please try again, or use Call, Email, or Facebook below the form.";
          }
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Send inquiry";
          }
        });
    });
  }
})();
