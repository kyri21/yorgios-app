interface EmptyStateProps {
  icon?: string
  title: string
  subtitle?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon = '📭', title, subtitle, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
      gap: 12,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, lineHeight: 1 }}>{icon}</div>
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{title}</p>
      {subtitle && (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, maxWidth: 260 }}>{subtitle}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8,
            padding: '8px 20px',
            borderRadius: 20,
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
