export const TZ = "Asia/Colombo";

export function fmt12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export function fmtDate(d) {
  if (!d) return "";
  return new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
export function fmtDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
/** Local wall-clock timestamp ("2026-11-25 12:30:00" or "…T12:30") -> readable string. */
export function fmtLocal(ts) {
  if (!ts) return "";
  const s = String(ts).replace("T", " ");
  return `${fmtDate(s.slice(0, 10))}, ${fmt12(s.slice(11, 16))}`;
}
export function todayStr() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}
export function nowTimeStr() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}
export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

export function errMsg(err, fallback = "Something went wrong") {
  const d = err?.response?.data;
  if (d?.conflicts?.length) return `${d.message}`;
  return d?.message || err?.message || fallback;
}
export const ROLE_LABEL = { ADMIN: "Admin", LECTURER: "Lecturer", INSTRUCTOR: "Instructor", STUDENT: "Student", LAB_ASSISTANT: "Lab Assistant" };
export const DIRECT_ROLES = ["LECTURER", "INSTRUCTOR", "LAB_ASSISTANT"];
export const PURPOSES = ["Lecture", "Tutorial", "Practical / Laboratory session", "Examination", "Meeting", "Workshop / Seminar", "Student society event", "Other"];
export const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
