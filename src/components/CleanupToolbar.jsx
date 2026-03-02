import { useState } from 'react';

const SUSPECT_LABELS = {
  personal_domain: { text: 'Personal', color: '#EF4444' },
  low_value: { text: 'Low value', color: '#F59E0B' },
  no_enrichment: { text: 'Sin enrichment', color: '#94A3B8' },
};

export { SUSPECT_LABELS };

export default function CleanupToolbar({
  selectionCount,
  filteredCount,
  suspiciousCount,
  onSelectSuspicious,
  onSelectPage,
  onClearSelection,
  onExport,
  onExit,
}) {
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div style={{
      margin: "0 20px 8px",
      padding: "12px 16px",
      borderRadius: 10,
      background: "linear-gradient(135deg, #FEF2F2, #FFF7ED)",
      border: "1px solid #FECACA",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>&#128465;</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>
            Modo Limpieza
          </span>
          <span style={{ fontSize: 12, color: "#6B7F94" }}>
            {selectionCount} seleccionadas de {filteredCount} filtradas
            ({suspiciousCount} sospechosas)
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <ToolbarBtn onClick={onSelectSuspicious} color="#EF4444">
            Seleccionar sospechosas
          </ToolbarBtn>
          <ToolbarBtn onClick={onSelectPage} color="#F59E0B">
            Seleccionar pagina
          </ToolbarBtn>
          <ToolbarBtn onClick={onClearSelection} color="#6B7F94">
            Limpiar seleccion
          </ToolbarBtn>
          <ToolbarBtn onClick={() => { onExport(); setShowInstructions(true); }} color="#3B82F6">
            Exportar blocklist.json
          </ToolbarBtn>
          <ToolbarBtn onClick={onExit} color="#64748B" outline>
            Salir
          </ToolbarBtn>
        </div>
      </div>

      {/* Collapsible instructions */}
      {showInstructions && (
        <div style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          fontSize: 12,
          color: "#475569",
          lineHeight: 1.6,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 700, color: "#1A2B3D" }}>Pasos para aplicar la limpieza:</span>
            <button
              onClick={() => setShowInstructions(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", fontSize: 16 }}
            >
              x
            </button>
          </div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>Reemplaza <code>src/data/blocklist.json</code> con el fichero descargado</li>
            <li>Ejecuta: <code>python scripts/cleanup_companies.py --dry-run</code> (previa)</li>
            <li>Ejecuta: <code>python scripts/cleanup_companies.py</code> (aplicar)</li>
            <li>Commit: <code>git add . && git commit -m "data: limpieza empresas irrelevantes"</code></li>
          </ol>
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({ children, onClick, color, outline }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 6,
        border: outline ? `1px solid ${color}40` : "none",
        background: outline ? "transparent" : color + "15",
        color: color,
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}
