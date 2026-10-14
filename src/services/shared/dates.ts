/**
 * Date formatting helpers (German locale)
 */

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
  return formatDate(timestamp);
}

export function parseCronDescription(spec: string): string {
  // Simple cron description
  const parts = spec.split(' ');
  if (parts.length !== 5) return spec;
  const [min, hour, dom, mon, dow] = parts;

  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'Jede Minute';
  }
  if (min !== '*' && hour === '*') {
    return `Stündlich (Minute ${min})`;
  }
  if (min !== '*' && hour !== '*' && dom === '*') {
    return `Täglich um ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dow !== '*') {
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    return `${days[parseInt(dow)] || dow} um ${hour}:${min}`;
  }
  return spec;
}
