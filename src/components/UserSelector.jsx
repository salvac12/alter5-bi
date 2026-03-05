import { useState } from 'react';
import { getEmployeeList, setCurrentUser } from '../utils/userConfig';

export default function UserSelector({ onSelect, currentUser }) {
  const employees = getEmployeeList();
  const [adminToggle, setAdminToggle] = useState(false);

  const handleSelect = (emp) => {
    const user = setCurrentUser(emp.id, adminToggle);
    if (user) onSelect(user);
  };

  const initials = (name) => name.split(' ').map(w => w[0]).join('').toUpperCase();

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(10,22,40,0.3)',
        zIndex: 200,
      }} onClick={() => onSelect(null)} />

      {/* Dropdown */}
      <div style={{
        position: 'fixed',
        top: 60,
        right: 16,
        background: '#0F1D2F',
        borderRadius: 12,
        padding: 24,
        minWidth: 320,
        maxWidth: 400,
        border: '1px solid #1B3A5C',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        zIndex: 201,
      }}>
        <h3 style={{
          fontSize: 16, fontWeight: 800, color: '#FFFFFF',
          margin: '0 0 4px 0',
        }}>
          Cambiar usuario
        </h3>
        <p style={{
          fontSize: 12, color: '#6B7F94', margin: '0 0 16px 0',
        }}>
          Selecciona otro perfil
        </p>

        {/* Employee list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {employees.map(emp => (
            <button
              key={emp.id}
              onClick={() => handleSelect(emp)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 8,
                border: currentUser?.id === emp.id ? '2px solid #3B82F6' : '1px solid #1B3A5C',
                background: currentUser?.id === emp.id ? '#132238' : '#0A1628',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#132238'; e.currentTarget.style.borderColor = '#3B82F6'; }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = currentUser?.id === emp.id ? '#132238' : '#0A1628';
                e.currentTarget.style.borderColor = currentUser?.id === emp.id ? '#3B82F6' : '#1B3A5C';
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'linear-gradient(135deg, #3B82F6, #10B981)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#FFFFFF',
                flexShrink: 0,
              }}>
                {initials(emp.name)}
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF' }}>
                  {emp.name}
                </div>
                <div style={{ fontSize: 11, color: '#6B7F94' }}>
                  {emp.companiesCount} empresas
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Admin toggle */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 16, cursor: 'pointer',
          fontSize: 12, color: '#94A3B8',
        }}>
          <input
            type="checkbox"
            checked={adminToggle}
            onChange={(e) => setAdminToggle(e.target.checked)}
            style={{ accentColor: '#3B82F6' }}
          />
          Modo administrador
          <span style={{
            fontSize: 10, color: '#6B7F94',
            marginLeft: 4,
          }}>
            (puede ocultar cualquier empresa)
          </span>
        </label>
      </div>
    </>
  );
}
