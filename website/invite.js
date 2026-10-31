(function () {
  var token = (new URLSearchParams(location.search)).get("invite");
  if (!token) return;
  var db = window.veyoraDb;
  var signin = document.getElementById("signinCard");
  var card = document.getElementById("inviteCard");
  var form = document.getElementById("inviteForm");
  var msg = document.getElementById("inviteMsg");
  var email = document.getElementById("inviteEmail");
  var pass = document.getElementById("invitePassword");
  var existing = document.getElementById("inviteExisting");
  var btn = document.getElementById("inviteBtn");

  function say(t, kind) { msg.hidden = false; msg.className = "form-msg " + kind; msg.textContent = t; }

  signin.hidden = true;
  card.hidden = false;
  form.hidden = true;
  say("Checking your invite…", "ok");

  db.rpc("get_invite", { p_token: token }).then(function (r) {
    var row = r.data && r.data[0];
    if (r.error || !row) { say("This invite is invalid or has expired. Ask your administrator for a new link.", "err"); return; }
    document.getElementById("inviteCompany").textContent = row.company_name;
    document.getElementById("inviteLead").textContent = "You were invited as " + (row.role_label || row.role) + ".";
    email.value = row.email;
    form.hidden = false;
    msg.hidden = true;
  });

  existing.addEventListener("change", function () {
    document.getElementById("invitePassLabel").textContent = existing.checked ? "Your password" : "Choose a password";
    pass.autocomplete = existing.checked ? "current-password" : "new-password";
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (pass.value.length < 8) { say("Use a password of at least 8 characters.", "err"); pass.focus(); return; }
    btn.disabled = true;
    say("Joining…", "ok");
    var auth = existing.checked
      ? db.auth.signInWithPassword({ email: email.value, password: pass.value })
      : db.auth.signUp({ email: email.value, password: pass.value });
    auth.then(function (res) {
      if (res.error) {
        if (!existing.checked && /already registered/i.test(res.error.message)) {
          existing.checked = true; existing.dispatchEvent(new Event("change"));
          pass.value = ""; pass.focus();
          throw new Error("This email already has a VEYORA login. Enter the password you set for it and press Join again, or use Forgot password on the sign-in page.");
        }
        throw new Error(res.error.message);
      }
      if (!res.data.session) throw new Error("Could not sign in. If you already have an account, tick the box above and use your password.");
      return db.rpc("accept_invite", { p_token: token });
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      location.href = "dashboard.html";
    }).catch(function (err) {
      say(err.message, "err");
      btn.disabled = false;
    });
  });
})();
