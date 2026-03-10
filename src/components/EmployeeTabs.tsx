import employeesData from '../data/employees.json';
import { colors, font, layout, spacing } from '../theme/tokens';

export default function EmployeeTabs({ activeTab, onTabChange, totalCount }: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  totalCount: number;
}) {
  const tabs = [
    { id: 'all', name: 'Todos', count: totalCount },
    ...employeesData.map((emp: any) => ({
      id: emp.id,
      name: emp.name.split(' ')[0],
      count: emp.companiesCount,
    })),
  ];

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: `1px solid ${colors.light.border}`,
      background: '#FFFFFF',
      padding: `0 ${spacing.xl}`,
    }}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              position: 'relative',
              padding: `${spacing.md} ${spacing['2xl']}`,
              background: isActive
                ? `linear-gradient(180deg, ${colors.accent.blue}08 0%, ${colors.accent.blue}03 100%)`
                : 'transparent',
              border: 'none',
              borderBottom: isActive ? `3px solid ${colors.accent.blue}` : '1px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              borderRadius: '8px 8px 0 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              outline: 'none',
              fontFamily: font.family,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = colors.light.hover;
                e.currentTarget.style.borderBottom = `2px solid ${colors.light.border}`;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderBottom = '1px solid transparent';
              }
            }}
          >
            <span style={{
              fontSize: font.size.md,
              fontWeight: isActive ? font.weight.semibold : font.weight.medium,
              color: isActive ? colors.text.primary : colors.text.secondary,
              transition: 'color 0.2s ease',
              whiteSpace: 'nowrap',
            }}>
              {tab.name}
            </span>
            <span style={{
              fontSize: font.size.xl,
              fontWeight: isActive ? font.weight.bold : font.weight.medium,
              color: isActive ? colors.accent.blue : colors.text.muted,
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
