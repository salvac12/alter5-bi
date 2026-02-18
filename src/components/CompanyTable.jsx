import { Badge, StatusBadge } from './UI';

const COLUMNS = [
  { key: "score", label: "Score", w: 64 },
  { key: "name", label: "Empresa", w: 200 },
  { key: null, label: "Sector", w: 150 },
  { key: null, label: "Tipo", w: 120 },
  { key: null, label: "Estado", w: 80 },
  { key: "interactions", label: "Emails", w: 80 },
  { key: "nContacts", label: "Contactos", w: 76 },
  { key: null, label: "Último", w: 86 },
];

export default function CompanyTable({
  companies, sortBy, sortDir, onSort, onSelect, selected,
  page, totalPages, setPage,
}) {
  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <span style={{ color: "#E2E8F0", fontSize: 9 }}>⇅</span>;
    return <span style={{ color: "#3B82F6", fontSize: 9 }}>{sortDir === "desc" ? "▼" : "▲"}</span>;
  };

  return (
    <div style={{ padding: "0 20px 20px", overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {COLUMNS.map((col, i) => (
              <th key={i}
                onClick={col.key ? () => onSort(col.key) : undefined}
                style={{
                  padding: "10px 10px", textAlign: "left",
                  fontSize: 10, textTransform: "uppercase", letterSpacing: "2.5px",
                  color: "#6B7F94", fontWeight: 700,
                  cursor: col.key ? "pointer" : "default", width: col.w,
                  whiteSpace: "nowrap", userSelect: "none",
                  borderBottom: "2px solid #E2E8F0",
                }}
              >
                {col.label} {col.key && <SortIcon col={col.key} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {companies.map((c, i) => (
            <tr key={c.idx}
              onClick={() => onSelect(c)}
              className="row-hover fade-in"
              style={{
                cursor: "pointer",
                background: selected?.idx === c.idx ? "#F7F9FC" : "#FFFFFF",
                animationDelay: `${i * 12}ms`,
                borderBottom: "1px solid #F1F5F9",
              }}
            >
              {/* Score */}
              <td style={{ padding: "10px" }}>
                <ScoreChip score={c.score} />
              </td>

              {/* Company */}
              <td style={{ padding: "10px" }}>
                <div style={{ fontWeight: 600, color: "#1A2B3D", fontSize: 13, lineHeight: 1.3 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "#6B7F94", fontWeight: 400 }}>{c.domain}</div>
              </td>

              {/* Sector */}
              <td style={{ padding: "10px" }}>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {c.sectors.split(", ").slice(0, 2).map((s, j) => (
                    <Badge key={j} variant="sector">{s}</Badge>
                  ))}
                </div>
              </td>

              {/* Type */}
              <td style={{ padding: "10px" }}>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {c.relType.split(", ").slice(0, 1).map((t, j) => (
                    <Badge key={j} variant="type">{t}</Badge>
                  ))}
                </div>
              </td>

              {/* Status */}
              <td style={{ padding: "10px" }}><StatusBadge status={c.status} /></td>

              {/* Interactions */}
              <td style={{ padding: "10px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#1A2B3D" }}>
                {c.interactions.toLocaleString()}
              </td>

              {/* Contacts */}
              <td style={{ padding: "10px", fontVariantNumeric: "tabular-nums", color: "#6B7F94" }}>
                {c.nContacts}
              </td>

              {/* Last date */}
              <td style={{ padding: "10px", fontSize: 12, color: "#6B7F94", fontVariantNumeric: "tabular-nums" }}>
                {c.lastDate}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 16 }}>
          <PageBtn onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            ← Anterior
          </PageBtn>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(0, Math.min(totalPages - 5, page - 2)) + i;
            if (p >= totalPages) return null;
            return <PageBtn key={p} onClick={() => setPage(p)} active={p === page}>{p + 1}</PageBtn>;
          })}
          <PageBtn onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
            Siguiente →
          </PageBtn>
        </div>
      )}
    </div>
  );
}

/* ── Score chip with gradient ── */
function ScoreChip({ score }) {
  const isHigh = score > 65;
  const isMid = score > 35;
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 8, display: "flex",
      alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: 12, letterSpacing: "-0.5px",
      color: isHigh ? "#FFFFFF" : isMid ? "#FFFFFF" : "#6B7F94",
      background: isHigh
        ? "linear-gradient(135deg, #3B82F6, #10B981)"
        : isMid
          ? "#3B82F6"
          : "#F1F5F9",
    }}>
      {score}
    </div>
  );
}

/* ── Page button ── */
function PageBtn({ children, onClick, disabled, active }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "6px 12px", borderRadius: 6, fontSize: 12, fontFamily: "inherit",
      cursor: disabled ? "default" : "pointer", minWidth: 32,
      fontWeight: active ? 700 : 500,
      border: "1px solid " + (active ? "#3B82F6" : "#E2E8F0"),
      background: active ? "#EFF6FF" : "#FFFFFF",
      color: disabled ? "#E2E8F0" : active ? "#3B82F6" : "#6B7F94",
    }}>
      {children}
    </button>
  );
}
