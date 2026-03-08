import React from 'react';

interface GroupOption {
  id: string;
  name: string;
}

interface Props {
  groups: GroupOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const styles = {
  container: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap' as const,
  },
  button: (active: boolean) => ({
    padding: '6px 16px',
    border: `1px solid ${active ? '#e94560' : '#ddd'}`,
    background: active ? '#e94560' : '#fff',
    color: active ? '#fff' : '#333',
    borderRadius: 20,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
  }) as React.CSSProperties,
};

export default function GroupSelector({ groups, selected, onSelect }: Props) {
  return (
    <div style={styles.container}>
      <button style={styles.button(selected === null)} onClick={() => onSelect(null)}>
        All Groups
      </button>
      {groups.map(g => (
        <button key={g.id} style={styles.button(selected === g.id)} onClick={() => onSelect(g.id)}>
          {g.name}
        </button>
      ))}
    </div>
  );
}
