const colorEnabled =
  process.stdout.isTTY === true &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

const paint = (open) => (s) => (colorEnabled ? `\u001b[${open}m${s}\u001b[0m` : String(s));

export const dim = paint(2);
export const bold = paint(1);
export const green = paint(32);
export const yellow = paint(33);
export const red = paint(31);
export const cyan = paint(36);

export const step = (msg) => console.log(`${green("==>")} ${msg}`);
export const warn = (msg) => console.error(`${yellow("!!")}  ${msg}`);
export const fail = (msg) => console.error(`${red("xx")}  ${msg}`);
export const note = (msg) => console.log(`${dim(msg)}`);

export function bullet(label, value, { ok = null } = {}) {
  const mark = ok === null ? "" : ok ? green(" ✅") : yellow(" ⚠️");
  console.log(`  ${String(label).padEnd(18)} ${value}${mark}`);
}

export function header(title) {
  console.log(`\n${bold(title)}`);
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Minimal spinner that degrades to a plain line when not a TTY. */
export function spinner(label) {
  if (!colorEnabled) {
    step(label);
    return { stop: () => {}, succeed: (m) => m && step(m), fail: (m) => m && fail(m) };
  }
  let i = 0;
  process.stdout.write(`${SPINNER[0]} ${label}`);
  const timer = setInterval(() => {
    process.stdout.write(`\r${SPINNER[(i = (i + 1) % SPINNER.length)]} ${label}`);
  }, 80);
  const clear = () => {
    clearInterval(timer);
    process.stdout.write("\r\u001b[2K");
  };
  return {
    stop: clear,
    succeed: (m) => {
      clear();
      if (m) step(m);
    },
    fail: (m) => {
      clear();
      if (m) fail(m);
    },
  };
}

export function table(rows) {
  const visible = rows.map((r) => r.map((c) => String(c)));
  const widths = visible[0].map((_, i) => Math.max(...visible.map((r) => stripAnsi(r[i] ?? "").length)));
  for (const [idx, row] of visible.entries()) {
    const line = row
      .map((cell, i) => cell + " ".repeat(Math.max(0, widths[i] - stripAnsi(cell).length)))
      .join("  ")
      .trimEnd();
    console.log(`  ${idx === 0 ? bold(line) : line}`);
  }
}

export function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;]*m/g, "");
}
