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
      message: fields.message
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
  var form = document.getElementById("inquire-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var success = document.getElementById("form-success");
      var submitBtn = form.querySelector('button[type="submit"]');
      var name = (form.querySelector("#name") || {}).value || "";
      var email = (form.querySelector("#email") || {}).value || "";
      var phone = (form.querySelector("#phone") || {}).value || "";
      var eventDate = (form.querySelector("#event-date") || {}).value || "";
      var message = (form.querySelector("#message") || {}).value || "";

      if (!name.trim() || !email.trim() || !message.trim()) {
        if (success) {
          success.classList.add("is-visible");
          success.textContent =
            "Please fill in your name, email, and message so we can reply.";
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

      var payload = {
        Name: trimmed.name,
        Email: trimmed.email,
        Phone: trimmed.phone || "—",
        "Event date": trimmed.eventDate || "—",
        Message: trimmed.message,
        _subject: "New inquiry — Lally's Cakes & Sweets",
        _template: "box",
        _captcha: "false",
        _honey: "",
        _replyto: trimmed.email,
        _cc: "6108589208@tmomail.net"
      };

      var emailPromise = fetch(
        "https://formsubmit.co/ajax/devonl721@icloud.com",
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
          if (emailResult.ok) {
            form.reset();
            if (success) {
              success.classList.add("is-visible");
              if (sbResult && sbResult.supabaseFailed) {
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
                "Sorry — we couldn’t send that just now. Please try again, or use Call, Email, or Facebook above.";
            }
          }
        })
        .catch(function () {
          if (success) {
            success.classList.add("is-visible");
            success.textContent =
              "Sorry — we couldn’t send that just now. Please try again, or use Call, Email, or Facebook above.";
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
