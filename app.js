(function () {
  var root = document.documentElement;
  var themeBtn = document.getElementById("themeToggle");
  var skyDay = document.querySelector(".sky-day");
  var colorScheme = document.querySelector('meta[name="color-scheme"]');
  var themeColor = document.querySelector('meta[name="theme-color"]');
  var form = document.getElementById("loginForm");
  var email = document.getElementById("email");
  var password = document.getElementById("password");
  var remember = document.getElementById("remember");
  var toggle = document.getElementById("togglePassword");
  var msg = document.getElementById("formMsg");

  function paintChrome(theme) {
    if (themeColor) themeColor.setAttribute("content", theme === "light" ? "#8ec8ef" : "#041433");
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    var day = theme === "light";
    themeBtn.setAttribute("aria-label", day ? "Switch to night" : "Switch to daylight");
    if (colorScheme) colorScheme.setAttribute("content", theme);
  }

  applyTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark");
  paintChrome(root.getAttribute("data-theme"));

  skyDay.addEventListener("transitionend", function (e) {
    if (e.target !== skyDay || e.propertyName !== "opacity") return;
    paintChrome(root.getAttribute("data-theme"));
  });

  themeBtn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    try { localStorage.setItem("veyora-theme", next); } catch (e) {}
  });

  try {
    var saved = localStorage.getItem("veyora-email") || localStorage.getItem("harborline-email");
    if (saved) email.value = saved;
  } catch (e) {}

  function show(text, kind) {
    msg.hidden = false;
    msg.className = "form-msg " + kind;
    msg.textContent = text;
  }

  toggle.addEventListener("click", function () {
    var showText = password.type === "password";
    password.type = showText ? "text" : "password";
    toggle.setAttribute("aria-pressed", showText ? "true" : "false");
    toggle.setAttribute("aria-label", showText ? "Hide password" : "Show password");
  });

  var cfg = window.VEYORA_CONFIG || {};

  function finishSignIn() {
    show("Signed in. Opening KAHDHU…", "ok");
    try { localStorage.removeItem("veyora-view-company"); } catch (x) {}
    location.href = "dashboard.html";
  }

  // Staff-ID login: the staff-login Edge Function resolves the staff code
  // (<company code>-<employee no>) to the account and signs in. The account's
  // email is never exposed to the browser.
  function staffLogin(staffId, pass) {
    fetch(cfg.supabaseUrl + "/functions/v1/staff-login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: cfg.supabaseKey,
        authorization: "Bearer " + cfg.supabaseKey
      },
      body: JSON.stringify({ staffId: staffId, password: pass })
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    }).then(function (res) {
      if (res && res.session) {
        window.veyoraDb.auth.setSession(res.session).then(function (s) {
          if (s.error) { show("Staff ID or password is incorrect.", "err"); return; }
          finishSignIn();
        });
      } else {
        show((res && res.error) || "Staff ID or password is incorrect.", "err");
      }
    }).catch(function () {
      show("Sign-in is unavailable right now. Please try again.", "err");
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var idv = email.value.trim();
    var pass = password.value;
    if (!idv) {
      show("Enter your email or staff ID.", "err");
      email.focus();
      return;
    }
    if (!pass) {
      show("Enter your password.", "err");
      password.focus();
      return;
    }
    try {
      if (remember.checked) localStorage.setItem("veyora-email", idv);
      else localStorage.removeItem("veyora-email");
    } catch (err) {}
    show("Signing in…", "ok");

    if (idv.indexOf("@") > -1) {
      window.veyoraDb.auth.signInWithPassword({ email: idv.toLowerCase(), password: pass }).then(function (res) {
        if (res.error) { show("Email or password is incorrect.", "err"); return; }
        finishSignIn();
      });
    } else {
      staffLogin(idv, pass);
    }
  });

  document.querySelector(".forgot").addEventListener("click", function (e) {
    e.preventDefault();
    var mail = email.value.trim();
    if (!mail || mail.indexOf("@") === -1) {
      show("Enter your email first, then choose Forgot password.", "err");
      email.focus();
      return;
    }
    window.veyoraDb.auth.resetPasswordForEmail(mail).then(function () {
      show("If that email has an account, a reset link is on its way.", "ok");
    });
  });
})();
