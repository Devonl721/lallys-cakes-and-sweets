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

  // Contact form → copy inquiry text + open Facebook (no fake email)
  var form = document.getElementById("inquire-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = (form.querySelector("#name") || {}).value || "";
      var email = (form.querySelector("#email") || {}).value || "";
      var phone = (form.querySelector("#phone") || {}).value || "";
      var eventDate = (form.querySelector("#event-date") || {}).value || "";
      var message = (form.querySelector("#message") || {}).value || "";

      var text =
        "Inquiry for Lally's Cakes & Sweets\n" +
        "Name: " + name + "\n" +
        "Email: " + (email || "n/a") + "\n" +
        "Phone: " + (phone || "n/a") + "\n" +
        "Event date: " + (eventDate || "n/a") + "\n\n" +
        message;

      var success = document.getElementById("form-success");
      function showSuccess(copied) {
        if (!success) return;
        success.classList.add("is-visible");
        success.textContent = copied
          ? "Inquiry copied! Paste it into a Facebook Message — or call (484) 219-0445. Opening Facebook…"
          : "Thanks! Call (484) 219-0445 or message us on Facebook with your details. Opening Facebook…";
      }

      var copyPromise =
        navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; })
          : Promise.resolve(false);

      copyPromise.then(function (ok) {
        showSuccess(ok);
        window.open(FB_URL, "_blank", "noopener,noreferrer");
      });
    });
  }
})();
