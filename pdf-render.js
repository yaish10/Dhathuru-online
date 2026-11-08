/* PDF Layout Maker — shared HTML/CSS document renderer (preview + PDF use the same output).
   Cursor 2026-10-24: flow layout, @page sizes in mm, no editor screenshots. */
(function () {
  var Schema = function () { return window.VeyoraPdfSchema; };
  var Fields = function () { return window.VeyoraPdfFields; };

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function visibleSections(cfg) {
    return (cfg.sections || []).filter(function (s) { return s && s.visible !== false; });
  }

  function isCanvas(cfg) {
    return Schema().isCanvas ? Schema().isCanvas(cfg) : !!(cfg && cfg.blocks && cfg.blocks.length);
  }

  function printCss(cfg) {
    var dims = Schema().pageDims(cfg.page);
    var m = dims.margins;
    var canvas = isCanvas(cfg);
    var font = cfg.page.fontFamily === "serif" ? "Georgia,'Times New Roman',serif" : "Arial,Helvetica,sans-serif";
    var accent = (cfg.theme && cfg.theme.accent) || cfg.page.accentColor || "#1677e8";
    var text = cfg.page.textColor || "#111827";
    var size = Number(cfg.page.baseFontSize) || 11;
    var pageMargin = canvas
      ? "0"
      : (m.top + "mm " + m.right + "mm " + m.bottom + "mm " + m.left + "mm");
    var pad = canvas ? "0" : (m.top + "mm " + m.right + "mm " + m.bottom + "mm " + m.left + "mm");
    return [
      "@page{size:" + dims.w + "mm " + dims.h + "mm;margin:" + pageMargin + ";}",
      "html,body{margin:0;padding:0;background:#fff;}",
      ".vey-doc{box-sizing:border-box;width:" + dims.w + "mm;" + (canvas ? "height:" + dims.h + "mm;overflow:hidden;" : "min-height:" + dims.h + "mm;") + "padding:" + pad + ";",
      "color:" + text + ";font-family:" + font + ";font-size:" + size + "pt;line-height:1.45;background:" + (cfg.page.background || "#fff") + ";" + (canvas ? "position:relative;" : "") + "}",
      ".vey-doc *{box-sizing:border-box;}",
      ".vey-abs{position:absolute;overflow:hidden;}",
      ".vey-abs.vey-grow{overflow:visible;}",
      ".vey-abs .vey-head,.vey-abs .vey-title,.vey-abs .vey-meta,.vey-abs .vey-party,.vey-abs .vey-table,.vey-abs .vey-totals,.vey-abs .vey-block,.vey-abs .vey-sign,.vey-abs .vey-foot{margin:0;width:100%;}",
      ".vey-abs .vey-head{height:100%;padding:0;border-bottom:0;gap:8px;align-items:flex-start;}",
      ".vey-abs .vey-title{line-height:1.15;}",
      ".vey-abs .vey-party,.vey-abs .vey-block{height:100%;}",
      ".vey-abs .vey-sign{margin-top:0;height:100%;}",
      ".vey-abs .vey-sign .line{margin-top:auto;}",
      ".vey-abs .vey-foot{border-top:0;padding:0;}",
      ".vey-logo{width:100%;height:100%;display:flex;align-items:center;}",
      ".vey-logo img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;}",
      ".vey-logo.vey-ph{border:1px dashed #cbd5e1;border-radius:6px;color:#94a3b8;font-size:8pt;justify-content:center;letter-spacing:.06em;text-transform:uppercase;}",
      ".vey-field span{display:block;font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;}",
      ".vey-field strong{display:block;font-size:11pt;font-weight:700;margin-top:1px;}",
      ".vey-text{white-space:pre-wrap;word-break:break-word;}",
      ".vey-hr{border:0;border-top:1.5px solid " + accent + ";margin:1mm 0 0;}",
      ".vey-pagenum{font-size:8pt;color:#64748b;text-align:right;}",
      ".vey-sample{display:inline-block;margin-bottom:8px;padding:3px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:9pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;}",
      ".vey-head{display:flex;align-items:center;gap:12px;padding-bottom:10px;margin-bottom:14px;border-bottom:2px solid " + accent + ";}",
      ".vey-head img{height:42px;width:auto;max-width:140px;object-fit:contain;}",
      ".vey-head strong{font-size:14pt;letter-spacing:-.02em;}",
      ".vey-head small{display:block;margin-top:2px;font-size:9pt;color:#64748b;font-weight:500;}",
      ".vey-title{font-size:18pt;margin:0 0 10px;letter-spacing:-.02em;color:" + accent + ";}",
      ".vey-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:0 0 14px;font-size:10pt;}",
      ".vey-meta div span{display:block;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;}",
      ".vey-party{margin:0 0 14px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;}",
      ".vey-party h3{margin:0 0 4px;font-size:9pt;text-transform:uppercase;letter-spacing:.06em;color:#64748b;}",
      ".vey-party strong{font-size:11pt;}",
      ".vey-table{width:100%;border-collapse:collapse;margin:0 0 14px;font-size:10pt;}",
      ".vey-table th{background:" + ((cfg.theme && cfg.theme.tableHeaderBg) || "#eaf3ff") + ";color:#0f2a55;text-align:left;padding:7px 8px;border-bottom:1px solid #c9dcf8;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;}",
      ".vey-table td{padding:7px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;}",
      ".vey-table tr.stripe td{background:" + ((cfg.theme && cfg.theme.stripe) || "#f8fafc") + ";}",
      ".vey-table .num{text-align:right;font-variant-numeric:tabular-nums;}",
      ".vey-table thead{display:table-header-group;}",
      ".vey-table tr{break-inside:avoid;page-break-inside:avoid;}",
      ".vey-totals{width:48%;margin-left:auto;margin-bottom:14px;font-size:10pt;}",
      ".vey-canvas .vey-totals{width:100%;margin:0 0 0 auto;}",
      ".vey-totals div{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid #e2e8f0;}",
      ".vey-totals .grand{font-weight:800;font-size:12pt;border-bottom:0;padding-top:8px;color:" + accent + ";}",
      ".vey-block{margin:0 0 12px;}",
      ".vey-block h3{margin:0 0 4px;font-size:9pt;text-transform:uppercase;letter-spacing:.06em;color:#64748b;}",
      ".vey-sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:28px;break-inside:avoid;page-break-inside:avoid;}",
      ".vey-sign .line{margin-top:40px;border-top:1px solid #94a3b8;padding-top:6px;font-size:9pt;color:#64748b;}",
      ".vey-foot{margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:8.5pt;color:#64748b;}",
      ".vey-warn{margin:8px 0;padding:8px 10px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:9pt;border-radius:6px;}",
      "@media print{.vey-doc{width:auto;" + (canvas ? "" : "min-height:auto;padding:0;") + "}}"
    ].join("");
  }

  function resolve(data, key) {
    return Fields().getPath(data, key);
  }

  function fmt(data, key, type) {
    return Fields().format(resolve(data, key), type, data._currency);
  }

  function renderTable(cfg, data) {
    var cols = (cfg.table && cfg.table.columns) || [];
    var rows = [];
    if (data.invoice && data.invoice.items) rows = data.invoice.items;
    else if (data.payroll && data.payroll.lines) rows = data.payroll.lines;
    else if (data.report && data.report.rows) rows = data.report.rows;
    if (!rows.length) {
      return '<p class="vey-block" style="color:#64748b">No rows to display.</p>';
    }
    var stripe = !cfg.table || cfg.table.stripe !== false;
    var head = "<thead><tr>" + cols.map(function (c) {
      return '<th class="' + (c.align === "right" ? "num" : "") + '" style="width:' + (c.width || 20) + '%">' + esc(c.label) + "</th>";
    }).join("") + "</tr></thead>";
    var body = "<tbody>" + rows.map(function (row, i) {
      return '<tr class="' + (stripe && i % 2 ? "stripe" : "") + '">' + cols.map(function (c) {
        var raw = row[c.key];
        var val = c.format ? Fields().format(raw, c.format, data._currency) : (raw == null ? "" : String(raw));
        return '<td class="' + (c.align === "right" || c.format === "money" || c.format === "number" ? "num" : "") + '">' + esc(val) + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody>";
    return '<table class="vey-table">' + head + body + "</table>";
  }


  /* ---------- Passenger ticket card (landscape, with tear-off QR stub) ---------- */
  function qrSvg(text) {
    try {
      if (!window.qrcode) return "";
      var qr = window.qrcode(0, "M"); qr.addData(String(text || "")); qr.make();
      var n = qr.getModuleCount(), d = "", r, c;
      for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + c + " " + r + "h1v1h-1z";
      return '<svg viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><path d="' + d + '" fill="#0b1f44"/></svg>';
    } catch (e) { return ""; }
  }
  var TK_CSS = ".tk{position:relative;width:100%;height:100%;display:flex;font-family:Arial,Helvetica,sans-serif;color:#0b1f44}" +
    ".tk *{box-sizing:border-box}" +
    ".tk-main{flex:1;min-width:0;position:relative;overflow:hidden;background:linear-gradient(135deg,#fff,#f6f9ff);border:.3mm solid #e1e8f5;border-radius:6mm 0 0 6mm;border-right:0;padding:5mm 6mm 4mm}" +
    ".tk-wave{position:absolute;top:0;left:0;right:0;height:26mm;pointer-events:none}" +
    ".tk-stub{width:54mm;position:relative;background:#fff;border:.3mm solid #e1e8f5;border-radius:0 6mm 6mm 0;border-left:.35mm dashed #9db3d8;padding:5mm 5mm 4mm;display:flex;flex-direction:column;text-align:center;overflow:hidden}" +
    ".tk-notch{position:absolute;left:-2.2mm;width:4.4mm;height:4.4mm;border-radius:50%;background:#fff;border:.3mm solid #e1e8f5}.tk-notch.t{top:-2.4mm}.tk-notch.b{bottom:-2.4mm}" +
    ".tk-top{position:relative;display:flex;align-items:center;gap:3mm}" +
    ".tk-brand{display:flex;align-items:center;gap:2mm;font-weight:700;font-size:8.5pt;line-height:1.1;max-width:46mm}.tk-brand img,.tk-brand svg{height:9mm;width:auto;flex:none}" +
    ".tk-sep{width:.3mm;height:8mm;background:#c7d3ea}.tk-kind{font-size:7pt;letter-spacing:.35em;color:#5b6b8c;text-transform:uppercase}" +
    ".tk-paid{margin-left:auto;display:inline-flex;align-items:center;gap:1.6mm;background:#d9f7e4;color:#12803f;font-weight:800;font-size:10pt;padding:1.8mm 4mm;border-radius:3mm;letter-spacing:.02em}.tk-paid.no{background:#fff1d6;color:#b45309}.tk-paid svg{width:4.4mm;height:4.4mm}" +
    ".tk-route{position:relative;display:flex;align-items:center;gap:4mm;margin-top:5.5mm;padding-bottom:3.4mm;border-bottom:.25mm solid #e6ecf7}" +
    ".tk-end{display:flex;gap:2.2mm;align-items:flex-start;min-width:0}.tk-end svg{width:4.6mm;height:5.6mm;flex:none;margin-top:3mm}.tk-end small{display:block;font-size:6.5pt;color:#5b6b8c;letter-spacing:.05em;text-transform:uppercase;font-weight:700}.tk-end b{display:block;font-size:16pt;line-height:1.1;letter-spacing:-.01em}" +
    ".tk-arrow{flex:0 0 12mm}.tk-arrow svg{width:100%;height:5mm}" +
    ".tk-facts{display:grid;grid-template-columns:repeat(4,auto);justify-content:space-between;gap:3mm;padding:3mm 0;border-bottom:.25mm solid #e6ecf7}" +
    ".tk-f{display:flex;gap:2mm;align-items:flex-start;min-width:0}.tk-f svg{width:4.6mm;height:4.6mm;flex:none;color:#5b6b8c;margin-top:.6mm}.tk-f small{display:block;font-size:6.3pt;color:#5b6b8c}.tk-f b{display:block;font-size:9.5pt;white-space:nowrap}" +
    ".tk-cust{display:grid;grid-template-columns:1.25fr 1fr .5fr;gap:4mm;padding-top:3mm;align-items:start}.tk-cust>div+div{border-left:.25mm solid #e6ecf7;padding-left:4mm}" +
    ".tk-cust small{display:block;font-size:6.5pt;color:#5b6b8c}.tk-cust .nm{font-size:12pt;font-weight:800;margin-top:.8mm}.tk-cust .ph{font-size:8.5pt;color:#334155;margin-top:1mm}" +
    ".tk-seats{display:flex;gap:1.6mm;flex-wrap:wrap;margin-top:1.3mm}.tk-seats i{font-style:normal;background:#dbeafe;color:#0b3a8a;font-weight:800;font-size:9pt;padding:.9mm 2.4mm;border-radius:2mm}" +
    ".tk-cust .big{font-size:15pt;font-weight:800;margin-top:.8mm}" +
    ".tk-stub small.k{font-size:7.5pt;color:#5b6b8c}.tk-stub .id{font-size:14pt;font-weight:800;letter-spacing:-.01em;margin:.8mm 0 2.6mm;text-align:left}.tk-stub .kk{text-align:left}" +
    ".tk-qr{width:30mm;height:30mm;margin:0 auto;background:#fff}.tk-qr svg{width:100%;height:100%;display:block}.tk-qr.ph{border:.3mm dashed #cbd5e1;display:grid;place-items:center;font-size:7pt;color:#94a3b8}" +
    ".tk-scan{font-size:7pt;color:#5b6b8c;margin-top:1.2mm}" +
    ".tk-pay{margin-top:auto;display:flex;gap:2mm;align-items:center;text-align:left;background:#d9f7e4;border-radius:3mm;padding:2mm 3mm}.tk-pay.no{background:#fff1d6}.tk-pay svg{width:5mm;height:5mm;flex:none}.tk-pay.no svg{color:#d97706}.tk-pay small{font-size:6.4pt;color:#475569;display:block}.tk-pay b{font-size:10.5pt;color:#0f5132}.tk-pay.no b{color:#92400e}";
  function ticketHtml(sec, cfg, data) {
    var t = (data && data.ticket) || {}, co = (data && data.company) || {};
    var accent = (cfg.theme && cfg.theme.accent) || cfg.page.accentColor || "#1677e8";
    function I(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
    var pin = '<svg viewBox="0 0 24 24" fill="' + esc(accent) + '"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
    var check = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var wave = '<svg viewBox="0 0 64 40"><path d="M2 32C14 8 34 4 58 8 46 12 38 22 30 30 22 38 10 40 2 32Z" fill="#2d8cf0"/><path d="M20 36c10-8 22-8 34-14-4 9-14 16-34 14Z" fill="#0b5ed7"/></svg>';
    var logo = co.logoUrl ? '<img src="' + esc(co.logoUrl) + '" alt="" crossorigin="anonymous">' : wave;
    var paid = !!t.paid, kind = (sec && sec.heading) || "Passenger Ticket";
    var qr = qrSvg(t.reference ? ("TICKET:" + t.reference) : "");
    var seats = (t.seats || []).length ? '<div class="tk-seats">' + t.seats.map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") + "</div>" : '<div class="ph">—</div>';
    function fact(ic, l, v) { return '<div class="tk-f">' + I(ic) + "<div><small>" + l + "</small><b>" + esc(v || "—") + "</b></div></div>"; }
    var dateTxt = "";
    if (t.date) { try { dateTxt = new Date(t.date + (String(t.date).length <= 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { dateTxt = String(t.date); } }
    return "<style>" + TK_CSS + ".tk-arrow{color:" + esc(accent) + "}.tk-pay svg{color:#16a34a}</style>" +
      '<div class="tk"><div class="tk-main">' +
        '<svg class="tk-wave" viewBox="0 0 400 60" preserveAspectRatio="none"><path d="M0 30C80 55 200 0 400 6V0H0Z" fill="' + esc(accent) + '" opacity=".1"/></svg>' +
        '<div class="tk-top"><div class="tk-brand">' + logo + "<span>" + esc(co.name || "Transport Service") + '</span></div><i class="tk-sep"></i><span class="tk-kind">' + esc(kind) + "</span>" +
          '<span class="tk-paid' + (paid ? "" : " no") + '">' + (paid ? check : "") + esc((t.paymentStatus || "Unpaid").toUpperCase()) + "</span></div>" +
        '<div class="tk-route"><div class="tk-end">' + pin + "<div><small>From</small><b>" + esc(t.from || "—") + '</b></div></div><span class="tk-arrow">' + I('<path d="M3 12h18M15 6l6 6-6 6"/>') + '</span><div class="tk-end">' + pin + "<div><small>To</small><b>" + esc(t.to || "—") + "</b></div></div></div>" +
        '<div class="tk-facts">' + fact('<path d="M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"/>', "Trip Date", dateTxt) + fact('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', "Departure", t.time) +
          fact('<path d="M3 17l2 3h14l2-3M5 17V11l7-3 7 3v6M12 8V4"/>', "Vessel", t.vessel) + fact('<path d="M6 4h12v9H6zM6 13v5h12v-5"/>', "Seats Booked", t.seatsBooked != null ? String(t.seatsBooked) : "") + "</div>" +
        '<div class="tk-cust"><div><small>Customer Information</small><div class="nm">' + esc(t.customerName || "—") + '</div><div class="ph">' + esc(t.customerPhone || "") + "</div></div>" +
          "<div><small>Seats</small>" + seats + '</div><div><small>Passengers</small><div class="big">' + esc(t.passengers != null ? String(t.passengers) : "") + "</div></div></div>" +
      "</div>" +
      '<div class="tk-stub"><i class="tk-notch t"></i><i class="tk-notch b"></i><div class="kk"><small class="k">Booking ID</small><div class="id">' + esc(t.reference || "—") + "</div></div>" +
        '<div class="tk-qr' + (qr ? "" : " ph") + '">' + (qr || "QR") + '</div><div class="tk-scan">Scan at Boarding</div>' +
        '<div class="tk-pay' + (paid ? "" : " no") + '">' + (paid ? check : I('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v1"/>')) + "<div><small>Payment Status</small><b>" + esc(t.paymentStatus || "Unpaid") + "</b></div></div></div></div>";
  }

  function renderSection(sec, cfg, data, opts) {
    if (!sec || sec.visible === false) return "";
    var id = sec.id;
    opts = opts || {};
    var canvas = isCanvas(cfg);
    if (id === "ticket_card") return ticketHtml(sec, cfg, data);
    if (id === "logo") {
      if (data.company && data.company.logoUrl) {
        return '<div class="vey-logo"><img src="' + esc(data.company.logoUrl) + '" alt="" crossorigin="anonymous"></div>';
      }
      return opts.preview ? '<div class="vey-logo vey-ph">Logo</div>' : "";
    }
    if (id === "company_header") {
      var bits = [];
      if (!canvas && data.company.logoUrl && cfg.page.showHeader !== false) {
        bits.push('<img src="' + esc(data.company.logoUrl) + '" alt="" crossorigin="anonymous">');
      }
      bits.push("<div><strong>" + esc(data.company.name) + "</strong>" +
        (data.company.address ? "<small>" + esc(data.company.address) + "</small>" : "") +
        ((data.company.phone || data.company.email)
          ? "<small>" + esc([data.company.phone, data.company.email].filter(Boolean).join(" · ")) + "</small>"
          : "") +
        (data.company.registrationNo ? "<small>Reg. " + esc(data.company.registrationNo) + "</small>" : "") +
        "</div>");
      return '<div class="vey-head">' + bits.join("") + "</div>";
    }
    if (id === "text") {
      var style = [];
      if (sec.align) style.push("text-align:" + sec.align);
      if (sec.fontSize) style.push("font-size:" + sec.fontSize + "pt");
      if (sec.bold) style.push("font-weight:700");
      if (sec.color) style.push("color:" + sec.color);
      return '<div class="vey-text"' + (style.length ? ' style="' + style.join(";") + '"' : "") + ">" +
        esc(sec.text || sec.heading || "") + "</div>";
    }
    if (id === "field") {
      var key = sec.fieldKey || sec.key || "";
      var catalogue = Fields().forType(cfg.documentType || "invoice");
      var meta = catalogue.filter(function (f) { return f.key === key; })[0];
      var label = sec.heading || (meta && meta.label) || key || "Field";
      var val = key ? fmt(data, key, meta && meta.type) : "";
      return '<div class="vey-field"><span>' + esc(label) + "</span><strong>" + esc(val || "—") + "</strong></div>";
    }
    if (id === "divider") {
      return '<hr class="vey-hr">';
    }
    if (id === "document_title") {
      var title = sec.heading || "Document";
      if (data.report && data.report.title) title = data.report.title;
      if (data.agreement && data.agreement.title) title = data.agreement.title;
      return '<h1 class="vey-title">' + esc(title) + "</h1>";
    }
    if (id === "document_meta") {
      var cells = [];
      if (data.invoice) {
        cells.push(["Number", fmt(data, "invoice.number", "text")]);
        cells.push(["Issue date", fmt(data, "invoice.issueDate", "date")]);
        cells.push(["Due date", fmt(data, "invoice.dueDate", "date")]);
      }
      if (data.receipt) {
        cells.push(["Receipt", fmt(data, "receipt.number", "text")]);
        cells.push(["Date", fmt(data, "receipt.date", "date")]);
        cells.push(["Reference", fmt(data, "receipt.reference", "text")]);
      }
      if (data.payroll) {
        cells.push(["Period", fmt(data, "payroll.periodStart", "date") + " – " + fmt(data, "payroll.periodEnd", "date")]);
      }
      if (data.report) {
        cells.push(["Period", fmt(data, "report.periodStart", "date") + " – " + fmt(data, "report.periodEnd", "date")]);
        cells.push(["Generated", fmt(data, "report.generatedAt", "datetime")]);
      }
      if (!cells.length) return "";
      return '<div class="vey-meta">' + cells.map(function (c) {
        return "<div><span>" + esc(c[0]) + "</span>" + esc(c[1] || "—") + "</div>";
      }).join("") + "</div>";
    }
    if (id === "party") {
      var name = "", detail = "";
      if (data.invoice && data.invoice.customer) {
        name = data.invoice.customer.name;
        detail = [data.invoice.customer.address, data.invoice.customer.email, data.invoice.customer.phone].filter(Boolean).join(" · ");
      } else if (data.employee) {
        name = data.employee.name;
        detail = [data.employee.employeeId, data.employee.designation].filter(Boolean).join(" · ");
      } else if (data.agreement) {
        name = data.agreement.party;
      } else if (data.receipt) {
        name = data.receipt.payer;
      }
      if (!name) return "";
      return '<div class="vey-party"><h3>' + esc(sec.heading || "Details") + "</h3><strong>" + esc(name) + "</strong>" +
        (detail ? "<div>" + esc(detail) + "</div>" : "") + "</div>";
    }
    if (id === "items_table") {
      return (sec.heading ? "<h3 style=\"margin:0 0 6px;font-size:10pt\">" + esc(sec.heading) + "</h3>" : "") + renderTable(cfg, data);
    }
    if (id === "totals") {
      var lines = [];
      if (data.invoice) {
        lines.push(["Subtotal", fmt(data, "invoice.subtotal", "money")]);
        lines.push(["Tax", fmt(data, "invoice.tax", "money")]);
        lines.push(["Total", fmt(data, "invoice.total", "money"), true]);
        lines.push(["Amount paid", fmt(data, "invoice.amountPaid", "money")]);
        lines.push(["Balance due", fmt(data, "invoice.balanceDue", "money")]);
      } else if (data.receipt) {
        lines.push(["Amount received", fmt(data, "receipt.amount", "money"), true]);
      } else if (data.payroll) {
        lines.push(["Gross pay", fmt(data, "payroll.grossPay", "money")]);
        lines.push(["Net pay", fmt(data, "payroll.netPay", "money"), true]);
      } else if (data.report && data.report.totals) {
        lines.push(["Totals", String(data.report.totals), true]);
      }
      if (!lines.length) return "";
      return '<div class="vey-totals">' + lines.map(function (l) {
        return '<div class="' + (l[2] ? "grand" : "") + '"><span>' + esc(l[0]) + "</span><span>" + esc(l[1]) + "</span></div>";
      }).join("") + "</div>";
    }
    if (id === "payment") {
      var method = fmt(data, "invoice.paymentMethod", "text") || (data.receipt && data.receipt.paymentMethod) || "";
      var ref = data.receipt && data.receipt.reference;
      if (!method && !ref) return "";
      return '<div class="vey-block"><h3>' + esc(sec.heading || "Payment") + "</h3>" +
        (method ? "<div>Method: " + esc(method) + "</div>" : "") +
        (ref ? "<div>Reference: " + esc(ref) + "</div>" : "") + "</div>";
    }
    if (id === "notes") {
      var note = (data.invoice && data.invoice.note) || (data.receipt && data.receipt.note) || "";
      if (data.agreement && data.agreement.body) {
        return '<div class="vey-block">' + data.agreement.body + "</div>";
      }
      if (!note) return "";
      return '<div class="vey-block"><h3>' + esc(sec.heading || "Notes") + "</h3><p>" + esc(note) + "</p></div>";
    }
    if (id === "signature") {
      return '<div class="vey-sign"><div><div class="line">Authorised signature</div></div><div><div class="line">Received by</div></div></div>';
    }
    if (id === "footer") {
      var foot = (cfg.page && cfg.page.footerText) || [data.company.name, data.company.region].filter(Boolean).join(" · ");
      return foot ? '<div class="vey-foot">' + esc(foot) + "</div>" : "";
    }
    if (id === "page_number") {
      return '<div class="vey-pagenum">Page 1</div>';
    }
    return "";
  }

  function blockStyle(block) {
    return "left:" + Number(block.x || 0) + "mm;top:" + Number(block.y || 0) + "mm;width:" +
      Number(block.w || 20) + "mm;height:" + Number(block.h || 10) + "mm;z-index:" + (block.z || 1) +
      (block.align ? ";text-align:" + block.align : "") +
      (block.color ? ";color:" + block.color : "") +
      (block.fontSize ? ";font-size:" + block.fontSize + "pt" : "") +
      (block.bold ? ";font-weight:700" : "");
  }

  function renderBlock(block, cfg, data, opts) {
    if (!block || block.visible === false) return "";
    var inner = renderSection({
      id: block.type,
      heading: block.heading,
      visible: true,
      fieldKey: block.fieldKey,
      text: block.text,
      align: block.align,
      fontSize: block.fontSize,
      bold: block.bold,
      color: block.color
    }, cfg, data, opts);
    var grow = block.type === "items_table" ? " vey-grow" : "";
    return '<div class="vey-abs' + grow + '" data-block="' + esc(block.id) + '" style="' + blockStyle(block) + '">' + inner + "</div>";
  }

  function renderDocumentHtml(cfg, data, opts) {
    opts = opts || {};
    var missing = Fields().missingRequired(cfg.documentType || "invoice", data);
    var warn = missing.length
      ? '<div class="vey-warn">Missing required fields: ' + esc(missing.join(", ")) + "</div>"
      : "";
    var sample = (!isCanvas(cfg) && data._sample) ? '<div class="vey-sample">Sample data</div>' : "";
    var body;
    if (isCanvas(cfg)) {
      body = (cfg.blocks || []).slice().sort(function (a, b) {
        return (a.z || 0) - (b.z || 0);
      }).map(function (b) { return renderBlock(b, cfg, data, opts); }).join("");
    } else {
      body = visibleSections(cfg).map(function (s) { return renderSection(s, cfg, data, opts); }).join("");
    }
    var inner = sample + warn + body;
    if (opts.fragment) return inner;
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + printCss(cfg) + "</style></head><body>" +
      '<div class="vey-doc' + (isCanvas(cfg) ? " vey-canvas" : "") + '">' + inner + "</div></body></html>";
  }

  function renderPreviewNode(cfg, data) {
    var dims = Schema().pageDims(cfg.page);
    var canvas = isCanvas(cfg);
    var html = '<style>' + printCss(cfg) + "</style>" +
      '<div class="vey-doc' + (canvas ? " vey-canvas" : "") + '" style="width:' + dims.w + "mm;" +
      (canvas ? "height:" + dims.h + "mm;" : "min-height:" + dims.h + "mm;") + '">' +
      renderDocumentHtml(cfg, data, { fragment: true, preview: true }) + "</div>";
    return { html: html, widthMm: dims.w, heightMm: dims.h, margins: dims.margins };
  }

  function editorBlockCss(cfg) {
    return printCss(cfg)
      .replace(/@page\{[^}]*\}/g, "")
      .replace(/html,body\{[^}]*\}/g, "")
      .replace(/@media print\{[^}]*\}/g, "")
      .replace(/\.vey-doc\{[^}]*\}/g, ".vey-doc{box-sizing:border-box;width:100%;height:100%;padding:0;margin:0;overflow:hidden;background:transparent;}") +
      ".vey-head,.vey-title,.vey-meta,.vey-party,.vey-table,.vey-totals,.vey-block,.vey-sign,.vey-foot{margin:0;width:100%;}" +
      ".vey-logo,.vey-field,.vey-text{width:100%;height:100%;}";
  }

  window.VeyoraPdfRender = {
    printCss: printCss,
    editorBlockCss: editorBlockCss,
    renderDocumentHtml: renderDocumentHtml,
    renderPreviewNode: renderPreviewNode,
    renderSection: renderSection,
    renderBlock: renderBlock,
    visibleSections: visibleSections,
    isCanvas: isCanvas
  };
})();
