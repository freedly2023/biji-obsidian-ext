// Unified date formatting utilities
// Previously in shared.js (MD.formatDate, MD.formatDateShort) and subscription-shared.js (formatRelativeDate)

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(dateStr: string | number): Date | null {
  try {
    const d = new Date(typeof dateStr === 'number' ? dateStr * 1000 : dateStr);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

export function formatDate(dateStr: string | number | null | undefined): string | null {
  if (!dateStr) return null;
  const d = toDate(dateStr);
  if (!d) return String(dateStr);
  return (
    d.getFullYear() + '-' +
    pad2(d.getMonth() + 1) + '-' +
    pad2(d.getDate()) + 'T' +
    pad2(d.getHours()) + ':' +
    pad2(d.getMinutes()) + ':' +
    pad2(d.getSeconds())
  );
}

export function formatDateShort(
  dateStr: string | number | null | undefined,
  fmt?: string,
): string | null {
  if (!dateStr) return null;
  const d = toDate(dateStr);
  if (!d) return null;
  const Y = String(d.getFullYear());
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  if (fmt === 'YYYYMMDD') return Y + M + D;
  if (fmt === 'YYYY/MM/DD') return Y + '/' + M + '/' + D;
  return Y + '-' + M + '-' + D;
}

export function formatRelativeDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    return d.toISOString().substring(0, 10);
  } catch {
    return '';
  }
}
