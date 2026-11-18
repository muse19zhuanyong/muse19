// 时间处理：北京时间（Asia/Shanghai，UTC+8，无夏令时）
// 提醒时间解析 + cron 五段式匹配

export interface ShanghaiParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

/** 取指定时刻的北京时间各字段 */
export function shanghaiParts(d: Date = new Date()): ShanghaiParts {
  const s = new Date(d.getTime() + 8 * 3600_000);
  return {
    y: s.getUTCFullYear(),
    mo: s.getUTCMonth() + 1,
    d: s.getUTCDate(),
    h: s.getUTCHours(),
    mi: s.getUTCMinutes(),
  };
}

/** 北京时间 → ISO（UTC） */
export function shanghaiISO(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): string {
  return new Date(Date.UTC(y, mo - 1, d, h - 8, mi, 0)).toISOString();
}

function validHM(h: number, mi: number): boolean {
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

/** 解析"9点"/"9点半"/"9:30" → [时,分] */
function parseHM(e: string): [number, number] | null {
  let m = e.match(/(\d{1,2})点半/);
  if (m) {
    const h = parseInt(m[1]);
    return validHM(h, 30) ? [h, 30] : null;
  }
  m = e.match(/(\d{1,2})[点:：]\s*(\d{1,2})?/);
  if (m) {
    const h = parseInt(m[1]);
    const mi = m[2] !== undefined ? parseInt(m[2]) : 0;
    return validHM(h, mi) ? [h, mi] : null;
  }
  return null;
}

function shiftDays(p: ShanghaiParts, days: number): ShanghaiParts {
  const t = new Date(Date.UTC(p.y, p.mo - 1, p.d) + days * 86400000);
  return {
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: p.h,
    mi: p.mi,
  };
}

/**
 * 解析提醒时间表达式 → ISO 时间字符串；解析失败返回 null
 * 支持：今天/明天/后天 H点、每天H点（转为最近的未来时间）、M月D日 H点、纯 H点（今天，已过则明天）
 */
export function parseRemindTime(expr: string): string | null {
  const e = expr.trim();
  const now = shanghaiParts();

  // 每天H点 → 最近的未来时间
  let m = e.match(/^每天\s*(.+)$/);
  if (m) {
    const t = parseHM(m[1]);
    if (!t) return null;
    let p = now;
    if (t[0] < now.h || (t[0] === now.h && t[1] <= now.mi)) {
      p = shiftDays(now, 1);
    }
    return shanghaiISO(p.y, p.mo, p.d, t[0], t[1]);
  }

  // 今天/明天/后天 H点
  m = e.match(/^(今天|明天|后天)\s*(.+)$/);
  if (m) {
    const t = parseHM(m[2]);
    if (!t) return null;
    const off = m[1] === "今天" ? 0 : m[1] === "明天" ? 1 : 2;
    const p = shiftDays(now, off);
    return shanghaiISO(p.y, p.mo, p.d, t[0], t[1]);
  }

  // M月D日 H点（已过则明年）
  m = e.match(/^(\d{1,2})月(\d{1,2})[日号]\s*(.+)$/);
  if (m) {
    const t = parseHM(m[3]);
    if (!t) return null;
    const mo = parseInt(m[1]);
    const d = parseInt(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let y = now.y;
    if (mo < now.mo || (mo === now.mo && d < now.d)) y++;
    return shanghaiISO(y, mo, d, t[0], t[1]);
  }

  // 纯 H点 → 今天，已过则明天
  const t = parseHM(e);
  if (t) {
    let p = now;
    if (t[0] < now.h || (t[0] === now.h && t[1] <= now.mi)) {
      p = shiftDays(now, 1);
    }
    return shanghaiISO(p.y, p.mo, p.d, t[0], t[1]);
  }
  return null;
}

const TIME_CORE =
  String.raw`(?:今天|明天|后天|每天)?\s*(?:\d{1,2}月\d{1,2}[日号]\s*)?\d{1,2}(?:点半|[点:：]\s*\d{0,2})?`;
// 时间表达式必须含明确的时间标记，避免把纯数字内容误拆
const TIME_MARKER = /(今天|明天|后天|每天|月|[点:：]|半)/;

/** 把"记 <内容> [时间]"拆成内容和时间表达式；时间在末尾或开头 */
export function splitContentTime(
  arg: string,
): { content: string; timeExpr: string | null } {
  const s = arg.trim();
  // 时间在末尾
  let m = s.match(new RegExp(`^(.*?)\\s*(${TIME_CORE})\\s*$`));
  if (m && m[1].trim() && TIME_MARKER.test(m[2])) {
    return { content: m[1].trim(), timeExpr: m[2].trim() };
  }
  // 时间在开头（无空格也行，如"明天9点开站会"）
  m = s.match(new RegExp(`^(${TIME_CORE})(.*?)$`));
  if (m && m[2].trim() && TIME_MARKER.test(m[1])) {
    return { content: m[2].trim(), timeExpr: m[1].trim() };
  }
  return { content: s, timeExpr: null };
}

// ---------------------------------------------------------------- cron
function cronFieldMatch(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  // 周日 7 视为 0
  const f = field.replace(/(^|[,/-])7(?=$|[,/])/g, "$10");
  for (const part of f.split(",")) {
    let range = part;
    let step = 1;
    const si = part.indexOf("/");
    if (si >= 0) {
      range = part.slice(0, si);
      step = parseInt(part.slice(si + 1)) || 1;
    }
    let lo = min;
    let hi = max;
    if (range === "*") {
      // 全范围
    } else if (range.includes("-")) {
      const ab = range.split("-").map(Number);
      lo = ab[0];
      hi = ab[1];
    } else if (range === "") {
      continue;
    } else {
      lo = hi = Number(range);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v === value) return true;
    }
  }
  return false;
}

/** 标准五段式 cron 是否命中当前分钟（按北京时间判断） */
export function cronMatches(cron: string, d: Date = new Date()): boolean {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const p = shanghaiParts(d);
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  return (
    cronFieldMatch(f[0], p.mi, 0, 59) &&
    cronFieldMatch(f[1], p.h, 0, 23) &&
    cronFieldMatch(f[2], p.d, 1, 31) &&
    cronFieldMatch(f[3], p.mo, 1, 12) &&
    cronFieldMatch(f[4], dow, 0, 7)
  );
}
