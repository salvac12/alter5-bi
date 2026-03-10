import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getEmployeeList, setCurrentUser } from '../utils/userConfig';
import { colors, font, layout, transitions } from '../theme/tokens';

export default function UserSelector({ onSelect, currentUser }: {
  onSelect: (user: any) => void;
  currentUser: any;
}) {
  const employees = getEmployeeList();
  const [adminToggle, setAdminToggle] = useState(false);

  const handleSelect = (emp: any) => {
    const user = setCurrentUser(emp.id, adminToggle);
    if (user) onSelect(user);
  };

  const initials = (name: string) => name.split(' ').map((w: string) => w[0]).join('').toUpperCase();

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(10,22,40,0.5)',
          backdropFilter: 'blur(4px)',
          zIndex: 200,
        }}
        onClick={() => onSelect(null)}
      />

      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'fixed',
          top: 68,
          right: 16,
          background: colors.dark.bg,
          borderRadius: layout.borderRadius.lg,
          padding: 24,
          minWidth: 320,
          maxWidth: 400,
          border: `1px solid ${colors.dark.border}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          zIndex: 201,
        }}
      >
        <h3 style={{
          fontSize: font.size.lg, fontWeight: font.weight.bold, color: '#FFFFFF',
          margin: '0 0 4px 0',
        }}>
          Cambiar usuario
        </h3>
        <p style={{
          fontSize: font.size.sm, color: colors.text.onDarkMuted, margin: '0 0 16px 0',
        }}>
          Selecciona otro perfil
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {employees.map((emp: any) => (
            <button
              key={emp.id}
              onClick={() => handleSelect(emp)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: layout.borderRadius.sm,
                border: currentUser?.id === emp.id ? `2px solid ${colors.accent.blue}` : `1px solid ${colors.dark.border}`,
                background: currentUser?.id === emp.id ? colors.dark.card : colors.dark.bg,
                cursor: 'pointer', fontFamily: font.family,
                transition: transitions.fast,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.dark.card; e.currentTarget.style.borderColor = colors.accent.blue; }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = currentUser?.id === emp.id ? colors.dark.card : colors.dark.bg;
                e.currentTarget.style.borderColor = currentUser?.id === emp.id ? colors.accent.blue : colors.dark.border;
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: `linear-gradient(135deg, ${colors.accent.blue}, ${colors.accent.green})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: font.weight.bold, color: '#FFFFFF',
                flexShrink: 0,
              }}>
                {initials(emp.name)}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: font.size.md, fontWeight: font.weight.bold, color: '#FFFFFF' }}>
                  {emp.name}
                </div>
                <div style={{ fontSize: font.size.xs, color: colors.text.onDarkMuted }}>
                  {emp.companiesCount} empresas
                </div>
              </div>
            </button>
          ))}
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 16, cursor: 'pointer',
          fontSize: font.size.sm, color: colors.text.onDarkSecondary,
        }}>
          <input
            type="checkbox"
            checked={adminToggle}
            onChange={(e) => setAdminToggle(e.target.checked)}
            style={{ accentColor: colors.accent.blue }}
          />
          Modo administrador
          <span style={{ fontSize: 10, color: colors.text.onDarkMuted, marginLeft: 4 }}>
            (puede ocultar cualquier empresa)
          </span>
        </label>
      </motion.div>
    </>
  );
}
