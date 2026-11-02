// Stroke icons of the mockups, as one SVG path each: <Icon d={ICONS.bell} size={18} />.
export const ICONS = {
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  lock: 'M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  calendar: 'M7 5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM5 10h14M9 3v4M15 3v4',
  dashboard: 'M3 13h4v7H3zM10 4h4v16h-4zM17 9h4v11h-4z',
  spaces: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 11h18M11 4v16',
  device: 'M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0z',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M18 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM12 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  profile: 'M15.6 8a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 0 1 7.2 0zM5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4',
  notFound: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4M9 9l4 4M13 9l-4 4',
  forbidden: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3M12 15v2',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01M14 8h3M14 16h3',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  offline: 'M2 8.5a15 15 0 0120 0M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0M12 19h.01M3 3l18 18',
}

export function Icon({ d, size = 16, strokeWidth = 1.7, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={d} />
    </svg>
  )
}
