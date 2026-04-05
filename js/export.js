// ============================================================
// EXPORT — CSV & PDF report generation
// ============================================================

import { BACKEND_HTTP } from "./config.js";
import { state } from "./state.js";

export function exportCSV() {
  return (async () => {
    try {
      const now = new Date();
      const from = new Date(now - 3600000);
      const res = await fetch(
        `${BACKEND_HTTP}/api/export?from=${from.toISOString()}&to=${now.toISOString()}&format=csv`,
      );
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      download(blob, `KTZ_Telemetry_${Date.now()}.csv`);
    } catch {
      // Fallback: local data
      let csv = "Время,Скорость (км/ч),Температура ТЭД (°C)\n";
      for (let i = 0; i < state.fullTime.length; i++) {
        csv += `${state.fullTime[i]},${state.fullSpeed[i]},${state.fullTemp[i]}\n`;
      }
      const blob = new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8;",
      });
      download(blob, `KTZ_Telemetry_local_${Date.now()}.csv`);
    }
  })();
}

export function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.setTextColor(0, 163, 224);
  doc.text("KTZ Loco-Twin — Телеметрический отчёт", 14, 22);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Дата: ${new Date().toLocaleString()}`, 14, 30);

  if (state.lastFrame) {
    doc.text(
      `Локомотив: ${state.lastFrame.locomotive_id} (${state.lastFrame.locomotive_type})`,
      14,
      36,
    );
    doc.text(
      `Индекс здоровья: ${state.lastFrame.health_index} (${state.lastFrame.health_category})`,
      14,
      42,
    );
  }

  const body = state.fullTime.map((t, i) => {
    const tmp = state.fullTemp[i];
    const s = tmp >= 180 ? "CRITICAL" : tmp >= 155 ? "WARNING" : "NORMAL";
    return [t, state.fullSpeed[i], tmp, s];
  });

  doc.autoTable({
    startY: 50,
    head: [["Время", "Скорость (км/ч)", "Темп. ТЭД (°C)", "Статус"]],
    body,
    theme: "grid",
    headStyles: { fillColor: [0, 163, 224] },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 3) {
        if (data.cell.raw === "CRITICAL") {
          data.cell.styles.textColor = [239, 68, 68];
          data.cell.styles.fontStyle = "bold";
        } else if (data.cell.raw === "WARNING") {
          data.cell.styles.textColor = [234, 179, 8];
        }
      }
    },
  });

  doc.save(`KTZ_Report_${Date.now()}.pdf`);
}

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
