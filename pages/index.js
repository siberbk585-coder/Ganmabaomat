import { useState } from "react";

export default function Home() {
  const [pdfBase64, setPdfBase64] = useState("");
  const [text, setText] = useState("CONFIDENTIAL");
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [pageNumber, setPageNumber] = useState(-1); // -1 = all pages
  const [fontSize, setFontSize] = useState(12);
  const [loading, setLoading] = useState(false);
  const [resultBase64, setResultBase64] = useState("");

  async function handleProcess() {
    setLoading(true);
    setResultBase64("");

    // ✅ TÍNH TOÁN Ở NGOÀI object fetch (sửa lỗi syntax)
    const pnInput = parseInt(pageNumber, 10);
    const pn = Number.isFinite(pnInput) ? pnInput : -1;

    try {
      const res = await fetch("/api/processPdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdfBase64,
          texts: [
            {
              text,
              x: Number(x),
              y: Number(y),
              pageNumber: pn, // -1 = all pages
              fontSize: Number(fontSize),
            },
          ],
          watermark: {
            text: "CONFIDENTIAL",
            applyToAll: true,
            opacity: 0.15,
            rotate: 45,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");

      // API trả về { pdfBase64: "..." }
      setResultBase64(data.pdfBase64 || "");
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "Arial" }}>
      <h2>PDF Overlay (Text + Watermark)</h2>

      <p>Dán pdfBase64 vào đây (hoặc dùng n8n gọi API trực tiếp).</p>

      <textarea
        value={pdfBase64}
        onChange={(e) => setPdfBase64(e.target.value)}
        rows={8}
        style={{ width: "100%" }}
        placeholder="pdfBase64..."
      />

      <div style={{ marginTop: 12 }}>
        <label>Text: </label>
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <div style={{ marginTop: 8 }}>
        <label>X: </label>
        <input type="number" value={x} onChange={(e) => setX(e.target.value)} />
        <label style={{ marginLeft: 12 }}>Y: </label>
        <input type="number" value={y} onChange={(e) => setY(e.target.value)} />
        <label style={{ marginLeft: 12 }}>Font size: </label>
        <input
          type="number"
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
        />
        <label style={{ marginLeft: 12 }}>Page (-1 = all): </label>
        <input
          type="number"
          value={pageNumber}
          onChange={(e) => setPageNumber(e.target.value)}
        />
      </div>

      <button
        onClick={handleProcess}
        disabled={loading || !pdfBase64}
        style={{ marginTop: 12 }}
      >
        {loading ? "Processing..." : "Process PDF"}
      </button>

      {resultBase64 ? (
        <div style={{ marginTop: 16 }}>
          <p>✅ Done. (Kết quả là pdfBase64, bạn dùng n8n để convert ra file)</p>
          <textarea value={resultBase64} readOnly rows={6} style={{ width: "100%" }} />
        </div>
      ) : null}
    </div>
  );
}
