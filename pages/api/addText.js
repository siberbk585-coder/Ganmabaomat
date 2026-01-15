import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

/**
 * Backward-compatible endpoint used by n8n.
 *
 * Supports BOTH the old body shape and upgraded options.
 *
 * Old body:
 *  {
 *    pdfBase64: string,
 *    text: string,
 *    x?: number,
 *    y?: number,
 *    pageNumber?: number
 *  }
 *
 * Upgraded options (all optional):
 *  - fontSize?: number
 *  - color?: { r:number, g:number, b:number }   // 0..1
 *  - opacity?: number                          // 0..1
 *  - rotate?: number                           // degrees
 *  - pageNumber: -1                            // apply to all pages
 *  - texts?: Array<{ text:string, x?:number, y?:number, pageNumber?:number, fontSize?:number, color?:{r,g,b}, opacity?:number, rotate?:number }>
 *  - watermark?: { text:string, opacity?:number, rotate?:number, fontSize?:number, color?:{r,g,b} }
 *
 * Returns:
 *  { pdfBase64: string, pageCount: number }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
  }

  try {
    const body = req.body || {};
    const { pdfBase64 } = body;
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return res.status(400).json({ error: 'Thiếu dữ liệu file PDF.' });
    }

    // Decode and load PDF
    const inputBytes = Buffer.from(String(pdfBase64).trim().replace(/^data:application\/pdf;base64,?/i, ''), 'base64');
    const pdfDoc = await PDFDocument.load(inputBytes);
    const pages = pdfDoc.getPages();
    const pageCount = pages.length;
    if (!pageCount) {
      return res.status(400).json({ error: 'PDF không có trang nào.' });
    }

    // Font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Helpers
    const clamp01 = (v, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1, n));
    };

    const toColor = (c) => {
      if (!c || typeof c !== 'object') return rgb(0, 0, 0);
      const r = clamp01(c.r, 0);
      const g = clamp01(c.g, 0);
      const b = clamp01(c.b, 0);
      return rgb(r, g, b);
    };

    const drawOne = (page, cfg) => {
      if (!cfg || !cfg.text) return;
      const x = typeof cfg.x === 'number' ? cfg.x : 50;
      const y = typeof cfg.y === 'number' ? cfg.y : 750;
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

    // 1) Watermark (optional) – always on ALL pages
    if (body.watermark && body.watermark.text) {
      const wm = body.watermark;
      const wmSize = Number.isFinite(Number(wm.fontSize)) ? Number(wm.fontSize) : 48;
      const wmOpacity = clamp01(wm.opacity, 0.15);
      const wmRotate = Number.isFinite(Number(wm.rotate)) ? Number(wm.rotate) : 45;
      const wmColor = toColor(wm.color || { r: 0.5, g: 0.5, b: 0.5 });

      for (const page of pages) {
        const { width, height } = page.getSize();
        // Center watermark
        page.drawText(String(wm.text), {
          x: width / 2 - (String(wm.text).length * wmSize) / 6, // simple centering
          y: height / 2,
          size: wmSize,
          font,
          color: wmColor,
          opacity: wmOpacity,
          rotate: degrees(wmRotate),
        });
      }
    }

    // 2) Multiple text items (preferred)
    if (Array.isArray(body.texts) && body.texts.length) {
      for (const t of body.texts) {
        const pn = Number.isFinite(Number(t.pageNumber)) ? Number(t.pageNumber) : 0;
        if (pn === -1) {
          for (const page of pages) drawOne(page, t);
        } else {
          const safe = Math.max(0, Math.min(pageCount - 1, pn));
          drawOne(pages[safe], t);
        }
      }
    } else {
      // 3) Old single text mode (backward compatible)
      const { text } = body;
      if (!text) {
        // In upgraded flows, user might only want watermark.
        if (!body.watermark || !body.watermark.text) {
          return res.status(400).json({ error: 'Thiếu nội dung chữ.' });
        }
      } else {
        const pn = Number.isFinite(Number(body.pageNumber)) ? Number(body.pageNumber) : 0;
        const cfg = {
          text,
          x: body.x,
          y: body.y,
          pageNumber: pn,
          fontSize: body.fontSize,
          color: body.color,
          opacity: body.opacity,
          rotate: body.rotate,
        };
        if (pn === -1) {
          for (const page of pages) drawOne(page, cfg);
        } else {
          const safe = Math.max(0, Math.min(pageCount - 1, pn));
          drawOne(pages[safe], cfg);
        }
      }
    }

    const outBytes = await pdfDoc.save();
    const outBase64 = Buffer.from(outBytes).toString('base64');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ pdfBase64: outBase64, pageCount });
  } catch (err) {
    console.error('Error processing PDF:', err);
    return res.status(500).json({ error: 'Không thể xử lý PDF.' });
  }
}
