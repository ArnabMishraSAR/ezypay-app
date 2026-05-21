export const colors = {
  bg:        '#0a0a0f',
  surface:   '#13131a',
  surface2:  '#1a1a24',
  border:    '#23232f',
  text:      '#f8fafc',
  muted:     '#9ca3af',
  faint:     '#64748b',

  violet:    '#7c3aed',
  violetSub: '#4338ca',
  violetSoft:'#1e1b4b',
  indigo:    '#4f46e5',

  green:     '#22c55e',
  greenSoft: '#052e16',
  red:       '#ef4444',
  redSoft:   '#450a0a',
  amber:     '#f59e0b',
  amberSoft: '#451a03',
  cyan:      '#06b6d4',
  cyanSoft:  '#083344',
  blue:      '#3b82f6',
  pink:      '#ec4899',
};

export const providerStyle = (p) => {
  const k = String(p || '').toLowerCase();
  if (k === 'nagad')  return { bg: '#1e3a8a', fg: '#bfdbfe', label: 'NAGAD'  };
  if (k === 'bkash')  return { bg: '#831843', fg: '#fbcfe8', label: 'BKASH'  };
  if (k === 'rocket') return { bg: '#581c87', fg: '#e9d5ff', label: 'ROCKET' };
  return { bg: '#1f2937', fg: '#e5e7eb', label: (p || 'OTHER').toUpperCase() };
};

export const greetingFor = (d = new Date()) => {
  const h = d.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

export const longDate = (d = new Date()) =>
  d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
