/* Cursor 2026-10-23: shared nice dropdown UI for every page select.
   Keeps the native <select> (hidden) so existing change listeners still work. */
(function () {
  if (window.VeyoraSelect) return;

  var OPEN = null;
  var CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function skip(sel) {
    if (!sel || sel.tagName !== "SELECT") return true;
    if (sel.dataset.vsel === "skip" || sel.dataset.native != null) return true;
    if (sel.multiple || sel.size > 1) return true;
    if (sel.closest(".vsel")) return true;
    if (sel.offsetParent === null && !sel.closest("[hidden]")) {
      /* still enhance hidden-in-modal selects once modal opens */
    }
    return false;
  }

  function labelOf(sel) {
    var id = sel.id;
    if (id) {
      var lab = document.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
      if (lab) {
        var t = (lab.textContent || "").replace(/\s+/g, " ").trim();
        if (t) return t;
      }
    }
    return sel.getAttribute("aria-label") || sel.title || "";
  }

  function selectedText(sel) {
    var opt = sel.options[sel.selectedIndex];
    if (!opt) return "Choose…";
    return (opt.textContent || "").replace(/\s+/g, " ").trim() || "Choose…";
  }

  function closeOpen() {
    if (!OPEN) return;
    OPEN.classList.remove("open", "drop-up");
    var btn = OPEN.querySelector(".vsel-btn");
    var panel = OPEN.querySelector(".vsel-panel");
    var list = OPEN.querySelector(".vsel-list");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (panel) panel.hidden = true;
    if (list) list.style.maxHeight = "";
    OPEN = null;
  }

  // Cursor 2026-10-27: scroll the nearest scroller so an open list is fully on screen.
  function nearestScroller(el) {
    var n = el && el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      var st = window.getComputedStyle(n);
      var oy = st.overflowY || st.overflow;
      if ((oy === "auto" || oy === "scroll" || oy === "overlay") && n.scrollHeight > n.clientHeight + 1) return n;
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function portRect(scroller) {
    if (!scroller || scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      return { top: 0, bottom: window.innerHeight };
    }
    return scroller.getBoundingClientRect();
  }
  function scrollByPx(scroller, delta) {
    if (!delta) return;
    try {
      if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
        window.scrollBy({ top: delta, behavior: "smooth" });
      } else if (scroller.scrollBy) {
        scroller.scrollBy({ top: delta, behavior: "smooth" });
      } else {
        scroller.scrollTop += delta;
      }
    } catch (e) {
      scroller.scrollTop += delta;
    }
  }
  function placeAndReveal(wrap, panel) {
    wrap.classList.remove("drop-up");
    var list = panel.querySelector(".vsel-list");
    var btn = wrap.querySelector(".vsel-btn");
    if (!btn) return;
    var scroller = nearestScroller(wrap);
    var port = portRect(scroller);
    var btnRect = btn.getBoundingClientRect();
    var gap = 12;
    var spaceBelow = port.bottom - btnRect.bottom - gap;
    var spaceAbove = btnRect.top - port.top - gap;
    var want = 280;
    var dropUp = spaceBelow < Math.min(160, want) && spaceAbove > spaceBelow;
    if (dropUp) wrap.classList.add("drop-up");
    if (list) {
      var room = dropUp ? spaceAbove : spaceBelow;
      list.style.maxHeight = Math.max(120, Math.min(want, room > 80 ? room : want)) + "px";
    }
    requestAnimationFrame(function () {
      if (OPEN !== wrap || panel.hidden) return;
      var rect = panel.getBoundingClientRect();
      var portNow = portRect(scroller);
      var delta = 0;
      if (rect.bottom > portNow.bottom - 6) delta = rect.bottom - (portNow.bottom - gap);
      else if (rect.top < portNow.top + 6) delta = rect.top - (portNow.top + gap);
      scrollByPx(scroller, delta);
    });
  }

  function buildOptions(sel, list) {
    list.innerHTML = "";
    [].forEach.call(sel.options, function (opt, i) {
      if (opt.hidden) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "vsel-opt" + (opt.selected ? " on" : "") + (opt.disabled ? " dim" : "");
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", opt.selected ? "true" : "false");
      b.disabled = !!opt.disabled;
      b.dataset.index = String(i);
      b.innerHTML =
        '<span class="vsel-opt-txt">' + esc((opt.textContent || "").replace(/\s+/g, " ").trim() || "—") + "</span>" +
        (opt.selected ? '<span class="vsel-check" aria-hidden="true">' + CHECK + "</span>" : "");
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (opt.disabled) return;
        var prev = sel.value;
        sel.selectedIndex = i;
        if (sel.value !== prev) {
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          sel.dispatchEvent(new Event("input", { bubbles: true }));
        }
        sync(sel);
        closeOpen();
      });
      list.appendChild(b);
    });
    if (!list.children.length) {
      list.innerHTML = '<div class="vsel-empty">No options</div>';
    }
  }

  function sync(sel) {
    var wrap = sel.closest(".vsel");
    if (!wrap) return;
    var val = wrap.querySelector(".vsel-val");
    var lab = wrap.querySelector(".vsel-lab");
    if (val) val.textContent = selectedText(sel);
    if (lab) {
      var t = labelOf(sel);
      lab.textContent = t;
      lab.hidden = !t;
    }
    wrap.classList.toggle("has-val", !!sel.value);
    wrap.classList.toggle("is-empty", !sel.value);
    var list = wrap.querySelector(".vsel-list");
    if (list && wrap.classList.contains("open")) buildOptions(sel, list);
    else if (list) {
      /* refresh check marks quietly */
      [].forEach.call(list.querySelectorAll(".vsel-opt"), function (b) {
        var i = Number(b.dataset.index);
        var on = sel.selectedIndex === i;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        var chk = b.querySelector(".vsel-check");
        if (on && !chk) {
          var s = document.createElement("span");
          s.className = "vsel-check";
          s.setAttribute("aria-hidden", "true");
          s.innerHTML = CHECK;
          b.appendChild(s);
        } else if (!on && chk) chk.remove();
      });
    }
  }

  function enhanceOne(sel) {
    if (skip(sel) || sel.dataset.vsel === "1") return;
    sel.dataset.vsel = "1";

    var wrap = document.createElement("div");
    wrap.className = "vsel" + (sel.value ? " has-val" : " is-empty");
    if (sel.disabled) wrap.classList.add("disabled");
    if (sel.className) wrap.classList.add.apply(wrap.classList, sel.className.split(/\s+/).filter(Boolean).map(function (c) { return "vsel--" + c; }));

    var parent = sel.parentNode;
    parent.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    var labText = labelOf(sel);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vsel-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.disabled = !!sel.disabled;
    if (sel.id) btn.id = sel.id + "Btn";
    btn.innerHTML =
      (labText ? '<span class="vsel-lab">' + esc(labText) + "</span>" : '<span class="vsel-lab" hidden></span>') +
      '<span class="vsel-val">' + esc(selectedText(sel)) + "</span>" +
      '<span class="vsel-chev" aria-hidden="true">' + CHEV + "</span>";

    var panel = document.createElement("div");
    panel.className = "vsel-panel";
    panel.hidden = true;
    panel.setAttribute("role", "listbox");
    panel.innerHTML = '<div class="vsel-list"></div>';

    wrap.appendChild(btn);
    wrap.appendChild(panel);

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (sel.disabled) return;
      var opening = OPEN !== wrap;
      closeOpen();
      if (!opening) return;
      buildOptions(sel, panel.querySelector(".vsel-list"));
      wrap.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      panel.hidden = false;
      OPEN = wrap;
      var on = panel.querySelector(".vsel-opt.on");
      var list = panel.querySelector(".vsel-list");
      if (on && list) {
        list.scrollTop = Math.max(0, on.offsetTop - list.clientHeight / 2 + on.offsetHeight / 2);
      }
      placeAndReveal(wrap, panel);
    });

    sel.addEventListener("change", function () { sync(sel); });
    /* options often rebuilt after vessel/route change */
    var mo = new MutationObserver(function () { sync(sel); });
    mo.observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "value"] });

    var obsDis = new MutationObserver(function () {
      btn.disabled = !!sel.disabled;
      wrap.classList.toggle("disabled", !!sel.disabled);
    });
    obsDis.observe(sel, { attributes: true, attributeFilter: ["disabled"] });
  }

  function enhance(root) {
    root = root || document;
    if (root.nodeType === 1 && root.matches && root.matches("select")) {
      enhanceOne(root);
      return;
    }
    [].forEach.call((root.querySelectorAll ? root : document).querySelectorAll("select"), enhanceOne);
  }

  document.addEventListener("click", function (e) {
    if (!OPEN) return;
    if (OPEN.contains(e.target)) return;
    closeOpen();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeOpen();
  });

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      enhance(document);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      enhance(document);
      new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    });
  } else {
    enhance(document);
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.VeyoraSelect = { enhance: enhance, sync: sync, close: closeOpen };
})();
