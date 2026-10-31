/* PDF Layout Maker — PDF generation via html2pdf (same approach as agreements.js).
   Cursor 2026-10-24: Playwright/Chromium is preferred long-term but not available in current
   Supabase Edge deployment; client html2pdf + shared HTML renderer keeps preview === PDF. */
(function () {
  var CDN = "https://cdn.jsdelivr.net/npm/";
  var LIB = CDN + "html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
  var frameReady = null;

  function Schema() { return window.VeyoraPdfSchema; }
  function Render() { return window.VeyoraPdfRender; }

  function loadLib(win) {
    return new Promise(function (ok, fail) {
      if (win.html2pdf) return ok();
      var s = win.document.createElement("script");
      s.src = LIB;
      s.onload = function () { win.html2pdf ? ok() : fail(new Error("html2pdf failed to load.")); };
      s.onerror = function () { fail(new Error("Could not load the PDF library. Check your connection.")); };
      win.document.head.appendChild(s);
    });
  }

  function pdfFrame() {
    if (!frameReady) {
      frameReady = new Promise(function (ok, fail) {
        var f = document.createElement("iframe");
        f.setAttribute("aria-hidden", "true");
        f.tabIndex = -1;
        f.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:1400px;border:0;visibility:hidden";
        f.onload = function () {
          loadLib(f.contentWindow).then(function () { ok(f); }).catch(fail);
        };
        f.srcdoc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body></body></html>";
        document.body.appendChild(f);
      }).catch(function (e) { frameReady = null; throw e; });
    }
    return frameReady;
  }

  function waitImages(doc) {
    var imgs = [].slice.call(doc.querySelectorAll("img"));
    return Promise.all(imgs.map(function (im) {
      if (im.complete) return null;
      return new Promise(function (r) { im.onload = im.onerror = r; });
    }).filter(Boolean));
  }

  function formatKey(size) {
    if (size === "Letter") return "letter";
    if (size === "A5") return "a5";
    return "a4";
  }

  /**
   * Generate a PDF Blob from template configuration + document data.
   * Uses the same HTML as the on-screen preview.
   */
  function generatePdf(cfg, data) {
    cfg = Schema().ensureCanvas(JSON.parse(JSON.stringify(cfg || {})));
    var errors = Schema().validateConfig(cfg);
    if (errors.length) return Promise.reject(new Error(errors[0]));
    var dims = Schema().pageDims(cfg.page);
    var m = dims.margins;
    var canvas = Schema().isCanvas ? Schema().isCanvas(cfg) : !!(cfg.blocks && cfg.blocks.length);
    var html = Render().renderDocumentHtml(cfg, data);
    return pdfFrame().then(function (f) {
      var doc = f.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
      return waitImages(doc).then(function () {
        var el = doc.querySelector(".vey-doc");
        var set = f.contentWindow.JSON.parse(JSON.stringify({
          margin: canvas ? [0, 0, 0, 0] : [m.top, m.right, m.bottom, m.left],
          image: { type: "jpeg", quality: 0.96 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false },
          jsPDF: {
            unit: "mm",
            format: formatKey(cfg.page.size),
            orientation: cfg.page.orientation === "landscape" ? "landscape" : "portrait"
          },
          pagebreak: { mode: ["css", "legacy"], avoid: [".vey-sign", ".vey-totals .grand", "h1"] }
        }));
        return f.contentWindow.html2pdf().set(set).from(el).toPdf().get("pdf").then(function (pdf) {
          var n = pdf.internal.getNumberOfPages();
          var w = pdf.internal.pageSize.getWidth();
          var h = pdf.internal.pageSize.getHeight();
          var showPages = !canvas && cfg.page.pageNumbers !== false;
          var foot = !canvas && ((cfg.page && cfg.page.footerText) || "");
          if (showPages || foot) {
            for (var i = 1; i <= n; i++) {
              pdf.setPage(i);
              pdf.setFontSize(8);
              pdf.setTextColor(100);
              if (foot) pdf.text(String(foot).slice(0, 80), m.left, h - Math.max(4, m.bottom / 2));
              if (showPages) pdf.text("Page " + i + " of " + n, w - m.right, h - Math.max(4, m.bottom / 2), { align: "right" });
            }
          }
          var ab = pdf.output("arraybuffer");
          doc.body.innerHTML = "";
          return {
            blob: new Blob([ab], { type: "application/pdf" }),
            pageCount: n,
            widthMm: w,
            heightMm: h
          };
        });
      });
    });
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "document.pdf";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  window.VeyoraPdfEngine = {
    generatePdf: generatePdf,
    downloadBlob: downloadBlob
  };
})();
