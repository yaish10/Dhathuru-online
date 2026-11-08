/* PDF Layout Maker — shared generate / template load API.
   Cursor 2026-10-24: company always from DB; published template or built-in default;
   prefers document_templates tables, falls back to companies.settings.9_pdf_layout_store. */
(function () {
  var STORE_KEY = "9_pdf_layout_store";

  function db() { return window.veyoraDb; }
  function Schema() { return window.VeyoraPdfSchema; }
  function Fields() { return window.VeyoraPdfFields; }
  function Engine() { return window.VeyoraPdfEngine; }

  function loadCompany(companyId) {
    return db().from("companies")
      .select("id,name,email,phone,logo_path,address,registration_no,region,currency,timezone,date_format,settings")
      .eq("id", companyId).maybeSingle()
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        if (!r.data) throw new Error("Company not found.");
        return r.data;
      });
  }

  function settingsStore(company) {
    var s = (company.settings && company.settings[STORE_KEY]) || { templates: [] };
    if (!Array.isArray(s.templates)) s.templates = [];
    return s;
  }

  function saveSettingsStore(companyId, store) {
    return db().rpc("set_company_setting", { p_company: companyId, p_key: STORE_KEY, p_value: store })
      .then(function (r) { if (r.error) throw new Error(r.error.message); });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /** List templates: DB first, else settings store. */
  function listTemplates(companyId) {
    return db().from("document_templates")
      .select("id,name,document_type,description,status,is_default,current_published_version_id,updated_at,created_at")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .then(function (r) {
        if (r.error && /relation|does not exist|schema cache/i.test(r.error.message)) {
          return loadCompany(companyId).then(function (c) {
            return { source: "settings", templates: settingsStore(c).templates.slice() };
          });
        }
        if (r.error) throw new Error(r.error.message);
        return { source: "db", templates: r.data || [] };
      });
  }

  function normalizeConfig(cfg, documentType) {
    var copy = JSON.parse(JSON.stringify(cfg || Schema().defaultConfig(documentType)));
    if (!copy.documentType) copy.documentType = documentType;
    return Schema().ensureCanvas(copy);
  }

  function hasBlocks(cfg) {
    return !!(cfg && Array.isArray(cfg.blocks) && cfg.blocks.length);
  }

  function pickVersion(versions, publishedId) {
    versions = versions || [];
    var published = versions.filter(function (v) { return publishedId && v.id === publishedId; })[0]
      || versions.filter(function (v) { return v.status === "Published"; }).slice(-1)[0];
    var byNum = function (a, b) { return (Number(b.version_number) || 0) - (Number(a.version_number) || 0); };
    var canvasVer = versions.filter(function (v) { return hasBlocks(v.configuration); }).sort(byNum)[0];
    var latest = versions.slice().sort(byNum)[0];
    if (published && hasBlocks(published.configuration)) return published;
    if (canvasVer) return canvasVer;
    return published || latest || null;
  }

  function pickTemplate(templates, documentType) {
    var list = (templates || []).filter(function (t) {
      return t.document_type === documentType && t.status !== "Archived";
    });
    return list.filter(function (t) { return t.status === "Published" && t.is_default; })[0]
      || list.filter(function (t) { return t.status === "Published"; })[0]
      || list.filter(function (t) { return t.is_default; })[0]
      || list[0]
      || null;
  }

  function getPublishedConfig(companyId, documentType) {
    return listTemplates(companyId).then(function (pack) {
      var def = pickTemplate(pack.templates, documentType);
      if (!def) {
        return { config: normalizeConfig(Schema().defaultConfig(documentType), documentType), template: null, version: null, source: pack.source };
      }
      if (pack.source === "settings") {
        var ver = pickVersion(def.versions, def.current_published_version_id);
        return {
          config: normalizeConfig((ver && ver.configuration) || Schema().defaultConfig(documentType), documentType),
          template: def,
          version: ver || null,
          source: "settings"
        };
      }
      return db().from("document_template_versions").select("*").eq("template_id", def.id)
        .order("version_number", { ascending: false })
        .then(function (v) {
          if (v.error) throw new Error(v.error.message);
          var ver = pickVersion(v.data || [], def.current_published_version_id);
          return {
            config: normalizeConfig((ver && ver.configuration) || Schema().defaultConfig(documentType), documentType),
            template: def,
            version: ver || null,
            source: "db"
          };
        });
    });
  }

  function mapPayslip(run, line, staff) {
    var lines = [];
    lines.push({ kind: "Earning", description: "Basic salary", amount: Number(line.basic) || 0 });
    (line.allowance_items || []).forEach(function (a) {
      lines.push({ kind: "Earning", description: a.name || "Allowance", amount: Number(a.amount) || 0 });
    });
    if (Number(line.overtime_amount)) lines.push({ kind: "Earning", description: "Overtime", amount: Number(line.overtime_amount) });
    if (Number(line.unpaid_amount)) lines.push({ kind: "Deduction", description: "Unpaid leave", amount: Number(line.unpaid_amount) });
    if (Number(line.absent_amount)) lines.push({ kind: "Deduction", description: "Absence", amount: Number(line.absent_amount) });
    if (Number(line.pension_employee)) lines.push({ kind: "Deduction", description: "Staff pension", amount: Number(line.pension_employee) });
    return {
      employee: {
        name: (staff && (staff.name || staff.full_name)) || "Employee",
        employeeId: (staff && (staff.empNo || staff.employee_no)) || "",
        designation: (staff && (staff.position || staff.role_label)) || ""
      },
      payroll: {
        periodStart: run.period_start,
        periodEnd: run.period_end,
        basicSalary: line.basic,
        allowances: line.allowances,
        overtime: line.overtime_amount,
        deductions: line.pension_employee,
        grossPay: line.gross,
        netPay: line.net,
        lines: lines
      }
    };
  }

  function mapReportPayload(runMeta, columns, rows, summary) {
    var mappedRows = (rows || []).slice(0, 500).map(function (row) {
      if (Array.isArray(row)) {
        return { label: String(row[0] != null ? row[0] : ""), value: String(row[1] != null ? row[1] : "") };
      }
      var cols = columns || [];
      if (cols.length >= 2) {
        return {
          label: String(row[cols[0].key] != null ? row[cols[0].key] : ""),
          value: String(row[cols[1].key] != null ? row[cols[1].key] : "")
        };
      }
      var keys = Object.keys(row);
      return { label: String(row[keys[0]] != null ? row[keys[0]] : ""), value: String(row[keys[1]] != null ? row[keys[1]] : "") };
    });
    return {
      title: (runMeta && runMeta.title) || "Report",
      periodStart: runMeta && runMeta.from_date,
      periodEnd: runMeta && runMeta.to_date,
      generatedAt: new Date().toISOString(),
      generatedBy: "KAHDHU",
      rows: mappedRows,
      totals: summary ? JSON.stringify(summary) : ""
    };
  }

  function logGeneration(companyId, documentType, sourceId, template, version, storagePath) {
    var row = {
      company_id: companyId,
      document_type: documentType,
      source_record_id: sourceId || null,
      template_id: template && template.id || null,
      template_version_id: version && version.id || null,
      storage_path: storagePath || null,
      meta: {}
    };
    return db().from("document_generation_records").insert(row).then(function (r) {
      if (r.error && !/relation|does not exist|schema cache/i.test(r.error.message)) {
        console.warn("document_generation_records", r.error.message);
      }
    });
  }

  /**
   * Generate a PDF for a document type.
   * opts: { companyId, documentType, source, sample, filename, download }
   * source is the raw record (invoice row, payslip map, report map, etc.)
   */
  function generate(opts) {
    opts = opts || {};
    var companyId = opts.companyId;
    var documentType = opts.documentType;
    if (!companyId || !documentType) return Promise.reject(new Error("companyId and documentType are required."));

    return loadCompany(companyId).then(function (company) {
      return getPublishedConfig(companyId, documentType).then(function (pack) {
        var cfg = pack.config;
        var src = opts.source || null;
        var forceA5 = !!(opts.forceA5
          || (src && src.meta && (src.meta.paper === "A5" || src.meta.from_booking === true || src.meta.from_booking === "true"))
          || (src && src.booking_id));
        if (documentType === "invoice" && forceA5 && cfg && cfg.page) {
          cfg = JSON.parse(JSON.stringify(cfg));
          cfg.page.size = "A5";
          cfg.page.orientation = cfg.page.orientation || "portrait";
          if (!cfg.page.margins) cfg.page.margins = { top: 10, right: 10, bottom: 10, left: 10 };
          cfg = Schema().ensureCanvas(cfg);
          pack = Object.assign({}, pack, { config: cfg });
        }
        var data = Fields().buildData(documentType, company, src, { sample: !!opts.sample });
        var missing = Fields().missingRequired(documentType, data);
        if (missing.length && !opts.sample && !opts.allowMissing) {
          return Promise.reject(new Error("Missing required fields: " + missing.join(", ")));
        }
        return Engine().generatePdf(pack.config, data).then(function (pdf) {
          var name = opts.filename || (documentType + "-" + (new Date().toISOString().slice(0, 10)) + ".pdf");
          return logGeneration(companyId, documentType, opts.sourceId, pack.template, pack.version, null).then(function () {
            if (opts.download !== false) Engine().downloadBlob(pdf.blob, name);
            return Object.assign({ company: company, config: pack.config, data: data, template: pack.template, version: pack.version }, pdf);
          });
        });
      });
    });
  }

  /** Settings-store CRUD used when 0054 is not applied yet. */
  function settingsCreate(companyId, name, documentType, asDefault) {
    return loadCompany(companyId).then(function (c) {
      var store = settingsStore(c);
      var id = uuid();
      var vid = uuid();
      var cfg = Schema().defaultConfig(documentType);
      var tpl = {
        id: id, name: name, document_type: documentType, description: "",
        status: "Draft", is_default: !!asDefault, current_published_version_id: null,
        updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
        versions: [{ id: vid, version_number: 1, configuration: cfg, status: "Draft", created_at: new Date().toISOString() }]
      };
      if (asDefault) store.templates.forEach(function (t) {
        if (t.document_type === documentType) t.is_default = false;
      });
      store.templates.unshift(tpl);
      c.settings = c.settings || {};
      c.settings[STORE_KEY] = store;
      return saveSettingsStore(companyId, store).then(function () { return id; });
    });
  }

  function settingsSaveVersion(companyId, templateId, versionId, configuration, templatePatch) {
    return loadCompany(companyId).then(function (c) {
      var store = settingsStore(c);
      var tpl = store.templates.filter(function (t) { return t.id === templateId; })[0];
      if (!tpl) throw new Error("Template not found.");
      var ver = (tpl.versions || []).filter(function (v) { return v.id === versionId; })[0];
      if (!ver) throw new Error("Version not found.");
      if (ver.status === "Published") throw new Error("Published versions are immutable. Create a new draft first.");
      ver.configuration = configuration;
      if (templatePatch) Object.keys(templatePatch).forEach(function (k) { tpl[k] = templatePatch[k]; });
      tpl.updated_at = new Date().toISOString();
      return saveSettingsStore(companyId, store);
    });
  }

  function settingsEnsureDraft(companyId, templateId) {
    return loadCompany(companyId).then(function (c) {
      var store = settingsStore(c);
      var tpl = store.templates.filter(function (t) { return t.id === templateId; })[0];
      if (!tpl) throw new Error("Template not found.");
      var draft = (tpl.versions || []).filter(function (v) { return v.status === "Draft"; }).pop();
      if (draft) return draft;
      var src = (tpl.versions || []).filter(function (v) { return v.id === tpl.current_published_version_id; })[0]
        || (tpl.versions || [])[(tpl.versions || []).length - 1];
      var n = ((tpl.versions || []).reduce(function (m, v) { return Math.max(m, v.version_number || 0); }, 0)) + 1;
      draft = {
        id: uuid(), version_number: n,
        configuration: JSON.parse(JSON.stringify((src && src.configuration) || Schema().defaultConfig(tpl.document_type))),
        status: "Draft", created_at: new Date().toISOString()
      };
      tpl.versions = tpl.versions || [];
      tpl.versions.push(draft);
      tpl.status = "Draft";
      tpl.updated_at = new Date().toISOString();
      return saveSettingsStore(companyId, store).then(function () { return draft; });
    });
  }

  function settingsPublish(companyId, templateId, versionId) {
    return loadCompany(companyId).then(function (c) {
      var store = settingsStore(c);
      var tpl = store.templates.filter(function (t) { return t.id === templateId; })[0];
      if (!tpl) throw new Error("Template not found.");
      (tpl.versions || []).forEach(function (v) {
        if (v.status === "Published" && v.id !== versionId) v.status = "Superseded";
        if (v.id === versionId) { v.status = "Published"; v.published_at = new Date().toISOString(); }
      });
      tpl.status = "Published";
      tpl.current_published_version_id = versionId;
      tpl.updated_at = new Date().toISOString();
      return saveSettingsStore(companyId, store).then(function () { return tpl; });
    });
  }

  window.VeyoraPdfApi = {
    STORE_KEY: STORE_KEY,
    loadCompany: loadCompany,
    listTemplates: listTemplates,
    getPublishedConfig: getPublishedConfig,
    generate: generate,
    mapPayslip: mapPayslip,
    mapReportPayload: mapReportPayload,
    settingsCreate: settingsCreate,
    settingsSaveVersion: settingsSaveVersion,
    settingsEnsureDraft: settingsEnsureDraft,
    settingsPublish: settingsPublish,
    uuid: uuid
  };
})();
