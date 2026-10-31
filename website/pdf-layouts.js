/* PDF Layout Maker — template list + three-panel editor.
   Cursor 2026-10-24: company from DB; DB tables or settings.9_pdf_layout_store fallback;
   field picker, table columns, version restore, live preview source. */
(function () {
  var db = window.veyoraDb;
  var Api = window.VeyoraPdfApi;
  var esc = window.VeyoraShell.esc;
  var $ = function (id) { return document.getElementById(id); };
  var Schema = window.VeyoraPdfSchema;
  var Fields = window.VeyoraPdfFields;
  var Render = window.VeyoraPdfRender;
  var Engine = window.VeyoraPdfEngine;

  var company = null, canEdit = false, canView = false;
  var templates = [];
  var storeSource = "db"; // db | settings
  var filterType = "", filterStatus = "", q = "";
  var view = "list";
  var editing = null; // { template, version, config, dirty, versions }
  var selectedId = null;
  var zoom = 0.78;
  var companyRow = null;
  var previewMode = "sample"; // sample | live
  var liveSource = null;
  var liveLabel = "";
  var snapOn = true;
  var showGrid = true;
  var history = [];
  var histIdx = -1;
  var drag = null;
  var fieldQuery = "";
  var paletteQuery = "";
  var keysBound = false;

  function toast(msg, ok) {
    var el = document.createElement("div");
    el.className = "pl-toast " + (ok ? "ok" : "err");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  function typeLabel(id) {
    var t = Schema.DOC_TYPES.filter(function (d) { return d.id === id; })[0];
    return t ? t.label : id;
  }

  function loadCompanyRow() {
    return Api.loadCompany(company.id).then(function (row) {
      companyRow = row;
      return row;
    });
  }

  function loadTemplates() {
    return Api.listTemplates(company.id).then(function (pack) {
      storeSource = pack.source;
      templates = pack.templates || [];
    });
  }

  function seedDefaults() {
    if (!canEdit) return Promise.resolve();
    var need = ["invoice", "receipt", "payslip", "financial_report"].filter(function (t) {
      return !templates.some(function (x) { return x.document_type === t && x.status !== "Archived"; });
    });
    if (!need.length) return Promise.resolve();
    return need.reduce(function (p, type) {
      return p.then(function () { return createTemplate(typeLabel(type) + " (default)", type, true); });
    }, Promise.resolve()).then(loadTemplates);
  }

  function createTemplate(name, docType, asDefault) {
    if (storeSource === "settings") {
      return Api.settingsCreate(company.id, name, docType, asDefault);
    }
    var cfg = Schema.defaultConfig(docType);
    return db.from("document_templates").insert({
      company_id: company.id,
      name: name,
      document_type: docType,
      status: "Draft",
      is_default: !!asDefault
    }).select("id").single().then(function (r) {
      if (r.error) {
        if (/relation|does not exist|schema cache/i.test(r.error.message)) {
          storeSource = "settings";
          return Api.settingsCreate(company.id, name, docType, asDefault);
        }
        throw new Error(r.error.message);
      }
      return db.from("document_template_versions").insert({
        template_id: r.data.id,
        company_id: company.id,
        version_number: 1,
        configuration: cfg,
        schema_version: 2,
        status: "Draft"
      }).select("id").single().then(function (v) {
        if (v.error) throw new Error(v.error.message);
        return r.data.id;
      });
    });
  }

  function loadVersions(templateId) {
    if (storeSource === "settings") {
      var t = templates.filter(function (x) { return x.id === templateId; })[0];
      return Promise.resolve((t && t.versions) || []);
    }
    return db.from("document_template_versions").select("*").eq("template_id", templateId)
      .order("version_number", { ascending: true })
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return r.data || [];
      });
  }

  function openEdit(templateId) {
    previewMode = "sample";
    liveSource = null;
    liveLabel = "";
    if (storeSource === "settings") {
      return Api.settingsEnsureDraft(company.id, templateId).then(function (version) {
        return loadTemplates().then(function () {
          var t = templates.filter(function (x) { return x.id === templateId; })[0];
          if (!t) throw new Error("Template not found.");
          return loadVersions(templateId).then(function (versions) {
            editing = {
              template: t,
              version: version,
              versions: versions,
              config: Schema.ensureCanvas(JSON.parse(JSON.stringify(version.configuration || Schema.defaultConfig(t.document_type)))),
              dirty: false
            };
            selectedId = null;
            resetHist();
            view = "edit";
            render();
          });
        });
      });
    }
    return db.rpc("ensure_document_template_draft", { p_template: templateId }).then(function (r) {
      if (r.error) {
        return db.from("document_template_versions").select("*").eq("template_id", templateId)
          .order("version_number", { ascending: false }).limit(1).maybeSingle()
          .then(function (v) {
            if (v.error || !v.data) throw new Error(r.error.message);
            return v.data;
          });
      }
      return r.data;
    }).then(function (version) {
      return Promise.all([
        db.from("document_templates").select("*").eq("id", templateId).single(),
        loadVersions(templateId)
      ]).then(function (pair) {
        if (pair[0].error) throw new Error(pair[0].error.message);
        editing = {
          template: pair[0].data,
          version: version,
          versions: pair[1],
          config: Schema.ensureCanvas(JSON.parse(JSON.stringify(version.configuration || Schema.defaultConfig(pair[0].data.document_type)))),
          dirty: false
        };
        selectedId = null;
        resetHist();
        view = "edit";
        render();
      });
    });
  }

  function saveDraft() {
    if (!editing || !canEdit) return Promise.resolve();
    Schema.syncSectionsFromBlocks(editing.config);
    var errs = Schema.validateConfig(editing.config);
    if (errs.length) return Promise.reject(new Error(errs[0]));
    if (editing.version.status === "Published") {
      return Promise.reject(new Error("Published versions are immutable. Open again to create a new draft."));
    }
    var patch = { name: editing.template.name, description: editing.template.description || "" };
    if (storeSource === "settings") {
      return Api.settingsSaveVersion(company.id, editing.template.id, editing.version.id, editing.config, patch)
        .then(function () { editing.dirty = false; if ($("plDirty")) $("plDirty").hidden = true; toast("Draft saved.", true); });
    }
    return db.from("document_template_versions").update({ configuration: editing.config, schema_version: 2 }).eq("id", editing.version.id)
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return db.from("document_templates").update({
          name: patch.name,
          description: patch.description,
          updated_at: new Date().toISOString()
        }).eq("id", editing.template.id);
      }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        editing.dirty = false;
        if ($("plDirty")) $("plDirty").hidden = true;
        toast("Draft saved.", true);
      });
  }

  function publish() {
    if (!editing || !canEdit) return Promise.resolve();
    return saveDraft().then(function () {
      return Engine.generatePdf(editing.config, previewData()).then(function (pdf) {
        if (!pdf.pageCount || pdf.pageCount < 1) throw new Error("Test PDF produced no pages.");
        var after = function () {
          toast("Published (" + pdf.pageCount + " page PDF validated).", true);
          return loadTemplates().then(function () { return openEdit(editing.template.id); });
        };
        if (storeSource === "settings") {
          return Api.settingsPublish(company.id, editing.template.id, editing.version.id).then(after);
        }
        return db.rpc("publish_document_template", { p_template: editing.template.id, p_version: editing.version.id })
          .then(function (r) {
            if (r.error) {
              return db.from("document_template_versions").update({ status: "Published", published_at: new Date().toISOString() }).eq("id", editing.version.id)
                .then(function () {
                  return db.from("document_templates").update({
                    status: "Published",
                    current_published_version_id: editing.version.id
                  }).eq("id", editing.template.id);
                });
            }
          }).then(after);
      });
    });
  }

  function restoreVersion(versionId) {
    if (!editing || !canEdit) return Promise.resolve();
    var src = (editing.versions || []).filter(function (v) { return v.id === versionId; })[0];
    if (!src) return Promise.reject(new Error("Version not found."));
    if (!confirm("Restore configuration from v" + src.version_number + " into the current draft?")) return Promise.resolve();
    editing.config = Schema.ensureCanvas(JSON.parse(JSON.stringify(src.configuration || Schema.defaultConfig(editing.template.document_type))));
    selectedId = null;
    markDirty();
    pushHist();
    paintPalette();
    paintInspector();
    paintCanvas();
    toast("Restored v" + src.version_number + " into draft (not saved yet).", true);
  }

  function previewData() {
    var docType = editing.config.documentType || editing.template.document_type;
    return Fields.buildData(docType, companyRow || company, previewMode === "live" ? liveSource : null, { sample: previewMode !== "live" });
  }

  function filtered() {
    return templates.filter(function (t) {
      if (filterType && t.document_type !== filterType) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (q && String(t.name).toLowerCase().indexOf(q.toLowerCase()) < 0) return false;
      return t.status !== "Archived" || filterStatus === "Archived";
    });
  }

  function renderList() {
    $("plTitle").textContent = "PDF Layouts";
    $("plSub").textContent = "Drag blocks onto the page. Company name, logo and contacts always come from your company profile.";
    $("plActions").innerHTML = canEdit
      ? '<button type="button" class="primary-btn" id="plCreate">Create template</button>'
      : "";

    var rows = filtered();
    var banner = storeSource === "settings"
      ? '<div class="pl-banner"><div><strong>Using settings store</strong>Templates save in company settings until the document_templates tables are used. Published layouts still generate PDFs.</div></div>'
      : "";

    $("pl").innerHTML = banner +
      '<div class="pl-toolbar">' +
        '<input type="search" id="plQ" class="grow" placeholder="Search templates" value="' + esc(q) + '">' +
        '<div class="pl-chips" id="plChips">' +
          '<button type="button" class="pl-chip' + (!filterType ? " on" : "") + '" data-type="">All</button>' +
          Schema.DOC_TYPES.map(function (d) {
            return '<button type="button" class="pl-chip' + (filterType === d.id ? " on" : "") + '" data-type="' + d.id + '">' + esc(d.label) + "</button>";
          }).join("") +
        "</div>" +
        '<select id="plStatus"><option value="">Active statuses</option><option value="Draft"' + (filterStatus === "Draft" ? " selected" : "") + '>Draft</option><option value="Published"' + (filterStatus === "Published" ? " selected" : "") + '>Published</option><option value="Archived"' + (filterStatus === "Archived" ? " selected" : "") + '>Archived</option></select>' +
      '</div>' +
      '<div class="pl-grid">' +
        (canEdit ? '<button type="button" class="pl-card pl-card-new" id="plCreateCard">+ New layout</button>' : "") +
        rows.map(function (t) {
          return '<article class="pl-card">' +
            '<div class="pl-thumb t-' + esc(t.document_type) + '"></div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<span class="pl-badge ' + esc(String(t.status).toLowerCase()) + '">' + esc(t.status) + '</span>' +
              (t.is_default ? '<span class="pl-badge default">Default</span>' : "") +
            '</div>' +
            '<h3>' + esc(t.name) + '</h3>' +
            '<div class="meta"><span>' + esc(typeLabel(t.document_type)) + '</span><span>Updated ' + esc((t.updated_at || "").slice(0, 10)) + '</span></div>' +
            '<div class="acts">' +
              '<button type="button" class="btn-soft" data-edit="' + esc(t.id) + '">Edit canvas</button>' +
              '<button type="button" class="btn-soft" data-dup="' + esc(t.id) + '">Duplicate</button>' +
              (canEdit && t.status === "Published" && !t.is_default ? '<button type="button" class="btn-soft" data-def="' + esc(t.id) + '">Set default</button>' : "") +
              (canEdit && t.status !== "Archived" ? '<button type="button" class="ghost" data-arch="' + esc(t.id) + '">Archive</button>' : "") +
            '</div></article>';
        }).join("") +
      '</div>' +
      (!rows.length && !canEdit ? '<div class="pl-empty">No templates yet.</div>' : "");

    if ($("plCreate")) $("plCreate").onclick = function () { showCreateModal(); };
    if ($("plCreateCard")) $("plCreateCard").onclick = function () { showCreateModal(); };
    if ($("plQ")) $("plQ").oninput = function () { q = $("plQ").value; renderList(); };
    if ($("plChips")) $("plChips").onclick = function (e) {
      var btn = e.target.closest("[data-type]");
      if (!btn) return;
      filterType = btn.getAttribute("data-type") || "";
      renderList();
    };
    if ($("plStatus")) $("plStatus").onchange = function () { filterStatus = $("plStatus").value; renderList(); };
    $("pl").onclick = function (e) {
      var edit = e.target.closest("[data-edit]");
      var dup = e.target.closest("[data-dup]");
      var def = e.target.closest("[data-def]");
      var arch = e.target.closest("[data-arch]");
      if (edit) openEdit(edit.getAttribute("data-edit")).catch(function (err) { toast(err.message, false); });
      if (dup) duplicateTemplate(dup.getAttribute("data-dup")).catch(function (err) { toast(err.message, false); });
      if (def) setDefault(def.getAttribute("data-def")).catch(function (err) { toast(err.message, false); });
      if (arch) archiveTemplate(arch.getAttribute("data-arch")).catch(function (err) { toast(err.message, false); });
    };
  }

  function showCreateModal() {
    $("modalCard").className = "modal-card";
    $("modalCard").innerHTML = '<h2>Create template</h2><p class="note">Starts from a sensible default layout for the document type.</p>' +
      '<div class="fld"><label for="plNewName">Name</label><input id="plNewName" maxlength="120" value="New template"></div>' +
      '<div class="fld"><label for="plNewType">Document type</label><select id="plNewType">' +
        Schema.DOC_TYPES.map(function (d) { return '<option value="' + d.id + '">' + esc(d.label) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="save" id="plNewGo">Create</button></div>';
    $("modal").hidden = false;
    $("plNewGo").onclick = function () {
      var name = ($("plNewName").value || "").trim() || "New template";
      var type = $("plNewType").value;
      createTemplate(name, type, false).then(function (id) {
        $("modal").hidden = true;
        return loadTemplates().then(function () { return openEdit(id); });
      }).catch(function (e) { toast(e.message, false); });
    };
  }

  function duplicateTemplate(id) {
    var t = templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return Promise.reject(new Error("Not found."));
    if (storeSource === "settings") {
      var ver = (t.versions || []).filter(function (v) { return v.id === t.current_published_version_id; })[0]
        || (t.versions || [])[(t.versions || []).length - 1];
      var cfg = (ver && ver.configuration) || Schema.defaultConfig(t.document_type);
      return Api.settingsCreate(company.id, t.name + " (copy)", t.document_type, false).then(function (nid) {
        return loadTemplates().then(function () {
          var nt = templates.filter(function (x) { return x.id === nid; })[0];
          var draft = nt && nt.versions && nt.versions[0];
          if (draft) {
            return Api.settingsSaveVersion(company.id, nid, draft.id, cfg, { name: t.name + " (copy)" })
              .then(function () { toast("Duplicated.", true); return loadTemplates().then(renderList); });
          }
          toast("Duplicated.", true);
          renderList();
        });
      });
    }
    return db.from("document_template_versions").select("configuration").eq("template_id", id)
      .order("version_number", { ascending: false }).limit(1).maybeSingle()
      .then(function (v) {
        var cfg = (v.data && v.data.configuration) || Schema.defaultConfig(t.document_type);
        return createTemplate(t.name + " (copy)", t.document_type, false).then(function (nid) {
          return db.from("document_template_versions").update({ configuration: cfg }).eq("template_id", nid).eq("version_number", 1)
            .then(function () { return loadTemplates().then(function () { toast("Duplicated.", true); renderList(); }); });
        });
      });
  }

  function setDefault(id) {
    var t = templates.filter(function (x) { return x.id === id; })[0];
    if (storeSource === "settings") {
      return Api.loadCompany(company.id).then(function (c) {
        var store = (c.settings && c.settings[Api.STORE_KEY]) || { templates: [] };
        (store.templates || []).forEach(function (x) {
          if (x.document_type === t.document_type) x.is_default = x.id === id;
        });
        return db.rpc("set_company_setting", { p_company: company.id, p_key: Api.STORE_KEY, p_value: store })
          .then(function (r) {
            if (r.error) throw new Error(r.error.message);
            return loadTemplates().then(function () { toast("Default updated.", true); renderList(); });
          });
      });
    }
    return db.from("document_templates").update({ is_default: false }).eq("company_id", company.id).eq("document_type", t.document_type)
      .then(function () { return db.from("document_templates").update({ is_default: true }).eq("id", id); })
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return loadTemplates().then(function () { toast("Default updated.", true); renderList(); });
      });
  }

  function archiveTemplate(id) {
    if (!confirm("Archive this template?")) return Promise.resolve();
    if (storeSource === "settings") {
      return Api.loadCompany(company.id).then(function (c) {
        var store = (c.settings && c.settings[Api.STORE_KEY]) || { templates: [] };
        (store.templates || []).forEach(function (x) {
          if (x.id === id) { x.status = "Archived"; x.is_default = false; }
        });
        return db.rpc("set_company_setting", { p_company: company.id, p_key: Api.STORE_KEY, p_value: store })
          .then(function (r) {
            if (r.error) throw new Error(r.error.message);
            return loadTemplates().then(function () { toast("Archived.", true); renderList(); });
          });
      });
    }
    return db.from("document_templates").update({ status: "Archived", is_default: false }).eq("id", id).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return loadTemplates().then(function () { toast("Archived.", true); renderList(); });
    });
  }

  /* —— Canvas editor —— */
  var ICONS = {
    company_header: "M4 21V8l8-5 8 5v13M9 21v-6h6v6",
    logo: "M4 5h16v14H4zM8 9h3l1 2 2-4 2 6",
    document_title: "M5 7h14M5 12h10M5 17h8",
    document_meta: "M7 4h10v16H7zM10 8h4M10 12h4",
    party: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6",
    items_table: "M4 5h16v14H4zM4 10h16M10 5v14",
    totals: "M6 7h12M14 7v10M8 17h8",
    payment: "M3 7h18v10H3zM3 11h18",
    notes: "M7 4h8l4 4v12H7z",
    signature: "M4 18c3-6 5 2 8-2 2 4 4-2 8 2",
    footer: "M4 18h16M6 14h12",
    page_number: "M8 6h8v12H8zM10 9h4",
    text: "M5 7h14M9 7v10M7 17h4",
    field: "M4 8h16v8H4zM8 12h8",
    divider: "M4 12h16"
  };

  function pageClass() {
    var el = document.querySelector(".pdf-layouts-page");
    if (el) el.classList.toggle("is-editing", view === "edit" && !!editing);
  }

  function resetHist() {
    history = [JSON.stringify((editing && editing.config && editing.config.blocks) || [])];
    histIdx = 0;
  }
  function pushHist() {
    var snap = JSON.stringify((editing.config.blocks || []));
    if (history[histIdx] === snap) return;
    history = history.slice(0, histIdx + 1);
    history.push(snap);
    if (history.length > 60) { history.shift(); }
    histIdx = history.length - 1;
  }
  function applyHist(idx) {
    if (idx < 0 || idx >= history.length) return;
    histIdx = idx;
    editing.config.blocks = JSON.parse(history[histIdx]);
    markDirty();
    paintCanvas();
    paintInspector();
  }

  function selectedBlock() {
    return (editing.config.blocks || []).filter(function (b) { return b.id === selectedId; })[0] || null;
  }
  function pageDimsNow() { return Schema.pageDims(editing.config.page); }

  function fitZoom() {
    var stage = $("plxStage");
    var d = pageDimsNow();
    if (!stage) return;
    var availW = Math.max(240, stage.clientWidth - 72);
    var availH = Math.max(240, stage.clientHeight - 48);
    var z = Math.min(availW / (d.w * 3.78), availH / (d.h * 3.78));
    zoom = Math.max(0.38, Math.min(1.2, z));
  }

  function renderEditor() {
    var t = editing.template;
    $("plTitle").textContent = t.name;
    $("plSub").textContent = typeLabel(t.document_type) + " · drag blocks onto the page";
    $("plActions").innerHTML = "";
    pageClass();
    $("pl").innerHTML =
      '<div class="plx">' +
        '<aside class="plx-side"><div class="plx-h">Blocks</div><div class="plx-body" id="plxPalette"></div></aside>' +
        '<section class="plx-stage-wrap">' +
          '<div class="plx-bar">' +
            '<button type="button" id="plBack">← Back</button>' +
            '<span class="name">' + esc(t.name) + "</span>" +
            (editing.dirty ? '<span class="dirty" id="plDirty">Unsaved</span>' : '<span class="dirty" id="plDirty" hidden>Unsaved</span>') +
            '<span class="grow"></span>' +
            '<button type="button" id="plUndo">Undo</button>' +
            '<button type="button" id="plRedo">Redo</button>' +
            '<button type="button" id="plZoomOut">−</button><span class="zoom" id="plZoomLab">' + Math.round(zoom * 100) + '%</span><button type="button" id="plZoomIn">+</button>' +
            '<button type="button" id="plFit">Fit</button>' +
            '<button type="button" class="tog' + (showGrid ? " on" : "") + '" id="plGrid">Grid</button>' +
            '<button type="button" class="tog' + (snapOn ? " on" : "") + '" id="plSnap">Snap</button>' +
            '<select id="plPrevMode" aria-label="Preview data">' +
              '<option value="sample"' + (previewMode === "sample" ? " selected" : "") + ">Sample data</option>" +
              '<option value="live"' + (previewMode === "live" ? " selected" : "") + ">Live record…</option>" +
            "</select>" +
            '<button type="button" id="plTestPdf">Test PDF</button>' +
            (canEdit ? '<button type="button" class="btn-soft" id="plSave">Save</button><button type="button" class="primary-btn" id="plPub">Publish</button>' : "") +
          "</div>" +
          '<div class="plx-stage" id="plxStage"></div>' +
        "</section>" +
        '<aside class="plx-props"><div class="plx-h">Inspector</div><div class="plx-body" id="plxProps"></div></aside>' +
      "</div>";
    paintPalette();
    paintInspector();
    bindEditorChrome();
    bindKeys();
    requestAnimationFrame(function () { fitZoom(); paintCanvas(); });
  }

  function bindEditorChrome() {
    $("plBack").onclick = function () {
      if (editing.dirty && !confirm("Discard unsaved changes?")) return;
      view = "list"; editing = null; selectedId = null; drag = null; pageClass(); render();
    };
    if ($("plSave")) $("plSave").onclick = function () { saveDraft().catch(function (e) { toast(e.message, false); }); };
    if ($("plPub")) $("plPub").onclick = function () {
      if (!confirm("Generate a test PDF and publish this version? Published versions stay immutable.")) return;
      publish().catch(function (e) { toast(e.message, false); });
    };
    $("plTestPdf").onclick = function () {
      Engine.generatePdf(editing.config, previewData()).then(function (pdf) {
        Engine.downloadBlob(pdf.blob, (editing.template.name || "template") + "-test.pdf");
        toast("Test PDF · " + pdf.pageCount + " page(s)", true);
      }).catch(function (e) { toast(e.message, false); });
    };
    $("plZoomIn").onclick = function () { zoom = Math.min(1.4, zoom + 0.08); paintCanvas(); };
    $("plZoomOut").onclick = function () { zoom = Math.max(0.38, zoom - 0.08); paintCanvas(); };
    $("plFit").onclick = function () { fitZoom(); paintCanvas(); };
    $("plGrid").onclick = function () { showGrid = !showGrid; $("plGrid").classList.toggle("on", showGrid); paintCanvas(); };
    $("plSnap").onclick = function () { snapOn = !snapOn; $("plSnap").classList.toggle("on", snapOn); };
    $("plUndo").onclick = function () { applyHist(histIdx - 1); };
    $("plRedo").onclick = function () { applyHist(histIdx + 1); };
    $("plPrevMode").onchange = function () {
      if ($("plPrevMode").value === "live") pickLiveRecord();
      else { previewMode = "sample"; liveSource = null; liveLabel = ""; renderEditor(); }
    };
  }

  function bindKeys() {
    if (keysBound) return;
    keysBound = true;
    document.addEventListener("keydown", onEditorKey);
  }
  function onEditorKey(e) {
    if (view !== "edit" || !editing) return;
    var tag = (e.target && e.target.tagName) || "";
    var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (canEdit) saveDraft().catch(function (err) { toast(err.message, false); });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      applyHist(e.shiftKey ? histIdx + 1 : histIdx - 1);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if (typing) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId && canEdit) {
      e.preventDefault();
      deleteSelected();
    }
    if (e.key === "Escape") { selectedId = null; paintCanvas(); paintInspector(); }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(e.key) >= 0) {
      var b = selectedBlock();
      if (!b || !canEdit) return;
      e.preventDefault();
      var step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") b.x -= step;
      if (e.key === "ArrowRight") b.x += step;
      if (e.key === "ArrowUp") b.y -= step;
      if (e.key === "ArrowDown") b.y += step;
      Schema.clampBlock(b, pageDimsNow());
      markDirty();
      paintCanvas();
      paintInspector();
      pushHist();
    }
  }

  function pickLiveRecord() {
    var docType = editing.template.document_type;
    var html = '<h2>Preview with live data</h2><p class="note">Pick a recent record. Company profile still loads from the database.</p><div id="plLiveList"><p class="msg">Loading…</p></div>' +
      '<div class="modal-actions"><button type="button" class="ghost" data-close>Cancel</button></div>';
    $("modalCard").className = "modal-card";
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;

    var load;
    if (docType === "invoice" || docType === "receipt") {
      load = db.from("invoices").select("id,code,customer_name,total,status,issue_date,amount_paid,payment_method,items,subtotal,tax,note,currency")
        .eq("company_id", company.id).order("issue_date", { ascending: false }).limit(20)
        .then(function (r) {
          if (r.error) throw new Error(r.error.message);
          var rows = r.data || [];
          if (!rows.length) return '<p class="note">No invoices yet. Create one under Finance → Invoices.</p>';
          return '<div class="pl-live">' + rows.map(function (inv) {
            return '<button type="button" class="pl-live-row" data-id="' + esc(inv.id) + '"><strong>' + esc(inv.code || inv.id.slice(0, 8)) + '</strong><small>' + esc(inv.customer_name) + " · " + esc(String(inv.status)) + "</small></button>";
          }).join("") + "</div>";
        });
    } else if (docType === "payslip") {
      load = db.from("payroll_runs").select("id,period_start,period_end,status").eq("company_id", company.id)
        .order("period_end", { ascending: false }).limit(8)
        .then(function (r) {
          if (r.error) throw new Error(r.error.message);
          var runs = r.data || [];
          if (!runs.length) return Promise.resolve('<p class="note">No pay runs yet.</p>');
          return db.from("payroll_lines").select("run_id,user_id,basic,allowances,allowance_items,overtime_amount,overtime_min,holiday_min,unpaid_days,unpaid_amount,absent_days,absent_amount,gross,pension_employee,pension_employer,net,pay_method")
            .in("run_id", runs.map(function (x) { return x.id; })).limit(40)
            .then(function (l) {
              if (l.error) throw new Error(l.error.message);
              var lines = l.data || [];
              if (!lines.length) return '<p class="note">No payslip lines yet.</p>';
              return '<div class="pl-live">' + lines.map(function (line) {
                var run = runs.filter(function (x) { return x.id === line.run_id; })[0];
                return '<button type="button" class="pl-live-row" data-run="' + esc(line.run_id) + '" data-user="' + esc(line.user_id) + '"><strong>Payslip</strong><small>' + esc((run && run.period_start) || "") + " → " + esc((run && run.period_end) || "") + "</small></button>";
              }).join("") + "</div>";
            });
        });
    } else {
      load = Promise.resolve('<p class="note">Live picker for this type uses Reports export. Stick with sample data in the editor, or generate from Reports.</p>');
    }

    load.then(function (inner) {
      $("plLiveList").innerHTML = inner;
      $("plLiveList").onclick = function (e) {
        var btn = e.target.closest(".pl-live-row");
        if (!btn) return;
        if (docType === "invoice" || docType === "receipt") {
          var id = btn.getAttribute("data-id");
          db.from("invoices").select("*").eq("id", id).single().then(function (r) {
            if (r.error) throw new Error(r.error.message);
            var inv = r.data;
            if (docType === "receipt") {
              liveSource = {
                number: inv.code, date: inv.issue_date, payer: inv.customer_name,
                amount: inv.amount_paid || inv.total, paymentMethod: inv.payment_method || "",
                reference: "", bookingRef: inv.booking_id || "", note: inv.note || ""
              };
            } else liveSource = inv;
            liveLabel = (inv.code || "Invoice") + " · " + (inv.customer_name || "");
            previewMode = "live";
            $("modal").hidden = true;
            renderEditor();
          }).catch(function (err) { toast(err.message, false); });
        } else if (docType === "payslip") {
          var runId = btn.getAttribute("data-run");
          var uid = btn.getAttribute("data-user");
          Promise.all([
            db.from("payroll_runs").select("*").eq("id", runId).single(),
            db.from("payroll_lines").select("*").eq("run_id", runId).eq("user_id", uid).maybeSingle(),
            db.from("profiles").select("id,full_name").eq("id", uid).maybeSingle()
          ]).then(function (arr) {
            if (arr[0].error) throw new Error(arr[0].error.message);
            if (arr[1].error || !arr[1].data) throw new Error("Payslip line not found.");
            var staff = { name: (arr[2].data && arr[2].data.full_name) || "Employee", empNo: "", position: "" };
            liveSource = Api.mapPayslip(arr[0].data, arr[1].data, staff);
            liveLabel = staff.name + " · " + arr[0].data.period_end;
            previewMode = "live";
            $("modal").hidden = true;
            renderEditor();
          }).catch(function (err) { toast(err.message, false); });
        }
      };
    }).catch(function (err) {
      $("plLiveList").innerHTML = '<p class="msg err">' + esc(err.message) + "</p>";
      previewMode = "sample";
    });
  }

  function markDirty() {
    editing.dirty = true;
    if ($("plDirty")) $("plDirty").hidden = false;
    if ($("plSub")) $("plSub").textContent = typeLabel(editing.template.document_type) + " · unsaved changes";
  }

  function paintPalette() {
    var box = $("plxPalette");
    if (!box) return;
    var types = Object.keys(Schema.BLOCK_TYPES);
    var q = (paletteQuery || "").toLowerCase();
    var groups = { Layout: [], Elements: [] };
    types.forEach(function (id) {
      var meta = Schema.BLOCK_TYPES[id];
      if (q && (meta.label + " " + id).toLowerCase().indexOf(q) < 0) return;
      (groups[meta.group] || groups.Layout).push(id);
    });
    var html = '<input class="plx-search" id="plxPalQ" placeholder="Search blocks" value="' + esc(paletteQuery) + '">';
    Object.keys(groups).forEach(function (g) {
      if (!groups[g].length) return;
      html += '<div class="plx-group">' + g + "</div>";
      groups[g].forEach(function (id) {
        var meta = Schema.BLOCK_TYPES[id];
        html += '<button type="button" class="plx-item" data-place="' + esc(id) + '">' +
          '<span class="ic"><svg viewBox="0 0 24 24"><path d="' + (ICONS[id] || ICONS.text) + '"/></svg></span>' +
          "<span><strong>" + esc(meta.label) + "</strong><small>" + esc(meta.hint) + "</small></span></button>";
      });
    });
    html += '<p class="plx-hint">Drag a block onto the page, or click to drop it in an open spot.</p>';
    html += '<div class="plx-group">Data fields</div>';
    html += '<input class="plx-search" id="plxFieldQ" placeholder="Search fields" value="' + esc(fieldQuery) + '">';
    html += '<ul class="plx-fields" id="plxFieldList"></ul>';
    box.innerHTML = html;
    paintFieldList();
    if ($("plxPalQ")) $("plxPalQ").oninput = function () { paletteQuery = $("plxPalQ").value; paintPalette(); };
    if ($("plxFieldQ")) $("plxFieldQ").oninput = function () { fieldQuery = $("plxFieldQ").value; paintFieldList(); };
    box.onpointerdown = function (e) {
      var item = e.target.closest("[data-place]");
      var field = e.target.closest("[data-field]");
      if (item) startPlace(item.getAttribute("data-place"), {}, e);
      else if (field) startPlace("field", { fieldKey: field.getAttribute("data-field"), heading: field.getAttribute("data-label") }, e);
    };
  }

  function paintFieldList() {
    var list = $("plxFieldList");
    if (!list) return;
    var q = (fieldQuery || "").toLowerCase();
    var rows = Fields.forType(editing.template.document_type).filter(function (f) {
      if (f.type === "table" || f.type === "html") return false;
      return !q || (f.label + " " + f.key).toLowerCase().indexOf(q) >= 0;
    });
    list.innerHTML = rows.map(function (f) {
      return '<li data-field="' + esc(f.key) + '" data-label="' + esc(f.label) + '"><code>' + esc(f.key) + "</code><span>" + esc(f.label) + (f.optional === false ? " *" : "") + "</span></li>";
    }).join("") || '<li style="cursor:default;opacity:.7">No matching fields</li>';
  }

  function nextDropPoint() {
    var d = pageDimsNow();
    var m = d.margins;
    var blocks = editing.config.blocks || [];
    var y = m.top;
    blocks.forEach(function (b) {
      if (b.visible === false) return;
      y = Math.max(y, b.y + b.h + 4);
    });
    if (y > d.h - 28) return { x: m.left + 16, y: Math.round(d.h * 0.42) };
    return { x: m.left, y: y };
  }

  function addBlock(type, x, y, extra) {
    extra = extra || {};
    extra.z = extra.z || ((editing.config.blocks || []).reduce(function (m, b) { return Math.max(m, b.z || 0); }, 0) + 1);
    extra.pageW = pageDimsNow().w - pageDimsNow().margins.left - pageDimsNow().margins.right;
    var block = Schema.newBlock(type, x, y, extra);
    Schema.clampBlock(block, pageDimsNow());
    editing.config.blocks = editing.config.blocks || [];
    editing.config.blocks.push(block);
    selectedId = block.id;
    markDirty();
    pushHist();
    paintCanvas();
    paintInspector();
    return block;
  }

  function deleteSelected() {
    var i = (editing.config.blocks || []).findIndex(function (b) { return b.id === selectedId; });
    if (i < 0) return;
    editing.config.blocks.splice(i, 1);
    selectedId = null;
    markDirty();
    pushHist();
    paintCanvas();
    paintInspector();
  }

  function duplicateSelected() {
    var b = selectedBlock();
    if (!b || !canEdit) return;
    var copy = JSON.parse(JSON.stringify(b));
    copy.id = Schema.uid("b");
    copy.x += 4;
    copy.y += 4;
    copy.z = ((editing.config.blocks || []).reduce(function (m, x) { return Math.max(m, x.z || 0); }, 0) + 1);
    Schema.clampBlock(copy, pageDimsNow());
    editing.config.blocks.push(copy);
    selectedId = copy.id;
    markDirty();
    pushHist();
    paintCanvas();
    paintInspector();
  }

  function clientToMm(e, paper) {
    var r = paper.getBoundingClientRect();
    var d = pageDimsNow();
    return {
      x: ((e.clientX - r.left) / r.width) * d.w,
      y: ((e.clientY - r.top) / r.height) * d.h
    };
  }

  function maybeSnap(n) {
    return snapOn ? Schema.snapVal(n, 2) : Math.round(n * 10) / 10;
  }

  function alignSnap(block) {
    var others = (editing.config.blocks || []).filter(function (b) { return b.id !== block.id && b.visible !== false; });
    var d = pageDimsNow();
    var thresh = 1.4;
    var guides = [];
    function edge(b) {
      return { l: b.x, r: b.x + b.w, t: b.y, b: b.y + b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    }
    var a = edge(block);
    function tryV(pos, which) {
      if (Math.abs(a[which] - pos) < thresh) {
        if (which === "l") block.x = pos;
        else if (which === "r") block.x = pos - block.w;
        else block.x = pos - block.w / 2;
        guides.push({ axis: "v", pos: pos });
      }
    }
    function tryH(pos, which) {
      if (Math.abs(a[which] - pos) < thresh) {
        if (which === "t") block.y = pos;
        else if (which === "b") block.y = pos - block.h;
        else block.y = pos - block.h / 2;
      }
    }
    tryV(d.w / 2, "cx");
    tryH(d.h / 2, "cy");
    others.forEach(function (o) {
      var b = edge(o);
      tryV(b.l, "l"); tryV(b.r, "l"); tryV(b.l, "r"); tryV(b.r, "r"); tryV(b.cx, "cx");
      tryH(b.t, "t"); tryH(b.b, "t"); tryH(b.t, "b"); tryH(b.b, "b"); tryH(b.cy, "cy");
    });
    a = edge(block);
    others.forEach(function (o) {
      var b = edge(o);
      if (Math.abs(a.l - b.l) < 0.6 || Math.abs(a.l - b.r) < 0.6 || Math.abs(a.r - b.l) < 0.6 || Math.abs(a.r - b.r) < 0.6 || Math.abs(a.cx - b.cx) < 0.6) {
        guides.push({ axis: "v", pos: Math.abs(a.l - b.l) < 0.6 ? b.l : Math.abs(a.r - b.r) < 0.6 ? b.r : Math.abs(a.cx - b.cx) < 0.6 ? b.cx : b.l });
      }
      if (Math.abs(a.t - b.t) < 0.6 || Math.abs(a.t - b.b) < 0.6 || Math.abs(a.b - b.t) < 0.6 || Math.abs(a.b - b.b) < 0.6 || Math.abs(a.cy - b.cy) < 0.6) {
        guides.push({ axis: "h", pos: Math.abs(a.t - b.t) < 0.6 ? b.t : Math.abs(a.b - b.b) < 0.6 ? b.b : Math.abs(a.cy - b.cy) < 0.6 ? b.cy : b.t });
      }
    });
    return guides;
  }

  function paintGuides(guides) {
    var el = $("plxGuides");
    if (!el) return;
    el.innerHTML = (guides || []).map(function (g) {
      if (g.axis === "v") return '<div class="plx-guide v" style="left:' + g.pos + 'mm"></div>';
      return '<div class="plx-guide h" style="top:' + g.pos + 'mm"></div>';
    }).join("");
  }

  function startPlace(type, extra, e) {
    if (!canEdit) return;
    e.preventDefault();
    var ghost = document.createElement("div");
    ghost.className = "plx-ghost";
    ghost.textContent = (extra.heading || (Schema.BLOCK_TYPES[type] && Schema.BLOCK_TYPES[type].label) || type);
    document.body.appendChild(ghost);
    ghost.style.left = e.clientX + "px";
    ghost.style.top = e.clientY + "px";
    drag = { kind: "place", type: type, extra: extra, ghost: ghost };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp);
  }

  function startMove(e, id) {
    if (!canEdit) return;
    var b = (editing.config.blocks || []).filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    e.preventDefault();
    selectedId = id;
    var paper = $("plxPaper");
    [].forEach.call(paper.querySelectorAll(".plx-block"), function (el) {
      el.classList.toggle("on", el.getAttribute("data-id") === id);
    });
    var mm = clientToMm(e, paper);
    drag = { kind: "move", id: id, dx: mm.x - b.x, dy: mm.y - b.y, ox: b.x, oy: b.y, moved: false };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp);
  }

  function startResize(e, id, handle) {
    if (!canEdit) return;
    var b = (editing.config.blocks || []).filter(function (x) { return x.id === id; })[0];
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    selectedId = id;
    drag = {
      kind: "resize", id: id, handle: handle,
      x: b.x, y: b.y, w: b.w, h: b.h, moved: false
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp);
  }

  function onDragMove(e) {
    if (!drag) return;
    if (drag.ghost) {
      drag.ghost.style.left = e.clientX + "px";
      drag.ghost.style.top = e.clientY + "px";
    }
    var paper = $("plxPaper");
    if (!paper) return;
    if (drag.kind === "place") {
      paper.classList.toggle("drop-on", overPaper(e, paper));
      return;
    }
    var mm = clientToMm(e, paper);
    var b = selectedBlock();
    if (!b) return;
    if (drag.kind === "move") {
      drag.moved = true;
      b.x = maybeSnap(mm.x - drag.dx);
      b.y = maybeSnap(mm.y - drag.dy);
      var g = alignSnap(b);
      Schema.clampBlock(b, pageDimsNow());
      var el = paper.querySelector('[data-id="' + b.id + '"]');
      if (el) { el.style.left = b.x + "mm"; el.style.top = b.y + "mm"; }
      paintGuides(g);
    } else if (drag.kind === "resize") {
      drag.moved = true;
      var x2 = mm.x, y2 = mm.y;
      var h = drag.handle;
      var x = drag.x, y = drag.y, w = drag.w, hh = drag.h;
      if (h.indexOf("e") >= 0) w = x2 - x;
      if (h.indexOf("s") >= 0) hh = y2 - y;
      if (h.indexOf("w") >= 0) { w = (x + drag.w) - x2; x = x2; }
      if (h.indexOf("n") >= 0) { hh = (y + drag.h) - y2; y = y2; }
      b.x = maybeSnap(x); b.y = maybeSnap(y); b.w = maybeSnap(w); b.h = maybeSnap(hh);
      Schema.clampBlock(b, pageDimsNow());
      var node = paper.querySelector('[data-id="' + b.id + '"]');
      if (node) {
        node.style.left = b.x + "mm"; node.style.top = b.y + "mm";
        node.style.width = b.w + "mm"; node.style.height = b.h + "mm";
      }
    }
  }

  function overPaper(e, paper) {
    var r = paper.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onDragUp(e) {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragUp);
    var paper = $("plxPaper");
    if (drag && drag.ghost) drag.ghost.remove();
    if (drag && drag.kind === "place") {
      if (paper && overPaper(e, paper)) {
        var mm = clientToMm(e, paper);
        var extra = Object.assign({}, drag.extra || {});
        addBlock(drag.type, maybeSnap(mm.x) - 8, maybeSnap(mm.y) - 6, extra);
      } else if (drag.type) {
        var p = nextDropPoint();
        addBlock(drag.type, p.x, p.y, drag.extra || {});
      }
    } else if (drag && (drag.kind === "move" || drag.kind === "resize")) {
      if (drag.moved) { markDirty(); pushHist(); }
      paintCanvas();
      paintInspector();
    }
    if (paper) paper.classList.remove("drop-on");
    paintGuides([]);
    drag = null;
  }

  function paintCanvas() {
    var stage = $("plxStage");
    if (!stage || !editing) return;
    if ($("plZoomLab")) $("plZoomLab").textContent = Math.round(zoom * 100) + "%";
    var d = pageDimsNow();
    var m = d.margins;
    var data = previewData();
    var blocks = (editing.config.blocks || []).slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    var pxW = Math.round(d.w * 3.7795 * zoom);
    var pxH = Math.round(d.h * 3.7795 * zoom);
    var html = '<div style="width:' + pxW + "px;height:" + pxH + 'px">' +
      '<div class="plx-world" id="plxWorld" style="width:' + d.w + "mm;height:" + d.h + "mm;transform:scale(" + zoom + ')">' +
      '<div class="plx-paper" id="plxPaper" style="width:' + d.w + "mm;height:" + d.h + 'mm">' +
        (showGrid ? '<div class="plx-grid"></div>' : "") +
        '<div class="plx-margin" style="left:' + m.left + "mm;top:" + m.top + "mm;width:" + (d.w - m.left - m.right) + "mm;height:" + (d.h - m.top - m.bottom) + 'mm"></div>' +
        '<div class="plx-guides" id="plxGuides"></div>' +
        blocks.map(function (b) {
          var on = selectedId === b.id;
          var handles = on
            ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(function (h) {
                return '<i class="plx-handle ' + h + '" data-handle="' + h + '"></i>';
              }).join("") + '<span class="plx-label">' + esc((Schema.BLOCK_TYPES[b.type] && Schema.BLOCK_TYPES[b.type].label) || b.type) + "</span>"
            : "";
          return '<div class="plx-block' + (on ? " on" : "") + (b.visible === false ? " hidden-blk" : "") + '" data-id="' + esc(b.id) + '" style="left:' + b.x + "mm;top:" + b.y + "mm;width:" + b.w + "mm;height:" + b.h + "mm;z-index:" + ((on ? 40 : (b.z || 1))) + '">' +
            '<div class="plx-inner"></div>' + handles + "</div>";
        }).join("") +
      "</div></div></div>";
    stage.innerHTML = html;
    var css = Render.editorBlockCss(editing.config);
    blocks.forEach(function (b) {
      var host = stage.querySelector('[data-id="' + b.id + '"] .plx-inner');
      if (!host) return;
      var inner = Render.renderSection({
        id: b.type, heading: b.heading, visible: true, fieldKey: b.fieldKey, text: b.text,
        align: b.align, fontSize: b.fontSize, bold: b.bold, color: b.color
      }, editing.config, data, { preview: true });
      var root = host.attachShadow({ mode: "open" });
      root.innerHTML = "<style>" + css + "</style><div class='vey-doc'>" + inner + "</div>";
    });
    var paper = $("plxPaper");
    paper.onpointerdown = function (e) {
      var handle = e.target.closest("[data-handle]");
      var blk = e.target.closest(".plx-block");
      if (handle && blk) startResize(e, blk.getAttribute("data-id"), handle.getAttribute("data-handle"));
      else if (blk) startMove(e, blk.getAttribute("data-id"));
      else {
        selectedId = null;
        paintCanvas();
        paintInspector();
      }
    };
  }

  function paintInspector() {
    var box = $("plxProps");
    if (!box) return;
    var cfg = editing.config;
    var page = cfg.page;
    var b = selectedBlock();
    var html = "";
    if (b) {
      var meta = Schema.BLOCK_TYPES[b.type] || { label: b.type };
      html += '<p class="plx-prop-h">' + esc(meta.label) + "</p>";
      html += '<div class="row2"><div class="fld"><label>X mm</label><input id="plxX" type="number" step="0.5" value="' + b.x + '"></div>' +
        '<div class="fld"><label>Y mm</label><input id="plxY" type="number" step="0.5" value="' + b.y + '"></div></div>';
      html += '<div class="row2"><div class="fld"><label>W mm</label><input id="plxW" type="number" step="0.5" value="' + b.w + '"></div>' +
        '<div class="fld"><label>H mm</label><input id="plxH" type="number" step="0.5" value="' + b.h + '"></div></div>';
      html += '<div class="fld"><label>Heading / label</label><input id="plxHead" value="' + esc(b.heading || "") + '"></div>';
      if (b.type === "text") html += '<div class="fld"><label>Text</label><textarea id="plxText">' + esc(b.text || "") + "</textarea></div>";
      if (b.type === "field") {
        html += '<div class="fld"><label>Bound field</label><select id="plxField">';
        Fields.forType(editing.template.document_type).forEach(function (f) {
          if (f.type === "table" || f.type === "html") return;
          html += '<option value="' + esc(f.key) + '"' + (b.fieldKey === f.key ? " selected" : "") + ">" + esc(f.label) + "</option>";
        });
        html += "</select></div>";
      }
      html += '<div class="row2"><div class="fld"><label>Align</label><select id="plxAlign"><option value="left">Left</option><option value="center"' + (b.align === "center" ? " selected" : "") + '>Center</option><option value="right"' + (b.align === "right" ? " selected" : "") + ">Right</option></select></div>" +
        '<div class="fld"><label>Size pt</label><input id="plxFsBlk" type="number" min="7" max="28" value="' + (b.fontSize || "") + '" placeholder="Auto"></div></div>';
      html += '<label class="fs-toggle" style="margin:6px 0;display:flex;gap:8px;align-items:center"><input type="checkbox" id="plxBold"' + (b.bold ? " checked" : "") + "> Bold</label>";
      html += '<label class="fs-toggle" style="margin:6px 0;display:flex;gap:8px;align-items:center"><input type="checkbox" id="plxVis"' + (b.visible !== false ? " checked" : "") + "> Visible</label>";
      html += '<div class="plx-arrange" style="margin-top:8px">' +
        '<button type="button" class="btn-soft" id="plxFront">Bring front</button>' +
        '<button type="button" class="btn-soft" id="plxBack">Send back</button>' +
        '<button type="button" class="btn-soft" id="plxDup">Duplicate</button>' +
        '<button type="button" class="ghost" id="plxDel">Delete</button></div>';
    } else {
      html += '<div class="plx-empty-sel"><strong>Drag & place</strong>Grab a block from the left and drop it on the page. Click a block to edit it here.</div>';
    }

    html += '<p class="plx-prop-h">Page</p>';
    html += '<div class="fld"><label>Template name</label><input id="plName" value="' + esc(editing.template.name) + '"' + (canEdit ? "" : " readonly") + "></div>";
    html += '<div class="fld"><label>Restore version</label><select id="plRestore"><option value="">—</option>';
    (editing.versions || []).forEach(function (v) {
      html += '<option value="' + esc(v.id) + '">v' + v.version_number + " · " + esc(v.status) + "</option>";
    });
    html += "</select></div>";
    html += '<div class="row2"><div class="fld"><label>Size</label><select id="plSize">' +
      Object.keys(Schema.PAGE).map(function (k) { return "<option" + (page.size === k ? " selected" : "") + ">" + k + "</option>"; }).join("") +
      '</select></div><div class="fld"><label>Orientation</label><select id="plOri"><option value="portrait"' + (page.orientation !== "landscape" ? " selected" : "") + '>Portrait</option><option value="landscape"' + (page.orientation === "landscape" ? " selected" : "") + ">Landscape</option></select></div></div>";
    html += '<div class="row2"><div class="fld"><label>Margin top</label><input id="plMt" type="number" min="5" max="25" value="' + page.margins.top + '"></div>' +
      '<div class="fld"><label>Margin bottom</label><input id="plMb" type="number" min="5" max="25" value="' + page.margins.bottom + '"></div></div>';
    html += '<div class="row2"><div class="fld"><label>Margin left</label><input id="plMl" type="number" min="5" max="25" value="' + page.margins.left + '"></div>' +
      '<div class="fld"><label>Margin right</label><input id="plMr" type="number" min="5" max="25" value="' + page.margins.right + '"></div></div>';
    html += '<div class="row2"><div class="fld"><label>Accent</label><input id="plAccent" type="color" value="' + esc(page.accentColor || "#1677e8") + '"></div>' +
      '<div class="fld"><label>Base font</label><input id="plFs" type="number" min="8" max="16" value="' + (page.baseFontSize || 11) + '"></div></div>';
    html += '<label class="fs-toggle" style="margin:8px 0;display:flex;gap:8px;align-items:center"><input type="checkbox" id="plPages"' + (page.pageNumbers !== false ? " checked" : "") + "> Page numbers on PDF</label>";

    html += '<p class="plx-prop-h">Table columns</p><div class="plx-cols" id="plCols">';
    (cfg.table && cfg.table.columns || []).forEach(function (col, i) {
      html += '<div class="plx-col-row" data-ci="' + i + '">' +
        '<input data-ck="label" value="' + esc(col.label || "") + '" placeholder="Label">' +
        '<input data-ck="key" value="' + esc(col.key || "") + '" placeholder="Field key">' +
        '<input data-ck="width" type="number" min="5" max="80" value="' + (col.width || 20) + '" title="Width %">' +
        '<button type="button" data-cdel="' + i + '" title="Remove">×</button></div>';
    });
    html += '</div><button type="button" class="btn-soft" id="plColAdd" style="margin-top:6px">Add column</button>';
    html += '<p class="plx-hint">Shortcuts: <span class="plx-k">⌫</span> delete <span class="plx-k">⌘D</span> duplicate <span class="plx-k">⌘Z</span> undo <span class="plx-k">arrows</span> nudge</p>';

    box.innerHTML = html;

    function bind(id, fn) {
      var el = $(id); if (!el || !canEdit) return;
      el.addEventListener("change", fn);
      el.addEventListener("input", fn);
    }
    bind("plName", function () { editing.template.name = $("plName").value; markDirty(); });
    bind("plRestore", function () {
      var id = $("plRestore").value;
      if (id) restoreVersion(id).catch(function (e) { toast(e.message, false); });
      $("plRestore").value = "";
    });
    bind("plSize", function () { page.size = $("plSize").value; markDirty(); paintCanvas(); });
    bind("plOri", function () { page.orientation = $("plOri").value; markDirty(); paintCanvas(); });
    function margin() {
      page.margins = {
        top: Schema.clampMargin($("plMt").value),
        bottom: Schema.clampMargin($("plMb").value),
        left: Schema.clampMargin($("plMl").value),
        right: Schema.clampMargin($("plMr").value)
      };
      markDirty(); paintCanvas();
    }
    ["plMt", "plMb", "plMl", "plMr"].forEach(function (id) { bind(id, margin); });
    bind("plAccent", function () { page.accentColor = $("plAccent").value; if (cfg.theme) cfg.theme.accent = page.accentColor; markDirty(); paintCanvas(); });
    bind("plFs", function () { page.baseFontSize = Number($("plFs").value) || 11; markDirty(); paintCanvas(); });
    bind("plPages", function () { page.pageNumbers = $("plPages").checked; markDirty(); });

    function geom() {
      var blk = selectedBlock(); if (!blk) return;
      blk.x = Number($("plxX").value); blk.y = Number($("plxY").value);
      blk.w = Number($("plxW").value); blk.h = Number($("plxH").value);
      Schema.clampBlock(blk, pageDimsNow());
      markDirty(); paintCanvas();
    }
    ["plxX", "plxY", "plxW", "plxH"].forEach(function (id) { bind(id, geom); });
    bind("plxHead", function () { var blk = selectedBlock(); if (blk) { blk.heading = $("plxHead").value; markDirty(); paintCanvas(); } });
    bind("plxText", function () { var blk = selectedBlock(); if (blk) { blk.text = $("plxText").value; markDirty(); paintCanvas(); } });
    bind("plxField", function () {
      var blk = selectedBlock(); if (!blk) return;
      blk.fieldKey = $("plxField").value;
      var f = Fields.forType(editing.template.document_type).filter(function (x) { return x.key === blk.fieldKey; })[0];
      if (f && (!$("plxHead").value || blk.heading === f.label)) { blk.heading = f.label; if ($("plxHead")) $("plxHead").value = f.label; }
      markDirty(); paintCanvas();
    });
    bind("plxAlign", function () { var blk = selectedBlock(); if (blk) { blk.align = $("plxAlign").value; markDirty(); paintCanvas(); } });
    bind("plxFsBlk", function () { var blk = selectedBlock(); if (blk) { blk.fontSize = Number($("plxFsBlk").value) || null; markDirty(); paintCanvas(); } });
    bind("plxBold", function () { var blk = selectedBlock(); if (blk) { blk.bold = $("plxBold").checked; markDirty(); paintCanvas(); } });
    bind("plxVis", function () { var blk = selectedBlock(); if (blk) { blk.visible = $("plxVis").checked; markDirty(); paintCanvas(); } });
    if ($("plxFront")) $("plxFront").onclick = function () {
      var blk = selectedBlock(); if (!blk) return;
      blk.z = ((editing.config.blocks || []).reduce(function (m, x) { return Math.max(m, x.z || 0); }, 0) + 1);
      markDirty(); pushHist(); paintCanvas();
    };
    if ($("plxBack")) $("plxBack").onclick = function () {
      var blk = selectedBlock(); if (!blk) return;
      blk.z = 0;
      markDirty(); pushHist(); paintCanvas();
    };
    if ($("plxDup")) $("plxDup").onclick = duplicateSelected;
    if ($("plxDel")) $("plxDel").onclick = deleteSelected;

    if ($("plColAdd") && canEdit) {
      $("plColAdd").onclick = function () {
        cfg.table = cfg.table || { columns: [] };
        cfg.table.columns = cfg.table.columns || [];
        cfg.table.columns.push({ key: "description", label: "Column", width: 20, align: "left" });
        markDirty(); paintInspector(); paintCanvas();
      };
    }
    if ($("plCols") && canEdit) {
      $("plCols").onclick = function (e) {
        var del = e.target.closest("[data-cdel]");
        if (del) {
          cfg.table.columns.splice(Number(del.getAttribute("data-cdel")), 1);
          markDirty(); paintInspector(); paintCanvas();
        }
      };
      $("plCols").oninput = function (e) {
        var row = e.target.closest("[data-ci]");
        if (!row) return;
        var i = Number(row.getAttribute("data-ci"));
        var k = e.target.getAttribute("data-ck");
        if (!k || !cfg.table.columns[i]) return;
        cfg.table.columns[i][k] = k === "width" ? Number(e.target.value) || 20 : e.target.value;
        markDirty();
        if (k === "label" || k === "key") paintCanvas();
      };
    }
  }

  function render() {
    if (!canView) {
      pageClass();
      $("pl").innerHTML = '<section class="dash-card"><h2>PDF Layouts</h2><p class="note">You do not have access.</p></section>';
      return;
    }
    if (view === "edit" && editing) renderEditor();
    else { pageClass(); renderList(); }
  }

  $("modal").addEventListener("click", function (e) {
    if (e.target === $("modal") || e.target.closest("[data-close]")) {
      $("modal").hidden = true;
      if (previewMode === "live" && !liveSource) previewMode = "sample";
    }
  });

  var navActive = /[?&]from=hr\b/.test(location.search) ? "HR & Crew" : "Finance";

  window.VeyoraShell.start({
    active: navActive,
    onCompany: function (c, info) {
      company = c;
      canView = !!(info.canAll || info.canFinance || info.canHr || info.isAdmin || info.isPlatform || info.myRole === "owner");
      canEdit = !!(info.canAll || info.isAdmin || info.isPlatform || info.myRole === "owner");
      view = "list";
      editing = null;
      loadCompanyRow().then(loadTemplates).then(seedDefaults).then(render).catch(function (e) {
        $("pl").innerHTML = '<section class="dash-card"><h2>Could not load PDF layouts</h2><p class="note">' + esc(e.message) + '</p></section>';
      });
      if (window.VeyoraTip) window.VeyoraTip("pdf1", [
        "**PDF Layouts** is a drag-and-place canvas. Grab blocks from the left and drop them on the page.",
        "Company name, logo, address and contacts always come from your **company profile** in the database.",
        "Preview and Test PDF use the same layout engine — what you place is what prints."
      ]);
    },
    onNone: function () { $("pl").innerHTML = '<section class="dash-card"><h2>No company</h2><p class="note">Select a company first.</p></section>'; },
    onError: function (err) { $("pl").innerHTML = '<section class="dash-card"><h2>Error</h2><p class="note">' + esc(err.message) + '</p></section>'; }
  });
})();
