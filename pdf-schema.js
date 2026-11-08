/* PDF Layout Maker — page sizes, canvas blocks, default layouts.
   Cursor 2026-10-24: shared with pdf-render / pdf-layouts. Dimensions in millimetres. */
(function () {
  var PAGE = {
    A4: { w: 210, h: 297, label: "A4" },
    A5: { w: 148, h: 210, label: "A5" },
    Letter: { w: 215.9, h: 279.4, label: "US Letter" },
    Ticket: { w: 90, h: 210, label: "Ticket (210 x 90 mm)" }
  };

  var DOC_TYPES = [
    { id: "invoice", label: "Invoice", module: "finance" },
    { id: "receipt", label: "Receipt", module: "finance" },
    { id: "payslip", label: "Payslip", module: "hr" },
    { id: "financial_report", label: "Financial report", module: "finance" },
    { id: "employee_report", label: "Employee report", module: "hr" },
    { id: "agreement", label: "Agreement", module: "hr" },
    { id: "ticket", label: "Passenger ticket", module: "operations" }
  ];

  var SECTIONS = {
    company_header: { label: "Company header", optional: false },
    logo: { label: "Logo", optional: true },
    document_title: { label: "Document title", optional: false },
    document_meta: { label: "Document number & dates", optional: false },
    party: { label: "Customer / employee", optional: false },
    items_table: { label: "Line items / table", optional: true },
    totals: { label: "Totals", optional: true },
    payment: { label: "Payment information", optional: true },
    notes: { label: "Notes and terms", optional: true },
    signature: { label: "Signature", optional: true },
    footer: { label: "Footer", optional: false },
    page_number: { label: "Page number", optional: true }
  };

  var BLOCK_TYPES = {
    company_header: { label: "Company header", group: "Layout", hint: "Name, address, contacts" },
    logo: { label: "Logo", group: "Layout", hint: "From company profile" },
    document_title: { label: "Title", group: "Layout", hint: "Invoice, Receipt, …" },
    document_meta: { label: "Number & dates", group: "Layout", hint: "Document number and dates" },
    party: { label: "Customer / employee", group: "Layout", hint: "Bill-to or employee" },
    items_table: { label: "Table", group: "Layout", hint: "Line items" },
    totals: { label: "Totals", group: "Layout", hint: "Subtotal, tax, total" },
    payment: { label: "Payment", group: "Layout", hint: "Method and reference" },
    notes: { label: "Notes", group: "Layout", hint: "Terms or body" },
    signature: { label: "Signature", group: "Layout", hint: "Sign-off lines" },
    footer: { label: "Footer", group: "Layout", hint: "Company footer" },
    page_number: { label: "Page number", group: "Layout", hint: "Printed by the PDF engine" },
    ticket_card: { label: "Passenger ticket", group: "Layout", hint: "Route, trip, customer, seats and QR" },
    text: { label: "Text", group: "Elements", hint: "Static label or sentence" },
    field: { label: "Data field", group: "Elements", hint: "Bind a catalogue field" },
    divider: { label: "Divider", group: "Elements", hint: "Horizontal rule" }
  };

  var BLOCK_SIZE = {
    company_header: { w: 92, h: 22 },
    logo: { w: 38, h: 16 },
    document_title: { w: 72, h: 14 },
    document_meta: { w: 64, h: 28 },
    party: { w: 92, h: 28 },
    items_table: { w: 186, h: 62 },
    totals: { w: 82, h: 38 },
    payment: { w: 88, h: 22 },
    notes: { w: 186, h: 22 },
    signature: { w: 186, h: 30 },
    footer: { w: 186, h: 10 },
    page_number: { w: 36, h: 8 },
    text: { w: 56, h: 12 },
    field: { w: 52, h: 16 },
    divider: { w: 186, h: 3 },
    ticket_card: { w: 200, h: 80 }
  };

  function clampMargin(n) {
    n = Number(n);
    if (!isFinite(n)) return 12;
    return Math.min(25, Math.max(5, n));
  }

  function r1(n) {
    n = Number(n);
    if (!isFinite(n)) return 0;
    return Math.round(n * 10) / 10;
  }

  function uid(prefix) {
    return (prefix || "b") + "_" + Math.random().toString(36).slice(2, 8);
  }

  function defaultPage() {
    return {
      size: "A4",
      orientation: "portrait",
      margins: { top: 12, right: 12, bottom: 14, left: 12 },
      fontFamily: "sans",
      baseFontSize: 11,
      textColor: "#111827",
      accentColor: "#1677e8",
      background: "#ffffff",
      showHeader: true,
      showFooter: true,
      pageNumbers: true
    };
  }

  function section(id, extra) {
    return Object.assign({ id: id, visible: true, heading: SECTIONS[id] ? SECTIONS[id].label : id }, extra || {});
  }

  function isCanvas(cfg) {
    return !!(cfg && Array.isArray(cfg.blocks) && cfg.blocks.length);
  }

  function snapVal(n, grid) {
    grid = grid || 2;
    return r1(Math.round(Number(n) / grid) * grid);
  }

  function blockSize(type, pageW) {
    var s = BLOCK_SIZE[type] || { w: 60, h: 16 };
    var w = s.w;
    if (pageW && (type === "items_table" || type === "notes" || type === "signature" || type === "footer" || type === "divider")) {
      w = pageW;
    }
    return { w: w, h: s.h };
  }

  function newBlock(type, x, y, extra) {
    extra = extra || {};
    var size = blockSize(type, extra.pageW);
    var heading = extra.heading;
    if (heading == null) heading = (BLOCK_TYPES[type] && BLOCK_TYPES[type].label) || (SECTIONS[type] && SECTIONS[type].label) || "";
    return Object.assign({
      id: extra.id || uid("b"),
      type: type,
      x: r1(x || 12),
      y: r1(y || 12),
      w: r1(extra.w != null ? extra.w : size.w),
      h: r1(extra.h != null ? extra.h : size.h),
      z: extra.z || 1,
      visible: extra.visible !== false,
      heading: heading,
      align: extra.align || "left",
      fontSize: extra.fontSize || null,
      bold: !!extra.bold,
      color: extra.color || null,
      text: extra.text || "",
      fieldKey: extra.fieldKey || ""
    }, extra.rest || {});
  }

  function clampBlock(block, dims) {
    if (!block || !dims) return block;
    var minW = block.type === "divider" ? 10 : 12;
    var minH = block.type === "divider" ? 1 : 6;
    block.w = r1(Math.max(minW, Math.min(dims.w, Number(block.w) || minW)));
    block.h = r1(Math.max(minH, Math.min(dims.h, Number(block.h) || minH)));
    block.x = r1(Math.max(0, Math.min(dims.w - block.w, Number(block.x) || 0)));
    block.y = r1(Math.max(0, Math.min(dims.h - block.h, Number(block.y) || 0)));
    return block;
  }

  function designedBlocks(cfg) {
    var page = cfg.page || defaultPage();
    var dims = pageDims(page);
    var m = dims.margins;
    var L = m.left;
    var T = m.top;
    var W = r1(dims.w - m.left - m.right);
    var doc = cfg.documentType || "invoice";
    var hidden = {};
    (cfg.sections || []).forEach(function (s) {
      if (s && s.visible === false) hidden[s.id] = true;
    });
    var n = 0;
    function add(type, x, y, w, h, extra) {
      extra = extra || {};
      extra.id = extra.id || ("b" + (++n));
      extra.w = w;
      extra.h = h;
      extra.z = extra.z || n;
      extra.visible = hidden[type] ? false : extra.visible;
      if (SECTIONS[type] && extra.heading == null) {
        var sec = (cfg.sections || []).filter(function (s) { return s.id === type; })[0];
        extra.heading = (sec && sec.heading) || SECTIONS[type].label;
      }
      return newBlock(type, x, y, extra);
    }

    if (doc === "ticket") {
      return [add("ticket_card", L, T, W, r1(dims.h - m.top - m.bottom), { heading: "Passenger Ticket", visible: true })];
    }
    if (doc === "receipt") {
      return [
        add("logo", L, T, 32, 14),
        add("company_header", L + 36, T, W - 36, 18),
        add("document_title", L, T + 22, W, 12, { heading: "Receipt", align: "center" }),
        add("document_meta", L, T + 36, W, 22),
        add("party", L, T + 62, W, 22, { heading: "Received from" }),
        add("totals", L, T + 88, W, 28),
        add("payment", L, T + 120, W, 20),
        add("notes", L, T + 144, W, 20),
        add("footer", L, dims.h - m.bottom - 8, W, 8)
      ];
    }
    if (doc === "payslip") {
      return [
        add("logo", L, T, 36, 16),
        add("company_header", L + 40, T, W * 0.48, 20),
        add("document_title", L + W - 70, T, 70, 12, { heading: "Payslip", align: "right" }),
        add("document_meta", L + W - 70, T + 14, 70, 24),
        add("party", L, T + 40, W, 24, { heading: "Employee" }),
        add("items_table", L, T + 68, W, 70, { heading: "Earnings & deductions" }),
        add("totals", L + W - 86, T + 144, 86, 32),
        add("notes", L, T + 180, W, 20),
        add("footer", L, dims.h - m.bottom - 8, W, 8)
      ];
    }
    if (doc === "financial_report" || doc === "employee_report") {
      var title = doc === "employee_report" ? "Employee report" : "Financial report";
      return [
        add("logo", L, T, 36, 14),
        add("company_header", L + 40, T, W * 0.5, 18),
        add("document_title", L, T + 22, W * 0.62, 12, { heading: title }),
        add("document_meta", L + W - 80, T + 22, 80, 22),
        add("party", L, T + 46, W * 0.5, 22, { visible: doc === "employee_report" }),
        add("items_table", L, T + (doc === "employee_report" ? 72 : 48), W, doc === "employee_report" ? 78 : 96, { heading: "Details" }),
        add("totals", L + W - 90, dims.h - m.bottom - 48, 90, 28),
        add("footer", L, dims.h - m.bottom - 8, W, 8)
      ];
    }
    if (doc === "agreement") {
      return [
        add("logo", L, T, 36, 16),
        add("company_header", L + 40, T, W - 40, 20),
        add("document_title", L, T + 26, W, 14),
        add("document_meta", L, T + 42, W, 18),
        add("party", L, T + 64, W, 22),
        add("notes", L, T + 90, W, 110, { heading: "Agreement body" }),
        add("signature", L, T + 206, W, 32),
        add("footer", L, dims.h - m.bottom - 8, W, 8)
      ];
    }
    /* Invoice layout — sized for A5 (148 × 210 mm) and scales on larger pages. */
    return [
      add("logo", L, T, 28, 12),
      add("company_header", L + 32, T, Math.max(48, W - 90), 16),
      add("document_title", L + W - 54, T, 54, 10, { heading: "Invoice", align: "right" }),
      add("document_meta", L + W - 54, T + 12, 54, 22),
      add("party", L, T + 34, Math.min(88, W * 0.58), 22, { heading: "Bill to" }),
      add("items_table", L, T + 60, W, 52, { heading: "Items" }),
      add("totals", L + W - 70, T + 118, 70, 32),
      add("payment", L, T + 118, Math.max(56, W - 78), 18),
      add("notes", L, T + 156, W, 18),
      add("signature", L, T + 178, W, 16, { visible: false }),
      add("footer", L, dims.h - m.bottom - 8, W, 8)
    ];
  }

  function sectionsToBlocks(cfg) {
    var dims = pageDims(cfg.page || defaultPage());
    var m = dims.margins;
    var x = m.left;
    var y = m.top;
    var w = r1(dims.w - m.left - m.right);
    var blocks = [];
    (cfg.sections || []).forEach(function (s, i) {
      if (!s || !s.id) return;
      var size = blockSize(s.id, w);
      var h = size.h;
      if (s.id === "items_table") h = 62;
      if (s.id === "totals") w = Math.min(w, 88), x = dims.w - m.right - w;
      else { x = m.left; w = r1(dims.w - m.left - m.right); }
      blocks.push(newBlock(s.id, x, y, {
        w: w, h: h, z: i + 1, visible: s.visible !== false, heading: s.heading, id: "b" + (i + 1)
      }));
      y = r1(y + h + 4);
      w = r1(dims.w - m.left - m.right);
    });
    return blocks;
  }

  function ensureCanvas(cfg) {
    if (!cfg || typeof cfg !== "object") return cfg;
    if (isCanvas(cfg)) {
      cfg.layoutMode = "canvas";
      cfg.schemaVersion = Math.max(Number(cfg.schemaVersion) || 1, 2);
      cfg.blocks.forEach(function (b) { clampBlock(b, pageDims(cfg.page || defaultPage())); });
      return cfg;
    }
    /* Old stacked `sections` layouts become the designed canvas, not a vertical dump. */
    cfg.blocks = designedBlocks(cfg);
    cfg.layoutMode = "canvas";
    cfg.schemaVersion = 2;
    return cfg;
  }

  function defaultConfig(docType) {
    var page = defaultPage();
    var sections;
    if (docType === "ticket") {
      page.size = "Ticket"; page.orientation = "landscape";
      page.margins = { top: 5, right: 5, bottom: 5, left: 5 };
      page.accentColor = "#1677e8"; page.pageNumbers = false; page.showFooter = false;
      sections = [section("company_header")];
    } else if (docType === "receipt") {
      page.size = "A5";
      sections = [
        section("company_header"), section("document_title", { heading: "Receipt" }),
        section("document_meta"), section("party", { heading: "Received from" }),
        section("totals"), section("payment"), section("notes"), section("footer"), section("page_number")
      ];
    } else if (docType === "payslip") {
      sections = [
        section("company_header"), section("document_title", { heading: "Payslip" }),
        section("document_meta"), section("party", { heading: "Employee" }),
        section("items_table", { heading: "Earnings & deductions" }),
        section("totals"), section("notes"), section("footer"), section("page_number")
      ];
    } else if (docType === "financial_report") {
      page.orientation = "landscape";
      sections = [
        section("company_header"), section("document_title", { heading: "Financial report" }),
        section("document_meta"), section("items_table", { heading: "Details" }),
        section("totals"), section("footer"), section("page_number")
      ];
    } else if (docType === "employee_report") {
      sections = [
        section("company_header"), section("document_title", { heading: "Employee report" }),
        section("document_meta"), section("party"), section("items_table"),
        section("footer"), section("page_number")
      ];
    } else if (docType === "agreement") {
      sections = [
        section("company_header"), section("document_title"), section("document_meta"),
        section("party"), section("notes", { heading: "Agreement body" }),
        section("signature"), section("footer"), section("page_number")
      ];
    } else {
      /* Ticket invoices print on A5 by default. */
      page.size = "A5";
      page.margins = { top: 10, right: 10, bottom: 10, left: 10 };
      page.baseFontSize = 10;
      page.pageNumbers = false;
      sections = [
        section("company_header"), section("logo"),
        section("document_title", { heading: "Invoice" }),
        section("document_meta"), section("party", { heading: "Bill to" }),
        section("items_table", { heading: "Items" }),
        section("totals"), section("payment"), section("notes"),
        section("signature", { visible: false }), section("footer"), section("page_number", { visible: false })
      ];
    }
    var cfg = {
      schemaVersion: 2,
      layoutMode: "canvas",
      documentType: docType,
      page: page,
      theme: { accent: page.accentColor, tableHeaderBg: "#eaf3ff", stripe: "#f8fafc" },
      sections: sections,
      table: {
        columns: defaultColumns(docType),
        showRowNumbers: false,
        stripe: true,
        borders: true,
        repeatHeader: true
      }
    };
    cfg.blocks = designedBlocks(cfg);
    return cfg;
  }

  function defaultColumns(docType) {
    if (docType === "payslip") {
      return [
        { key: "kind", label: "Type", width: 18, align: "left" },
        { key: "description", label: "Description", width: 52, align: "left" },
        { key: "amount", label: "Amount", width: 30, align: "right", format: "money" }
      ];
    }
    if (docType === "financial_report" || docType === "employee_report") {
      return [
        { key: "label", label: "Item", width: 50, align: "left" },
        { key: "value", label: "Value", width: 50, align: "right" }
      ];
    }
    return [
      { key: "description", label: "Description", width: 40, align: "left" },
      { key: "qty", label: "Qty", width: 12, align: "right", format: "number" },
      { key: "unit", label: "Unit price", width: 18, align: "right", format: "money" },
      { key: "tax", label: "Tax", width: 12, align: "right", format: "money" },
      { key: "total", label: "Line total", width: 18, align: "right", format: "money" }
    ];
  }

  function pageDims(page) {
    var p = PAGE[page.size] || PAGE.A4;
    var landscape = page.orientation === "landscape";
    return {
      w: landscape ? p.h : p.w,
      h: landscape ? p.w : p.h,
      margins: {
        top: clampMargin(page.margins && page.margins.top),
        right: clampMargin(page.margins && page.margins.right),
        bottom: clampMargin(page.margins && page.margins.bottom),
        left: clampMargin(page.margins && page.margins.left)
      }
    };
  }

  function validateConfig(cfg) {
    var errors = [];
    if (!cfg || typeof cfg !== "object") return ["Configuration is missing."];
    if (!cfg.page) errors.push("Page settings are required.");
    else {
      if (!PAGE[cfg.page.size]) errors.push("Unsupported page size.");
      var m = cfg.page.margins || {};
      ["top", "right", "bottom", "left"].forEach(function (k) {
        var v = Number(m[k]);
        if (!isFinite(v) || v < 5 || v > 25) errors.push("Margin " + k + " must be 5–25 mm.");
      });
    }
    var hasBlocks = Array.isArray(cfg.blocks) && cfg.blocks.length;
    var hasSections = Array.isArray(cfg.sections) && cfg.sections.length;
    if (!hasBlocks && !hasSections) errors.push("Add at least one block.");
    (cfg.sections || []).forEach(function (s) {
      if (!s || !s.id) errors.push("A section is missing an id.");
      if (s.id && !SECTIONS[s.id]) errors.push("Unknown section: " + s.id);
    });
    (cfg.blocks || []).forEach(function (b) {
      if (!b || !b.type) errors.push("A block is missing a type.");
      if (b && b.type && !BLOCK_TYPES[b.type]) errors.push("Unknown block: " + b.type);
    });
    return errors;
  }

  function syncSectionsFromBlocks(cfg) {
    if (!cfg || !Array.isArray(cfg.blocks)) return cfg;
    var seen = {};
    cfg.sections = cfg.blocks.filter(function (b) {
      return SECTIONS[b.type] && !seen[b.type] && (seen[b.type] = true);
    }).map(function (b) {
      return { id: b.type, visible: b.visible !== false, heading: b.heading || SECTIONS[b.type].label };
    });
    if (!cfg.sections.length) cfg.sections = [section("company_header"), section("footer")];
    return cfg;
  }

  window.VeyoraPdfSchema = {
    PAGE: PAGE,
    DOC_TYPES: DOC_TYPES,
    SECTIONS: SECTIONS,
    BLOCK_TYPES: BLOCK_TYPES,
    BLOCK_SIZE: BLOCK_SIZE,
    defaultConfig: defaultConfig,
    defaultPage: defaultPage,
    pageDims: pageDims,
    clampMargin: clampMargin,
    validateConfig: validateConfig,
    isCanvas: isCanvas,
    ensureCanvas: ensureCanvas,
    designedBlocks: designedBlocks,
    sectionsToBlocks: sectionsToBlocks,
    newBlock: newBlock,
    clampBlock: clampBlock,
    snapVal: snapVal,
    blockSize: blockSize,
    uid: uid,
    syncSectionsFromBlocks: syncSectionsFromBlocks
  };
})();
