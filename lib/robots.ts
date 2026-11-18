// Minimal RFC 9309 robots.txt parser.

interface Rule { allow: boolean; pattern: string }
interface Group { agents: string[]; rules: Rule[] }

export interface ParsedRobots {
  groups: Group[];
  sitemaps: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      if (key === "disallow" && value === "") continue; // empty disallow = allow all
      current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "sitemap") {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(
    "^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : "")
  );
  return re.test(path);
}

function groupFor(robots: ParsedRobots, token: string): Group | null {
  const t = token.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.some((a) => a !== "*" && t.includes(a)));
  if (specific.length) {
    // merge all matching groups
    return { agents: [t], rules: specific.flatMap((g) => g.rules) };
  }
  const star = robots.groups.filter((g) => g.agents.includes("*"));
  return star.length ? { agents: ["*"], rules: star.flatMap((g) => g.rules) } : null;
}

export type Access = "allowed" | "blocked" | "partial";

/** Whether `token` may fetch `path`, plus whether it has meaningful restrictions. */
export function checkAccess(robots: ParsedRobots, token: string, path = "/"): { access: Access; explicit: boolean } {
  const g = groupFor(robots, token);
  if (!g) return { access: "allowed", explicit: false };
  const explicit = g.agents[0] !== "*";
  let best: Rule | null = null;
  for (const r of g.rules) {
    if (!patternMatches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  if (best && !best.allow) return { access: "blocked", explicit };
  const hasDisallows = g.rules.some((r) => !r.allow);
  return { access: hasDisallows ? "partial" : "allowed", explicit };
}
