import { useState } from 'react';
import { colors, font, layout } from '../theme/tokens';

const SUSPECT_LABELS: Record<string, { text: string; color: string }> = {
  personal_domain: { text: 'Personal', color: colors.accent.red },
  low_value: { text: 'Low value', color: colors.accent.yellow },
  no_enrichment: { text: 'Sin enrichment', color: colors.text.muted },
};

export { SUSPECT_LABELS };

export default function CleanupToolbar({
  selectionCount, filteredCount, suspiciousCount,
  onSelectSuspicious, onSelectPage, onClearSelection, onExport, onExit,
  cleanupFilter, onShowAll, onShowSelected,
}: {
  selectionCount: number;
  filteredCount: number;
  suspiciousCount: number;
  onSelectSuspicious: () => void;
  onSelectPage: () => void;
  onClearSelection: () => void;
  onExport: () => void;
  onExit: () => void;
  cleanupFilter: string | null;
  onShowAll: () => void;
  onShowSelected: () => void;
}) {
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div style={{
      margin: "0 20px 8px",
      padding: "12px 16px",
      borderRadius: layout.borderRadius.md,
      background: "linear-gradient(135deg, #FEF2F2, #FFF7ED)",
      border: "1px solid #FECACA",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>
            Modo Limpieza
          </span>
          <span style={{ fontSize: 12, color: colors.text.secondary }}>
            {selectionCount} seleccionadas
            {cleanupFilter
              ? ` · Mostrando ${filteredCount} ${cleanupFilter === 'suspicious' ? 'sospechosas' : 'seleccionadas'}`
              : ` de ${filteredCount} · ${suspiciousCount} sospechosas`}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <ToolbarBtn onClick={onSelectSuspicious} color={colors.accent.red} active={cleanupFilter === 'suspicious'}>
            Solo sospechosas
          </ToolbarBtn>
          {selectionCount > 0 && (
            <ToolbarBtn onClick={onShowSelected} color={colors.accent.yellow} active={cleanupFilter === 'selected'}>
              Solo seleccionadas ({selectionCount})
            </ToolbarBtn>
          )}
          {cleanupFilter && (
            <ToolbarBtn onClick={onShowAll} color={colors.accent.green}>
              Mostrar todas
            </ToolbarBtn>
          )}
          <ToolbarBtn onClick={onSelectPage} color={colors.accent.purple}>Marcar pagina</ToolbarBtn>
          <ToolbarBtn onClick={onClearSelection} color={colors.text.secondary}>Limpiar seleccion</ToolbarBtn>
          <ToolbarBtn onClick={() => { onExport(); setShowInstructions(true); }} color={colors.accent.blue}>
            Exportar blocklist.json
          </ToolbarBtn>
          <ToolbarBtn onClick={onExit} color="#64748B" outline>Salir</ToolbarBtn>
        </div>
      </div>

      {showInstructions && (
        <div style={{
          padding: "10px 14px",
          borderRadius: layout.borderRadius.sm,
          background: "#FFFFFF",
          border: `1px solid ${colors.light.border}`,
          fontSize: 12, color: "#475569", lineHeight: 1.6,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 700, color: colors.text.primary }}>Pasos para aplicar la limpieza:</span>
            <button
              onClick={() => setShowInstructions(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: colors.text.muted, fontSize: 16, fontFamily: font.family }}
            >x</button>
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

function ToolbarBtn({ children, onClick, color, outline, active }: {
  children: React.ReactNode;
  onClick: () => void;
  color: string;
  outline?: boolean;
  active?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px",
      borderRadius: layout.borderRadius.sm,
      border: active ? `2px solid ${color}` : outline ? `1px solid ${color}40` : "none",
      background: active ? color + "25" : outline ? "transparent" : color + "15",
      color: color,
      fontSize: 11, fontWeight: 600,
      cursor: "pointer", fontFamily: font.family, whiteSpace: "nowrap",
    }}>
      {children}
    </button>
  );
}
