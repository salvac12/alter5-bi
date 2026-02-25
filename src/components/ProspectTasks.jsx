import { useState } from 'react';
import { TEAM_MEMBERS, TASK_TEMPLATES } from '../utils/airtableProspects';

/**
 * ProspectTasks — Mini task list with template chips, team dropdown, description.
 *
 * @param {Array} tasks - Array of task objects
 * @param {function} onChange - Called with updated tasks array
 * @param {boolean} disabled - Disable all interactions
 */
export default function ProspectTasks({ tasks = [], onChange, disabled }) {
  const [showDone, setShowDone] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const STATUS_ORDER = ["pendiente", "en_curso", "hecho"];
  const STATUS_CONFIG = {
    pendiente: { label: "Pendiente", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A", dot: "#F59E0B" },
    en_curso:  { label: "En curso",  color: "#3B82F6", bg: "#EFF6FF", border: "#BFDBFE", dot: "#3B82F6" },
    hecho:     { label: "Hecho",     color: "#10B981", bg: "#ECFDF5", border: "#A7F3D0", dot: "#10B981" },
  };

  const NEXT_STATUS = { pendiente: "en_curso", en_curso: "hecho", hecho: "pendiente" };

  const grouped = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s);
    return acc;
  }, {});

  const doneCount = grouped.hecho.length;

  function updateTask(taskId, updates) {
    const updated = tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
    onChange(updated);
  }

  function cycleStatus(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    updateTask(taskId, { status: NEXT_STATUS[task.status] });
  }

  function removeTask(taskId) {
    onChange(tasks.filter(t => t.id !== taskId));
  }

  function addTaskFromTemplate(text) {
    const newTask = {
      id: "task_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text,
      description: "",
      status: "pendiente",
      assignedTo: "",
      dueDate: "",
      createdAt: new Date().toISOString(),
      notifiedAt: "",
    };
    onChange([...tasks, newTask]);
    setShowTemplates(false);
  }

  function addCustomTask() {
    addTaskFromTemplate("");
  }

  function isOverdue(dueDate) {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date(new Date().toDateString());
  }

  function renderTask(task) {
    const cfg = STATUS_CONFIG[task.status];
    return (
      <div
        key={task.id}
        style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "10px 12px", borderRadius: 8,
          background: "#FFFFFF",
          border: `1px solid ${cfg.border}`,
          transition: "all 0.15s",
        }}
      >
        {/* Status dot — click to cycle */}
        <button
          onClick={() => !disabled && cycleStatus(task.id)}
          disabled={disabled}
          title={`Estado: ${cfg.label} (click para cambiar)`}
          style={{
            width: 18, height: 18, minWidth: 18,
            borderRadius: "50%",
            border: `2px solid ${cfg.dot}`,
            background: task.status === "hecho" ? cfg.dot : "transparent",
            cursor: disabled ? "not-allowed" : "pointer",
            marginTop: 2, padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
        >
          {task.status === "hecho" && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        {/* Task content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Text — editable inline */}
          <input
            type="text"
            value={task.text}
            onChange={(e) => updateTask(task.id, { text: e.target.value })}
            placeholder="Titulo de la tarea..."
            disabled={disabled}
            style={{
              width: "100%", border: "none", outline: "none",
              fontSize: 13, fontWeight: 600, color: task.status === "hecho" ? "#94A3B8" : "#1A2B3D",
              textDecoration: task.status === "hecho" ? "line-through" : "none",
              background: "transparent", fontFamily: "inherit",
              padding: 0,
            }}
          />

          {/* Description — textarea */}
          <textarea
            value={task.description || ""}
            onChange={(e) => updateTask(task.id, { description: e.target.value })}
            placeholder="Descripcion adicional..."
            disabled={disabled}
            rows={2}
            style={{
              width: "100%", border: "none", outline: "none",
              fontSize: 12, fontWeight: 400, color: task.status === "hecho" ? "#CBD5E1" : "#6B7F94",
              background: "transparent", fontFamily: "inherit",
              padding: 0, marginTop: 4, resize: "vertical",
              minHeight: 32, lineHeight: 1.4,
            }}
          />

          {/* Metadata row */}
          <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
            {/* Assigned — dropdown */}
            <select
              value={task.assignedTo || ""}
              onChange={(e) => updateTask(task.id, { assignedTo: e.target.value })}
              disabled={disabled}
              style={{
                border: "none", outline: "none",
                fontSize: 11, color: task.assignedTo ? "#1A2B3D" : "#94A3B8",
                fontWeight: 500,
                background: "transparent", fontFamily: "inherit",
                padding: 0, cursor: disabled ? "not-allowed" : "pointer",
                maxWidth: 140,
              }}
            >
              <option value="">Asignar a...</option>
              {TEAM_MEMBERS.map(m => (
                <option key={m.email} value={m.name}>{m.name}</option>
              ))}
            </select>

            {/* Due date */}
            <input
              type="date"
              value={task.dueDate || ""}
              onChange={(e) => updateTask(task.id, { dueDate: e.target.value })}
              disabled={disabled}
              style={{
                border: "none", outline: "none",
                fontSize: 11, fontFamily: "inherit",
                color: isOverdue(task.dueDate) && task.status !== "hecho" ? "#EF4444" : "#6B7F94",
                fontWeight: isOverdue(task.dueDate) && task.status !== "hecho" ? 700 : 500,
                background: "transparent", padding: 0,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            />

            {/* Notified indicator */}
            {task.notifiedAt && (
              <span style={{ fontSize: 10, color: "#10B981", fontWeight: 600, display: "flex", alignItems: "center", gap: 2 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
                </svg>
                Notificado
              </span>
            )}
          </div>
        </div>

        {/* Delete */}
        {!disabled && (
          <button
            onClick={() => removeTask(task.id)}
            title="Eliminar tarea"
            style={{
              background: "transparent", border: "none",
              color: "#CBD5E1", fontSize: 14, cursor: "pointer",
              padding: "0 2px", lineHeight: 1, marginTop: 2,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#CBD5E1"; }}
          >
            {"\u2715"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Pendiente + En curso groups */}
      {["pendiente", "en_curso"].map(status => {
        const items = grouped[status];
        if (items.length === 0) return null;
        const cfg = STATUS_CONFIG[status];
        return (
          <div key={status} style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: cfg.color,
              textTransform: "uppercase", letterSpacing: "0.5px",
              marginBottom: 6, display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: cfg.dot,
              }} />
              {cfg.label} ({items.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map(renderTask)}
            </div>
          </div>
        );
      })}

      {/* Hecho group — collapsed by default */}
      {doneCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setShowDone(!showDone)}
            style={{
              fontSize: 11, fontWeight: 700, color: STATUS_CONFIG.hecho.color,
              textTransform: "uppercase", letterSpacing: "0.5px",
              background: "transparent", border: "none", cursor: "pointer",
              padding: 0, fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
              marginBottom: showDone ? 6 : 0,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: STATUS_CONFIG.hecho.dot,
            }} />
            Hecho ({doneCount})
            <span style={{ fontSize: 10, transform: showDone ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }}>
              {"\u25BC"}
            </span>
          </button>
          {showDone && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {grouped.hecho.map(renderTask)}
            </div>
          )}
        </div>
      )}

      {/* Add task — template chips or button */}
      {!disabled && !showTemplates && (
        <button
          onClick={() => setShowTemplates(true)}
          style={{
            width: "100%", padding: "8px",
            background: "transparent",
            border: "1px dashed #CBD5E1",
            borderRadius: 6, cursor: "pointer",
            fontSize: 12, fontWeight: 600, color: "#94A3B8",
            fontFamily: "inherit", transition: "all 0.15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#8B5CF6";
            e.currentTarget.style.color = "#8B5CF6";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#CBD5E1";
            e.currentTarget.style.color = "#94A3B8";
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
          Anadir tarea
        </button>
      )}

      {/* Template chips */}
      {!disabled && showTemplates && (
        <div style={{
          padding: 10, background: "#F5F3FF",
          borderRadius: 8, border: "1px solid #DDD6FE",
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "#6B21A8",
            textTransform: "uppercase", letterSpacing: "0.5px",
            marginBottom: 8,
          }}>
            Selecciona tipo de tarea
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {TASK_TEMPLATES.map(tpl => (
              <button
                key={tpl}
                onClick={() => addTaskFromTemplate(tpl)}
                style={{
                  padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  color: "#6B21A8", background: "#FFFFFF",
                  border: "1px solid #DDD6FE", borderRadius: 6,
                  cursor: "pointer", fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#8B5CF6";
                  e.currentTarget.style.color = "#FFFFFF";
                  e.currentTarget.style.borderColor = "#8B5CF6";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#FFFFFF";
                  e.currentTarget.style.color = "#6B21A8";
                  e.currentTarget.style.borderColor = "#DDD6FE";
                }}
              >
                {tpl}
              </button>
            ))}
            <button
              onClick={addCustomTask}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 600,
                color: "#6B7F94", background: "#FFFFFF",
                border: "1px dashed #CBD5E1", borderRadius: 6,
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#6B7F94";
                e.currentTarget.style.color = "#1A2B3D";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#CBD5E1";
                e.currentTarget.style.color = "#6B7F94";
              }}
            >
              + Otra
            </button>
          </div>
          <button
            onClick={() => setShowTemplates(false)}
            style={{
              marginTop: 8, padding: "4px 8px",
              fontSize: 11, fontWeight: 500, color: "#94A3B8",
              background: "transparent", border: "none",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Cancelar
          </button>
        </div>
      )}

      {tasks.length === 0 && !showTemplates && (
        <div style={{
          textAlign: "center", padding: "16px 0",
          fontSize: 12, color: "#94A3B8",
        }}>
          Sin tareas. Usa la IA para extraer proximos pasos o anade manualmente.
        </div>
      )}
    </div>
  );
}
