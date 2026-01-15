import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

/**
 * Upgraded endpoint: add multiple texts + watermark on all pages in ONE request.
 *
 * Body:
 * {
 *   pdfBase64: string,
 *   texts?: Array<{ text:string, x:number, y:number, pageNumber?:number|-1, fontSize?:number, color?:{r,g,b}, opacity?:number, rotate?:number }>,
 *   watermark?: { text:string, applyToAll?:boolean, fontSize?:number, opacity?:number, rotate?:number, color?:{r,g,b}, position?:'center'|'top-left'|'top-right'|'bottom-left'|'bottom-right' },
 * }
 *
 * Notes:
 * - pageNumber: -1 means "all pages".
 * - watermark defaults to all pages.
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

    const inputBytes = Buffer.from(String(pdfBase64).trim().replace(/^data:application\/pdf;base64,?/i, ''), 'base64');
    const pdfDoc = await PDFDocument.load(inputBytes);
    const pages = pdfDoc.getPages();
    const pageCount = pages.length;
    if (!pageCount) return res.status(400).json({ error: 'PDF không có trang nào.' });

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const clamp01 = (v, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(1, n));
    };

    const toColor = (c, fallback = { r: 0, g: 0, b: 0 }) => {
      const src = c && typeof c === 'object' ? c : fallback;
      return rgb(clamp01(src.r, fallback.r), clamp01(src.g, fallback.g), clamp01(src.b, fallback.b));
    };

    const drawTextCfg = (page, cfg) => {
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

    // A) watermark
    if (body.watermark && body.watermark.text) {
      const wm = body.watermark;
      const applyAll = wm.applyToAll !== false; // default true
      const wmSize = Number.isFinite(Number(wm.fontSize)) ? Number(wm.fontSize) : 48;
      const wmOpacity = clamp01(wm.opacity, 0.15);
      const wmRotate = Number.isFinite(Number(wm.rotate)) ? Number(wm.rotate) : 45;
      const wmColor = toColor(wm.color, { r: 0.5, g: 0.5, b: 0.5 });
      const pos = wm.position || 'center';

      const drawWm = (page) => {
        const { width, height } = page.getSize();
        let x = width / 2;
        let y = height / 2;
        const pad = 24;

        if (pos === 'top-left') {
          x = pad;
          y = height - pad;
        } else if (pos === 'top-right') {
          x = width - pad;
          y = height - pad;
        } else if (pos === 'bottom-left') {
          x = pad;
          y = pad;
        } else if (pos === 'bottom-right') {
          x = width - pad;
          y = pad;
        }

        // If centered, rough centering by shifting half text width
        const textStr = String(wm.text);
        const shift = (textStr.length * wmSize) / 6;
        const finalX = pos === 'center' ? x - shift : x;

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

      if (applyAll) {
        pages.forEach(drawWm);
      } else {
        drawWm(pages[0]);
      }
    }

    // B) texts
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
