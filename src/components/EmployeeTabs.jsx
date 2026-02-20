import employeesData from '../data/employees.json';

export default function EmployeeTabs({ activeTab, onTabChange, totalCount }) {
  // Crear tabs: Todos + empleados individuales
  const tabs = [
    { id: 'all', name: 'Todos', count: totalCount },
    ...employeesData.map(emp => ({
      id: emp.id,
      name: emp.name.split(' ')[0], // Solo primer nombre (Salvador, Guillermo, Leticia)
      count: emp.companiesCount
    }))
  ];

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: '1px solid #E2E8F0',
      background: '#FFFFFF',
      padding: '0 24px',
    }}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              position: 'relative',
              padding: '12px 24px',
              background: isActive
                ? 'linear-gradient(180deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0.02) 100%)'
                : 'transparent',
              border: 'none',
              borderBottom: isActive ? '3px solid #3B82F6' : '1px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              borderRadius: '8px 8px 0 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              outline: 'none',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = '#F8FAFC';
                e.currentTarget.style.borderBottom = '2px solid #CBD5E1';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderBottom = '1px solid transparent';
              }
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = '2px solid #3B82F6';
              e.currentTarget.style.outlineOffset = '2px';
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = 'none';
            }}
          >
            {/* Nombre del tab */}
            <span style={{
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? '#1E293B' : '#64748B',
              transition: 'color 0.2s ease',
              whiteSpace: 'nowrap',
            }}>
              {tab.name}
            </span>

            {/* Contador */}
            <span style={{
              fontSize: 18,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? '#3B82F6' : '#94A3B8',
              transition: 'color 0.2s ease',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.5px',
            }}>
              {tab.count.toLocaleString('es-ES')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
