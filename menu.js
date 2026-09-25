/* Lally's Cakes & Sweets — menu page: renders menu-data.json, live search, category jump bar */
(function () {
  "use strict";

  var root = document.getElementById("menu-root");
  if (!root) return;

  var jump = document.getElementById("menu-jump");
  var search = document.getElementById("menu-search");
  var status = document.getElementById("menu-status");
  var empty = document.getElementById("menu-empty");
  var emptyTerm = document.getElementById("menu-empty-term");
  var clearBtn = document.getElementById("menu-clear");
  var toolbar = document.getElementById("menu-toolbar");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  var sections = [];
  var cards = [];

  function render(data) {
    root.textContent = "";
    jump.textContent = "";

    (data.categories || []).forEach(function (cat) {
      var sec = el("section", "menu-category");
      sec.id = "cat-" + cat.id;
      sec.setAttribute("aria-labelledby", "h-" + cat.id);

      var h = el("h2", "menu-category-title", cat.name);
      h.id = "h-" + cat.id;
      sec.appendChild(h);

      var grid = el("div", "menu-grid");
      (cat.items || []).forEach(function (item) {
        var card = el("article", "menu-card" + (item.custom ? " is-custom" : ""));
        var head = el("div", "menu-card-head");
        head.appendChild(el("h3", null, item.name));
        head.appendChild(el("span", "menu-card-price", item.priceLabel || ""));
        card.appendChild(head);

        if (item.description) card.appendChild(el("p", "menu-card-desc", item.description));

        var text = [item.name, item.description, cat.name];
        if (item.variations && item.variations.length) {
          var ul = el("ul", "menu-options");
          item.variations.forEach(function (v) {
            var li = el("li");
            li.appendChild(el("span", "menu-option-name", v.name));
            li.appendChild(el("span", "menu-option-price", v.priceLabel || ""));
            li.setAttribute("data-search", norm(v.name));
            ul.appendChild(li);
            text.push(v.name);
          });
          card.appendChild(ul);
        }

        if (item.custom) {
          var a = el("a", "menu-card-link", "Send us an inquiry →");
          a.href = "contact.html";
          card.appendChild(a);
        }

        card.setAttribute("data-search", norm(text.join(" ")));
        card.setAttribute("data-head", norm([item.name, item.description, cat.name].join(" ")));
        grid.appendChild(card);
        cards.push(card);
      });
      sec.appendChild(grid);
      root.appendChild(sec);
      sections.push(sec);

      var link = el("a", "menu-jump-link", cat.name);
      link.href = "#cat-" + cat.id;
      link.setAttribute("data-target", sec.id);
      jump.appendChild(link);
    });

    applyFilter();
    observe();
    syncOffsets();
  }

  function applyFilter() {
    var q = norm(search ? search.value : "");
    var terms = q ? q.split(" ") : [];
    var shownCards = 0;

    cards.forEach(function (card) {
      var hay = card.getAttribute("data-search");
      var match = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      card.hidden = !match;
      // When the item name/category itself matches, show all options; otherwise highlight matching options
      var headHit = terms.length && terms.every(function (t) { return card.getAttribute("data-head").indexOf(t) !== -1; });
      card.querySelectorAll(".menu-options li").forEach(function (li) {
        var hit = terms.length && !headHit && terms.every(function (t) {
          return (li.getAttribute("data-search") + " " + card.getAttribute("data-head")).indexOf(t) !== -1;
        }) && terms.some(function (t) { return li.getAttribute("data-search").indexOf(t) !== -1; });
        li.classList.toggle("is-match", !!hit);
      });
      if (match) shownCards++;
    });

    sections.forEach(function (sec) {
      var visible = sec.querySelectorAll(".menu-card:not([hidden])").length;
      sec.hidden = visible === 0;
      var link = jump.querySelector('[data-target="' + sec.id + '"]');
      if (link) link.hidden = visible === 0;
    });

    if (empty) {
      empty.hidden = !(terms.length && shownCards === 0);
      if (emptyTerm) emptyTerm.textContent = search.value.trim();
    }
    if (status) {
      status.textContent = terms.length
        ? shownCards + (shownCards === 1 ? " item matches" : " items match") + " “" + search.value.trim() + "”"
        : "";
    }
  }

  var observer;
  function setActive(id) {
    jump.querySelectorAll(".menu-jump-link").forEach(function (a) {
      var on = a.getAttribute("data-target") === id;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
      if (on && jump.scrollWidth > jump.clientWidth) {
        var left = a.offsetLeft - (jump.clientWidth - a.offsetWidth) / 2;
        jump.scrollTo({ left: left, behavior: "smooth" });
      }
    });
  }
  function observe() {
    if (!("IntersectionObserver" in window)) return;
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) setActive(e.target.id);
        });
      },
      { rootMargin: "-35% 0px -60% 0px" }
    );
    sections.forEach(function (s) { observer.observe(s); });
  }

  // Keep scroll offset in sync with sticky header + toolbar heights
  function syncOffsets() {
    var header = document.querySelector(".site-header");
    var hh = header ? header.offsetHeight : 0;
    document.documentElement.style.setProperty("--menu-header-h", hh + "px");
    var th = toolbar ? toolbar.offsetHeight : 0;
    document.documentElement.style.setProperty("--menu-scroll-offset", hh + th + 12 + "px");
  }
  syncOffsets();
  window.addEventListener("resize", syncOffsets);

  if (search) {
    search.addEventListener("input", applyFilter);
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { search.value = ""; applyFilter(); }
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      search.value = "";
      applyFilter();
      search.focus();
    });
  }

  fetch("menu-data.json", { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(render)
    .catch(function (err) {
      console.error("Could not load menu-data.json:", err);
      root.textContent = "";
      var p = el("p", "menu-note");
      p.innerHTML =
        'Sorry, our menu didn’t load. Please call <a href="tel:+14842190445">(484) 219-0445</a> or ' +
        '<a href="https://m.me/LallysCakesandSweets" target="_blank" rel="noopener noreferrer">message us on Facebook</a> for today’s treats and prices.';
      root.appendChild(p);
    });
})();
