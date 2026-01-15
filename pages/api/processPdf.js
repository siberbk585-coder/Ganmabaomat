import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * Upgraded endpoint: accepts pdfBase64 OR pdfUrl.
 *
 * Body (recommended):
 * {
 *   pdfBase64?: string,
 *   pdfUrl?: string,
 *   texts?: Array<{
 *     text: string,
 *     x?: number,
 *     y?: number,
 *     pageNumber?: number | -1,   // -1 = all pages
 *     fontSize?: number,
 *     color?: { r:number, g:number, b:number }, // 0..1
 *     opacity?: number,           // 0..1
 *     rotate?: number             // degrees
 *   }>,
 *   watermark?: {
 *     text: string,
 *     applyToAll?: boolean,       // default true
 *     fontSize?: number,          // default 48
 *     opacity?: number,           // default 0.15
 *     rotate?: number,            // default 45
 *     color?: { r:number, g:number, b:number }, // default gray
 *     position?: "center"|"top-left"|"top-right"|"bottom-left"|"bottom-right"
 *   }
 * }
 *
 * Returns:
 *  { pdfBase64: string, pageCount: number }
 */

function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toColor(c, fallback = { r: 0, g: 0, b: 0 }) {
  const src = c && typeof c === "object" ? c : fallback;
  return rgb(clamp01(src.r, fallback.r), clamp01(src.g, fallback.g), clamp01(src.b, fallback.b));
}

async function fetchPdfBytesFromUrl(url) {
  // Note: Vercel runtime supports fetch
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`Không tải được PDF từ pdfUrl. HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!buf.length) throw new Error("Nội dung tải về rỗng");
  return buf;
}

function decodePdfBase64(b64) {
  const clean = String(b64).trim().replace(/^data:application\/pdf;base64,?/i, "");
  const buf = Buffer.from(clean, "base64");
  if (!buf.length) throw new Error("pdfBase64 không hợp lệ (decode ra buffer rỗng)");
  return buf;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Chỉ chấp nhận phương thức POST" });
  }

  try {
    const body = req.body || {};

    // 1) Load input PDF bytes from pdfBase64 OR pdfUrl
    let inputBytes;

    if (body.pdfBase64 && typeof body.pdfBase64 === "string") {
      inputBytes = decodePdfBase64(body.pdfBase64);
    } else if (body.pdfUrl && typeof body.pdfUrl === "string") {
      inputBytes = await fetchPdfBytesFromUrl(body.pdfUrl);
    } else {
      return res.status(400).json({ error: "Thiếu dữ liệu file PDF. Cần pdfBase64 hoặc pdfUrl." });
    }

    // 2) Parse PDF
    const pdfDoc = await PDFDocument.load(inputBytes);
    const pages = pdfDoc.getPages();
    const pageCount = pages.length;
    if (!pageCount) return res.status(400).json({ error: "PDF không có trang nào." });

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // 3) Helper: draw one text config
    const drawTextCfg = (page, cfg) => {
      if (!cfg || !cfg.text) return;

      const x = Number.isFinite(Number(cfg.x)) ? Number(cfg.x) : 50;
      const y = Number.isFinite(Number(cfg.y)) ? Number(cfg.y) : 750;
      const size = Number.isFinite(Number(cfg.fontSize)) ? Number(cfg.fontSize) : 12;
      const opacity = clamp01(cfg.opacity, 1);
      const rotateDeg = Number.isFinite(Number(cfg.rotate)) ? Number(cfg.rotate) : 0;

      page.drawText(String(cfg.text), {
        x,
        y,
        size,
        font,
        color: toColor(cfg.color),
        opacity,
        rotate: rotateDeg ? degrees(rotateDeg) : undefined,
      });
    };

    // 4) Watermark (optional)
    if (body.watermark && body.watermark.text) {
      const wm = body.watermark;
      const applyAll = wm.applyToAll !== false; // default true
      const wmSize = Number.isFinite(Number(wm.fontSize)) ? Number(wm.fontSize) : 48;
      const wmOpacity = clamp01(wm.opacity, 0.15);
      const wmRotate = Number.isFinite(Number(wm.rotate)) ? Number(wm.rotate) : 45;
      const wmColor = toColor(wm.color, { r: 0.5, g: 0.5, b: 0.5 });
      const pos = wm.position || "center";

      const drawWm = (page) => {
        const { width, height } = page.getSize();
        const pad = 24;

        let x = width ;
        let y = height / 2;

        if (pos === "top-left") {
          x = pad;
          y = height - pad;
        } else if (pos === "top-right") {
          x = width - pad;
          y = height - pad;
        } else if (pos === "bottom-left") {
          x = pad;
          y = pad;
        } else if (pos === "bottom-right") {
          x = width - pad;
          y = pad;
        }

        // Rough center shift
        const textStr = String(wm.text);
        const shift = (textStr.length * wmSize) / 6;
        const finalX = pos === "center" ? x - shift : x;

        page.drawText(textStr, {
          x: finalX,
          y,
          size: wmSize,
          font,
          color: wmColor,
          opacity: wmOpacity,
          rotate: degrees(wmRotate),
        });
      };

      if (applyAll) pages.forEach(drawWm);
      else drawWm(pages[0]);
    }

    // 5) Text overlays (optional) - supports many, supports pageNumber = -1
    if (Array.isArray(body.texts)) {
      for (const t of body.texts) {
        const pn = Number.isFinite(Number(t.pageNumber)) ? Number(t.pageNumber) : 0;

        if (pn === -1) {
          pages.forEach((p) => drawTextCfg(p, t));
        } else {
          const safe = Math.max(0, Math.min(pageCount - 1, pn));
          drawTextCfg(pages[safe], t);
        }
      }
    } else if (typeof body.text === "string" && body.text.trim() !== "") {
      // Backward-compatible single text mode
      const pn = Number.isFinite(Number(body.pageNumber)) ? Number(body.pageNumber) : 0;
      const cfg = {
        text: body.text,
        x: body.x,
        y: body.y,
        pageNumber: pn,
        fontSize: body.fontSize,
        color: body.color,
        opacity: body.opacity,
        rotate: body.rotate,
      };

      if (pn === -1) pages.forEach((p) => drawTextCfg(p, cfg));
      else {
        const safe = Math.max(0, Math.min(pageCount - 1, pn));
        drawTextCfg(pages[safe], cfg);
      }
    } else {
      // Allow watermark-only; otherwise complain
      if (!body.watermark || !body.watermark.text) {
        return res.status(400).json({ error: "Thiếu nội dung chữ (texts/text) hoặc watermark." });
      }
    }

    // 6) Save
    const outBytes = await pdfDoc.save();
    const outBase64 = Buffer.from(outBytes).toString("base64");

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ pdfBase64: outBase64, pageCount });
  } catch (err) {
    console.error("Error processing PDF:", err);
    return res.status(500).json({ error: err?.message || "Không thể xử lý PDF." });
  }
}
