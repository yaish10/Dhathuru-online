/* "How this page works" strip: short plain-language steps, dismissible per page (remembered in this browser). */
(function () {
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function hidden(key) { try { return localStorage.getItem("veyora-tip-" + key) === "hide"; } catch (e) { return false; } }
  // steps: array of strings; **bold** is allowed for the words people will look for on the page.
  window.VeyoraTip = function (key, steps) {
    var host = document.getElementById("pageTip");
    if (!host) return;
    if (hidden(key)) { host.innerHTML = '<button type="button" class="tip-open" data-tipopen="' + key + '">How this page works</button>'; }
    else {
      host.innerHTML = '<div class="tip"><strong class="tip-h">How this page works</strong><ol>' + steps.map(function (s) {
        return "<li>" + esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") + "</li>";
      }).join("") + '</ol><button type="button" class="tip-x" data-tipclose="' + key + '" aria-label="Hide tips">Got it</button></div>';
    }
    host.onclick = function (e) {
      var c = e.target.closest("[data-tipclose]"), o = e.target.closest("[data-tipopen]");
      if (c) { try { localStorage.setItem("veyora-tip-" + key, "hide"); } catch (x) {} window.VeyoraTip(key, steps); }
      if (o) { try { localStorage.removeItem("veyora-tip-" + key); } catch (x) {} window.VeyoraTip(key, steps); }
    };
  };
})();
