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

  // Category heading thumbnails (images/menu). Only categories the photo truly shows.
  var THUMBS = {
    "stand": { file: "e-hershey-cupcakes" },
    "pies-pastries": { file: "g-key-lime-pie" },
    "fried-pretzels": { file: "j-funnel-fries" }
  };

  // Short labels for the sticky category buttons on phones (full name stays for screen readers)
  var SHORT = {
    "stand": "Sweets",
    "cakes": "Cakes",
    "whoopie-pies": "Whoopie pies",
    "pies-pastries": "Pies",
    "candy": "Candy",
    "fried-pretzels": "Fried treats",
    "drinks": "Drinks",
    "honey": "Honey"
  };

  // Phones: lists with this many rows or more show the first VISIBLE_ROWS plus a "Show all (N)" button
  var COLLAPSE_AT = 6;
  var VISIBLE_ROWS = 3;

  var sections = [];
  var cards = [];
  var featured = null; // first row marked with a "badge" in menu-data.json
  var listCount = 0;

  function render(data) {
    root.textContent = "";
    jump.textContent = "";

    (data.categories || []).forEach(function (cat) {
      var sec = el("section", "menu-category");
      sec.id = "cat-" + cat.id;
      sec.setAttribute("aria-labelledby", "h-" + cat.id);

      var h = el("h2", "menu-category-title", cat.name);
      h.id = "h-" + cat.id;
      var thumb = THUMBS[cat.id];
      if (thumb) {
        // Small photo beside the heading, only where the photo truly matches the category.
        var pic = document.createElement("picture");
        var src = document.createElement("source");
        src.type = "image/webp";
        src.srcset = "images/menu/" + thumb.file + "-160.webp";
        pic.appendChild(src);
        var img = document.createElement("img");
        img.className = "menu-category-thumb";
        img.src = "images/menu/" + thumb.file + "-160.jpg";
        img.width = 160;
        img.height = 160;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = ""; // decorative: the heading text already names the category
        pic.appendChild(img);
        h.classList.add("has-thumb");
        h.insertBefore(pic, h.firstChild);
      }
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
          ul.id = "menu-list-" + (++listCount);
          item.variations.forEach(function (v) {
            var li = el("li");
            var nm = el("span", "menu-option-name", v.name);
            if (v.badge) {
              nm.appendChild(document.createTextNode(" "));
              nm.appendChild(el("span", "menu-badge", v.badge));
              li.classList.add("has-badge");
              if (!featured) {
                li.id = "menu-favorite";
                featured = { item: item, row: v, cat: cat };
              }
            }
            li.appendChild(nm);
            li.appendChild(el("span", "menu-option-price", v.priceLabel || ""));
            li.setAttribute("data-search", norm(v.name));
            ul.appendChild(li);
            text.push(v.name);
          });
          card.appendChild(ul);
          if (item.variations.length >= COLLAPSE_AT) addToggle(card, ul, item.variations.length);
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

      var link = el("a", "menu-jump-link");
      if (SHORT[cat.id] && SHORT[cat.id] !== cat.name) {
        link.appendChild(el("span", "menu-jump-full", cat.name));
        var short = el("span", "menu-jump-short", SHORT[cat.id]);
        short.setAttribute("aria-hidden", "true");
        link.appendChild(short);
      } else {
        link.textContent = cat.name;
      }
      link.href = "#cat-" + cat.id;
      link.setAttribute("data-target", sec.id);
      jump.appendChild(link);
    });

    renderFeatured();
    applyFilter();
    observe();
    syncOffsets();
  }

  // Collapsible flavor list. The collapse only applies on phones (CSS media query) and only once JS adds the class.
  function addToggle(card, ul, n) {
    card.classList.add("is-collapsible", "is-collapsed");
    var btn = el("button", "menu-more", "Show all (" + n + ")");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", ul.id);
    btn.addEventListener("click", function () {
      var collapsed = card.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.textContent = collapsed ? "Show all (" + n + ")" : "Show fewer";
      if (collapsed) {
        var r = card.getBoundingClientRect();
        var off = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--menu-scroll-offset"), 10) || 0;
        if (r.top < off) window.scrollBy(0, r.top - off);
      }
    });
    card.appendChild(btn);
  }

  // "Stand favorite" card near the top, built from the same menu-data.json row (single source of truth)
  function renderFeatured() {
    var box = document.getElementById("menu-featured");
    if (!box) return;
    box.textContent = "";
    if (!featured) { box.hidden = true; return; }
    var name = featured.row.name;
    var m = /^(.*?)\s*\((.+)\)$/.exec(name);
    box.appendChild(el("p", "menu-featured-label", featured.row.badge));
    var head = el("div", "menu-featured-head");
    head.appendChild(el("h2", "menu-featured-name", m ? m[1] : name));
    head.appendChild(el("span", "menu-featured-price", featured.row.priceLabel || ""));
    box.appendChild(head);
    if (m) box.appendChild(el("p", "menu-featured-desc", m[2]));
    var foot = el("p", "menu-featured-foot");
    foot.appendChild(document.createTextNode(featured.item.name + " · "));
    var a = el("a", null, "See it on the menu");
    a.href = "#menu-favorite";
    foot.appendChild(a);
    box.appendChild(foot);
    box.hidden = false;
  }

  function applyFilter() {
    var q = norm(search ? search.value : "");
    var terms = q ? q.split(" ") : [];
    var shownCards = 0;

    cards.forEach(function (card) {
      var hay = card.getAttribute("data-search");
      var match = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      card.hidden = !match;
      card.classList.toggle("is-searching", terms.length > 0); // searching shows every row, even collapsed ones
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
