/* Lally's Cakes & Sweets — small UX helpers */
(function () {
  "use strict";

  var FB_URL = "https://www.facebook.com/LallysCakesandSweets/";

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

  // Contact form → FormSubmit AJAX to bakery email
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
          success.textContent = "Please fill in your name, email, and message so we can reply.";
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

      var payload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        event_date: eventDate,
        message: message.trim(),
        _subject: "New inquiry — Lally's Cakes & Sweets",
        _template: "table",
        _captcha: "false",
        _honey: ""
      };

      fetch("https://formsubmit.co/ajax/devonl721@icloud.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
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
            form.reset();
            if (success) {
              success.classList.add("is-visible");
              success.textContent = "Thanks! Your inquiry is on its way to Lally's Cakes & Sweets. We’ll be in touch soon.";
            }
          } else {
            if (success) {
              success.classList.add("is-visible");
              success.textContent = "Sorry — we couldn’t send that just now. Please try again, or use Call, Email, or Facebook above.";
            }
          }
        })
        .catch(function () {
          if (success) {
            success.classList.add("is-visible");
            success.textContent = "Sorry — we couldn’t send that just now. Please try again, or use Call, Email, or Facebook above.";
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
