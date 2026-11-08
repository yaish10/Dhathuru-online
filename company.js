(function () {
  var approvalRequired = false;
  var signin = document.getElementById("signinCard");
  var card = document.getElementById("companyCard");
  var form = document.getElementById("companyForm");
  var result = document.getElementById("companyResult");
  var msg = document.getElementById("companyMsg");
  var nameInput = document.getElementById("companyName");
  var typeInput = document.getElementById("companyType");
  var emailInput = document.getElementById("companyEmail");
  var phoneInput = document.getElementById("companyPhone");
  var logoInput = document.getElementById("companyLogo");
  var logoPreview = document.getElementById("logoPreview");
  var logoClear = document.getElementById("logoClear");
  var ownerEmail = document.getElementById("ownerEmail");
  var ownerPassword = document.getElementById("ownerPassword");
  var submitBtn = form.querySelector('button[type="submit"]');

  function statusName() {
    return approvalRequired ? "Pending" : "Active";
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function showMessage(text, kind) {
    msg.hidden = false;
    msg.className = "form-msg " + kind;
    msg.textContent = text;
  }

  function clearMessage() {
    msg.hidden = true;
    msg.textContent = "";
  }

  function openCompany() {
    signin.hidden = true;
    card.hidden = false;
    result.hidden = true;
    form.hidden = false;
    document.getElementById("company-title").hidden = false;
    card.querySelector(".lead").hidden = false;
    clearMessage();
    nameInput.focus();
  }

  function closeCompany() {
    card.hidden = true;
    signin.hidden = false;
  }

  function resetForm() {
    form.reset();
    typeInput.selectedIndex = 0;
    logoPreview.hidden = true;
    logoPreview.removeAttribute("src");
    logoClear.hidden = true;
    result.hidden = true;
    form.hidden = false;
    document.getElementById("company-title").hidden = false;
    card.querySelector(".lead").hidden = false;
    clearMessage();
    nameInput.focus();
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validPhone(value) {
    var digits = value.replace(/\D/g, "");
    return digits.length >= 6 && digits.length <= 15 && /^[+\d][\d\s().-]*$/.test(value);
  }

  function shrinkLogo(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        resolve(null);
        return;
      }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        reject(new Error("Choose a PNG, JPEG, WebP, or GIF logo."));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("That logo could not be read.")); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error("That logo could not be read.")); };
        image.onload = function () {
          var max = 256;
          var scale = Math.min(max / image.width, max / image.height, 1);
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error("That logo could not be read."));
          }, "image/png");
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  logoInput.addEventListener("change", function () {
    var file = logoInput.files && logoInput.files[0];
    if (!file) return;
    var url = URL.createObjectURL(file);
    logoPreview.src = url;
    logoPreview.hidden = false;
    logoClear.hidden = false;
    clearMessage();
  });

  logoClear.addEventListener("click", function () {
    logoInput.value = "";
    logoPreview.hidden = true;
    logoPreview.removeAttribute("src");
    logoClear.hidden = true;
  });

  document.getElementById("openCompany").addEventListener("click", openCompany);
  document.getElementById("closeCompany").addEventListener("click", closeCompany);
  document.getElementById("doneCompany").addEventListener("click", closeCompany);
  document.getElementById("createAnother").addEventListener("click", resetForm);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearMessage();
    var name = nameInput.value.trim();
    var type = typeInput.value;
    var email = emailInput.value.trim();
    var phone = phoneInput.value.trim();
    var types = ["Ferry Operator", "Speedboat Operator", "Both", "Other"];

    if (name.length < 2) {
      showMessage("Enter the company name.", "err");
      nameInput.focus();
      return;
    }
    if (types.indexOf(type) === -1) {
      showMessage("Select a company type.", "err");
      typeInput.focus();
      return;
    }
    if (email && !validEmail(email)) {
      showMessage("Enter a valid company email, or leave it blank.", "err");
      emailInput.focus();
      return;
    }
    if (phone && !validPhone(phone)) {
      showMessage("Enter a valid contact number, or leave it blank.", "err");
      phoneInput.focus();
      return;
    }

    var ownerMail = ownerEmail.value.trim();
    var ownerPass = ownerPassword.value;
    if (!validEmail(ownerMail)) {
      showMessage("Enter the email you will sign in with.", "err");
      ownerEmail.focus();
      return;
    }
    if (ownerPass.length < 8) {
      showMessage("Use a password of at least 8 characters.", "err");
      ownerPassword.focus();
      return;
    }

    var db = window.veyoraDb;
    var file = logoInput.files && logoInput.files[0];
    submitBtn.disabled = true;
    shrinkLogo(file).then(function (logoBlob) {
      return db.auth.signUp({ email: ownerMail, password: ownerPass }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if (!res.data.session) throw new Error("Check your email to confirm your account, then create the company.");
        return logoBlob;
      });
    }).then(function (logoBlob) {
      return db.from("companies").insert({
        name: name,
        type: type,
        email: email || null,
        phone: phone || null,
        status: statusName()
      }).select().single().then(function (res) {
        if (res.error) throw new Error(res.error.message);
        var row = res.data;
        if (!logoBlob) return row;
        var path = row.id + "/logo.png";
        return db.storage.from("company-logos").upload(path, logoBlob, { contentType: "image/png", upsert: true }).then(function (up) {
          if (up.error) throw new Error(up.error.message);
          return db.from("companies").update({ logo_path: path }).eq("id", row.id).select().single();
        }).then(function (upd) {
          if (upd.error) throw new Error(upd.error.message);
          return upd.data;
        });
      });
    }).then(function (row) {
      var company = {
        id: row.code,
        name: row.name,
        type: row.type,
        email: row.email || "",
        phone: row.phone || "",
        logo: row.logo_path ? db.storage.from("company-logos").getPublicUrl(row.logo_path).data.publicUrl : "",
        createdAt: row.created_at,
        status: row.status
      };
      document.getElementById("outName").textContent = company.name;
      document.getElementById("outType").textContent = company.type;
      document.getElementById("outEmail").textContent = company.email || "—";
      document.getElementById("outPhone").textContent = company.phone || "—";
      document.getElementById("outId").textContent = company.id;
      document.getElementById("outDate").textContent = formatDate(company.createdAt);
      var outStatus = document.getElementById("outStatus");
      outStatus.textContent = company.status;
      outStatus.className = "status" + (company.status === "Pending" ? " pending" : "");
      document.getElementById("resultLead").textContent = company.name + " is " + company.status.toLowerCase() + ".";
      var resultLogo = document.getElementById("resultLogo");
      if (company.logo) {
        resultLogo.src = company.logo;
        resultLogo.hidden = false;
      } else {
        resultLogo.hidden = true;
        resultLogo.removeAttribute("src");
      }
      form.hidden = true;
      result.hidden = false;
      document.getElementById("company-title").hidden = true;
      card.querySelector(".lead").hidden = true;
      /* Cursor 2026-10-23: first company → onboarding wizard (not settings welcome). */
      try { localStorage.setItem("veyora-view-company", row.id); } catch (e) {}
      location.href = "onboarding.html";
    }).catch(function (error) {
      showMessage(error.message || "The company could not be created.", "err");
    }).then(function () {
      submitBtn.disabled = false;
    });
  });
})();
