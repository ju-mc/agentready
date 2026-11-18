import { safeFetch, AGENT_UA, normalizeInputUrl, type FetchResult } from "./fetcher";
import { parseRobots, checkAccess, type ParsedRobots } from "./robots";
import { load, visibleText, wordCount, jsonLdTypes, unlabeledControls, meta, type $Doc } from "./html";
import { CATEGORIES, type Check, type CategoryId, type ScanResult, type PageResult, type FreeScanResult, type Status } from "./types";

// AI crawlers/agents, grouped by what blocking them costs you.
const AI_AGENTS = {
  // Fetch pages live on behalf of a user ("go check this site for me").
  user: ["ChatGPT-User", "Claude-User", "Perplexity-User"],
  // Power AI search/answer engines that cite and link to you.
  search: ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"],
  // Collect training data. Blocking these is a legitimate business choice.
  training: ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot", "Meta-ExternalAgent", "Bytespider"],
};

const CHALLENGE_MARKERS = [
  /just a moment\.\.\./i, /cf-chl-/i, /challenge-platform/i, /attention required! \| cloudflare/i,
  /px-captcha/i, /_incapsula_resource/i, /captcha-delivery\.com/i, /datadome/i, /verify you are human/i,
  /g-recaptcha/i, /hcaptcha\.com/i, /awswaf/i,
];

const USEFUL_LD_TYPES = [
  "Organization", "LocalBusiness", "WebSite", "Product", "Offer", "FAQPage", "Article", "BlogPosting",
  "NewsArticle", "SoftwareApplication", "Service", "Event", "BreadcrumbList", "Person", "Recipe", "HowTo",
  "Restaurant", "Store", "Course", "JobPosting",
];

const MACHINE_ENDPOINTS: { path: string; label: string; json: boolean }[] = [
  { path: "/openapi.json", label: "OpenAPI spec", json: true },
  { path: "/.well-known/openapi.json", label: "OpenAPI spec (.well-known)", json: true },
  { path: "/.well-known/agent-card.json", label: "A2A agent card", json: true },
  { path: "/.well-known/agent.json", label: "A2A agent card (legacy path)", json: true },
  { path: "/.well-known/mcp.json", label: "MCP server manifest (proposed)", json: true },
  { path: "/.well-known/ai-plugin.json", label: "AI plugin manifest (legacy)", json: true },
];

/**
 * `title` is the goal ("robots.txt allows AI agents"), shown when the check passes.
 * `issue` is the problem-style name ("robots.txt blocks AI agents"), shown when it fails or warns.
 */
function check(c: Omit<Check, "earned"> & { earned?: number; issue?: string | { fail?: string; warn?: string } }): Check {
  const { issue, ...rest } = c;
  const earned = c.earned ?? (c.status === "pass" ? c.max : c.status === "warn" ? Math.round(c.max / 2) : c.status === "info" ? c.max : 0);
  let title = c.title;
  if (issue && (c.status === "fail" || c.status === "warn")) {
    title = (typeof issue === "string" ? issue : issue[c.status]) ?? c.title;
  }
  return { ...rest, title, earned };
}

function looksLikeHtml(body: string) {
  return /^\s*(<!doctype html|<html)/i.test(body);
}

function siteNameFrom($: $Doc, url: URL): string {
  return (
    meta($, "og:site_name") ||
    $("title").first().text().split(/[|\-–—·:]/)[0].trim() ||
    url.hostname.replace(/^www\./, "")
  );
}

// ---------------------------------------------------------------------------

export async function scan(rawUrl: string, opts: { full?: boolean } = {}): Promise<ScanResult> {
  const input = normalizeInputUrl(rawUrl);
  const home = await safeFetch(input.toString());
  if (home.status === 0) throw new Error(`Could not reach ${input.hostname}: ${home.error}`);

  const finalUrl = new URL(home.finalUrl);
  const origin = finalUrl.origin;
  const $ = load(home.body);

  const [agentHome, robotsRes, llmsRes, llmsFullRes, mdRes, sitemapGuess, ...endpointRes] = await Promise.all([
    safeFetch(finalUrl.toString(), { ua: AGENT_UA }),
    safeFetch(`${origin}/robots.txt`, { accept: "text/plain,*/*" }),
    safeFetch(`${origin}/llms.txt`, { accept: "text/plain,text/markdown,*/*" }),
    safeFetch(`${origin}/llms-full.txt`, { accept: "text/plain,text/markdown,*/*", method: "HEAD" }),
    safeFetch(finalUrl.toString(), { accept: "text/markdown" }),
    safeFetch(`${origin}/sitemap.xml`, { accept: "application/xml,text/xml,*/*" }),
    ...MACHINE_ENDPOINTS.map((e) => safeFetch(origin + e.path, { accept: "application/json" })),
  ]);

  const robots: ParsedRobots | null =
    robotsRes.ok && !looksLikeHtml(robotsRes.body) ? parseRobots(robotsRes.body) : null;

  const checks: Check[] = [
    ...accessChecks(home, agentHome, robots, robotsRes, finalUrl),
    ...(await discoverabilityChecks($, robots, llmsRes, llmsFullRes, sitemapGuess, origin)),
    ...readabilityChecks($, mdRes),
    ...structureChecks($),
    ...actionabilityChecks($, endpointRes, origin),
  ];

  const result = score(checks);
  const siteName = siteNameFrom($, finalUrl);
  const out: ScanResult = {
    url: input.toString(),
    finalUrl: finalUrl.toString(),
    scannedAt: new Date().toISOString(),
    siteName,
    ...result,
    checks,
  };

  if (opts.full) {
    const urls = await samplePages($, robots, sitemapGuess, finalUrl);
    out.pages = await Promise.all(urls.map(scanPage));
    out.artifacts = buildArtifacts(siteName, finalUrl, $, out.pages);
  }
  return out;
}

// --------------------------------------------------------------------------- Access

function accessChecks(home: FetchResult, agent: FetchResult, robots: ParsedRobots | null, robotsRes: FetchResult, url: URL): Check[] {
  const out: Check[] = [];

  // 1. Do agents get blocked by a WAF / bot challenge?
  const agentChallenged = CHALLENGE_MARKERS.some((r) => r.test(agent.body));
  const browserChallenged = CHALLENGE_MARKERS.some((r) => r.test(home.body));
  const agentBlocked = agent.status === 0 || agent.status === 403 || agent.status === 429 || agent.status === 503 || agentChallenged;
  out.push(check({
    id: "bot-blocking", category: "access", title: "AI agents aren't blocked by your firewall", issue: { fail: "AI agents are blocked by your firewall", warn: "Bot challenges on every page can trip up AI agents" }, max: 15,
    status: agentBlocked ? "fail" : browserChallenged ? "warn" : "pass",
    summary: agentBlocked
      ? `A request identifying as an AI agent got ${agent.status === 0 ? "no response" : `HTTP ${agent.status}`}${agentChallenged ? " with a bot challenge page" : ""}.`
      : browserChallenged ? "Your homepage serves a bot-challenge script even to regular browsers." : "Requests from AI agents get the same page as browsers.",
    detail:
      "We requested your homepage twice: once as a normal browser and once with an AI agent user-agent (ClaudeBot). " +
      "Many sites put Cloudflare, Akamai, DataDome or similar bot protection in front of everything, which silently turns away AI assistants trying to read the page for a user. " +
      `Browser: HTTP ${home.status}. Agent: HTTP ${agent.status}${agentChallenged ? " (challenge page detected)" : ""}.`,
    fix: agentBlocked
      ? "In your bot-management settings (e.g. Cloudflare → Security → Bots), allow verified AI crawlers and user-triggered agents. Cloudflare's 'Block AI bots' toggle and 'AI Crawl Control' are the usual culprits. Keep challenges on sensitive paths like /login and /checkout only."
      : browserChallenged ? "Challenge scripts on every page slow agents down and can trip headless browsers. Scope them to sensitive paths." : undefined,
  }));

  // 2. robots.txt rules for AI agents
  if (!robots) {
    out.push(check({
      id: "robots-ai", category: "access", title: "robots.txt allows AI agents", issue: robotsRes.status === 404 ? "No robots.txt policy for AI agents" : "robots.txt couldn't be read", max: 10, status: "warn",
      summary: robotsRes.status === 404 ? "No robots.txt — everything is allowed, but you're not stating a policy." : `robots.txt couldn't be read (HTTP ${robotsRes.status}).`,
      detail: "Without a robots.txt, crawlers assume everything is allowed. That's fine for access, but you lose control and can't point agents to your sitemap.",
      fix: "Add a robots.txt that explicitly allows user-facing AI agents and lists your sitemap. See the generated file in this report.",
    }));
  } else {
    const rows = Object.entries(AI_AGENTS).flatMap(([kind, list]) =>
      list.map((bot) => ({ bot, kind, ...checkAccess(robots, bot, "/") }))
    );
    const blockedUser = rows.filter((r) => r.kind === "user" && r.access === "blocked");
    const blockedSearch = rows.filter((r) => r.kind === "search" && r.access === "blocked");
    const blockedTraining = rows.filter((r) => r.kind === "training" && r.access === "blocked");
    const status: Status = blockedUser.length ? "fail" : blockedSearch.length ? "warn" : "pass";
    out.push(check({
      id: "robots-ai", category: "access", title: "robots.txt allows AI agents", issue: { fail: "robots.txt blocks AI assistants", warn: "robots.txt blocks AI search bots" }, max: 10, status,
      earned: blockedUser.length ? 0 : blockedSearch.length ? 5 : 10,
      summary: blockedUser.length
        ? `robots.txt blocks user-triggered agents: ${blockedUser.map((r) => r.bot).join(", ")}.`
        : blockedSearch.length
          ? `robots.txt blocks AI search bots: ${blockedSearch.map((r) => r.bot).join(", ")}.`
          : `AI assistants and AI search bots are allowed${blockedTraining.length ? ` (training bots blocked: ${blockedTraining.length})` : ""}.`,
      detail:
        "AI bots fall into three groups. User-triggered agents (ChatGPT-User, Claude-User, Perplexity-User) fetch your page when a person asks about it, and blocking them means assistants can't answer questions about you. " +
        "AI search bots decide whether you're cited in AI search answers. Training crawlers collect model training data; blocking those is a legitimate choice and doesn't affect this score.",
      evidence: rows.map((r) => `${r.bot} (${r.kind}): ${r.access}${r.explicit ? " — named explicitly" : ""}`),
      fix: status !== "pass" ? "Remove the Disallow rules for user-triggered agents and AI search bots. You can keep training crawlers blocked. A suggested robots.txt is included below." : undefined,
    }));
  }

  // 3. HTTPS
  out.push(check({
    id: "https", category: "access", title: "Served over HTTPS", issue: "Not served over HTTPS", max: 3,
    status: url.protocol === "https:" ? "pass" : "fail",
    summary: url.protocol === "https:" ? "Site is served over HTTPS." : "Site is not served over HTTPS.",
    detail: "Many agents and browsers refuse or downgrade insecure pages.",
    fix: url.protocol === "https:" ? undefined : "Enable HTTPS (free via Let's Encrypt or your host) and redirect http → https.",
  }));

  // 4. Speed
  const ms = home.ms;
  out.push(check({
    id: "speed", category: "access", title: "Homepage responds quickly", issue: "Homepage is slow to respond", max: 4,
    status: ms < 1500 ? "pass" : ms < 4000 ? "warn" : "fail",
    summary: `Homepage HTML loaded in ${(ms / 1000).toFixed(1)}s (${Math.round(home.bytes / 1024)} KB, ${home.redirects} redirect${home.redirects === 1 ? "" : "s"}).`,
    detail: "Agents work under tight time budgets and often give up on slow pages or move to a competitor's.",
    fix: ms >= 1500 ? "Cache the HTML at the edge (CDN), cut redirect chains, and shrink server-side work on the homepage." : undefined,
  }));

  // 5. noindex / noai directives
  const xRobots = (home.headers["x-robots-tag"] || "").toLowerCase();
  const metaRobots = (load(home.body)('meta[name="robots"]').attr("content") || "").toLowerCase();
  const directives = `${xRobots} ${metaRobots}`;
  const noindex = /noindex/.test(directives);
  const noai = /noai|noimageai/.test(directives);
  out.push(check({
    id: "robots-directives", category: "access", title: "No page-level opt-out directives", issue: { fail: "Homepage tells search and AI tools not to index it", warn: "Homepage opts out of AI (noai)" }, max: 3,
    status: noindex ? "fail" : noai ? "warn" : "pass",
    summary: noindex ? "Homepage has a noindex directive." : noai ? "Homepage sets noai/noimageai." : "No noindex or noai directives on the homepage.",
    detail: `Found X-Robots-Tag: "${xRobots || "none"}", meta robots: "${metaRobots || "none"}".`,
    fix: noindex ? "Remove noindex from pages you want found." : noai ? "noai is a non-standard opt-out; remove it if you want AI tools to use this page." : undefined,
  }));

  return out;
}

// --------------------------------------------------------------------------- Discoverability

async function discoverabilityChecks($: $Doc, robots: ParsedRobots | null, llms: FetchResult, llmsFull: FetchResult, sitemapGuess: FetchResult, origin: string): Promise<Check[]> {
  const out: Check[] = [];

  // llms.txt
  const llmsValid = llms.ok && !looksLikeHtml(llms.body) && /^\s*#\s+\S/.test(llms.body);
  const llmsLinks = llmsValid ? (llms.body.match(/\]\(https?:\/\/[^)]+\)/g) || []).length : 0;
  out.push(check({
    id: "llms-txt", category: "discoverability", title: "Has an llms.txt file", issue: { fail: "No llms.txt file", warn: "llms.txt is missing links or broken" }, max: 8,
    status: llmsValid ? (llmsLinks > 0 ? "pass" : "warn") : llms.ok && !looksLikeHtml(llms.body) ? "warn" : "fail",
    summary: llmsValid
      ? `/llms.txt found with ${llmsLinks} link${llmsLinks === 1 ? "" : "s"}${llmsFull.ok ? " (plus llms-full.txt)" : ""}.`
      : llms.ok && looksLikeHtml(llms.body) ? "/llms.txt returns an HTML page (likely a soft 404)." : "No /llms.txt file.",
    detail:
      "llms.txt is a short Markdown file at your site root that tells AI tools what your site is and links to the pages that matter. It's a proposed standard, not universal yet, but it's cheap to add and coding agents and docs tools already use it. " +
      "A valid file starts with an H1 (# Site name), a one-line summary in a blockquote, then lists of links.",
    fix: llmsValid && llmsLinks > 0 ? undefined : "Publish /llms.txt. A draft built from your pages is included in this report.",
  }));

  // sitemap
  const sitemapUrls = robots?.sitemaps ?? [];
  let sitemapBody = sitemapGuess.ok ? sitemapGuess.body : "";
  let sitemapSource = `${origin}/sitemap.xml`;
  if (!/<(urlset|sitemapindex)/i.test(sitemapBody) && sitemapUrls[0]) {
    const s = await safeFetch(sitemapUrls[0], { accept: "application/xml,text/xml,*/*" });
    sitemapBody = s.ok ? s.body : "";
    sitemapSource = sitemapUrls[0];
  }
  const sitemapValid = /<(urlset|sitemapindex)/i.test(sitemapBody);
  const locCount = (sitemapBody.match(/<loc>/gi) || []).length;
  out.push(check({
    id: "sitemap", category: "discoverability", title: "Has an XML sitemap", issue: { fail: "No XML sitemap", warn: "Sitemap isn't listed in robots.txt" }, max: 5,
    status: sitemapValid ? (sitemapUrls.length ? "pass" : "warn") : "fail",
    summary: sitemapValid
      ? `Sitemap found (${locCount} entries)${sitemapUrls.length ? ", listed in robots.txt" : ", but not listed in robots.txt"}.`
      : "No XML sitemap found.",
    detail: `Checked ${sitemapSource}${sitemapUrls.length ? ` and robots.txt sitemap entries (${sitemapUrls.length})` : ""}. Sitemaps tell crawlers which pages exist and when they changed.`,
    fix: sitemapValid ? (sitemapUrls.length ? undefined : `Add "Sitemap: ${sitemapSource}" to robots.txt.`) : "Generate a sitemap.xml (most CMSs and frameworks have a plugin) and reference it in robots.txt.",
  }));

  // title + description
  const title = $("title").first().text().trim();
  const desc = meta($, "description");
  const titleOk = title.length >= 10 && title.length <= 70;
  const descOk = desc.length >= 50 && desc.length <= 170;
  out.push(check({
    id: "meta", category: "discoverability", title: "Clear page title and description", issue: { fail: "Page title or description is missing", warn: "Page title or description needs work" }, max: 4,
    status: titleOk && descOk ? "pass" : title && desc ? "warn" : "fail",
    summary: !title ? "Homepage has no <title>." : !desc ? "Homepage has no meta description." : titleOk && descOk ? "Title and description look good." : "Title or description is too short or too long.",
    detail: `Title (${title.length} chars): "${title}". Description (${desc.length} chars): "${desc}". Agents use these as the one-line answer to "what is this site?"`,
    fix: titleOk && descOk ? undefined : "Write a 10–70 character title and a 50–160 character description that says plainly what you offer and who it's for.",
  }));

  // canonical + lang
  const canonical = $('link[rel="canonical"]').attr("href");
  const lang = $("html").attr("lang");
  out.push(check({
    id: "canonical-lang", category: "discoverability", title: "Canonical URL and language declared", issue: "Canonical URL or language is missing", max: 3,
    status: canonical && lang ? "pass" : canonical || lang ? "warn" : "fail",
    summary: `${canonical ? "Canonical set" : "No canonical URL"}; ${lang ? `lang="${lang}"` : "no lang attribute"}.`,
    detail: "A canonical link stops agents from treating duplicate URLs as separate pages, and the lang attribute tells them what language to read in.",
    fix: canonical && lang ? undefined : 'Add <link rel="canonical" href="…"> to each page and <html lang="en"> (or your language).',
  }));

  return out;
}

// --------------------------------------------------------------------------- Readability

function readabilityChecks($: $Doc, md: FetchResult): Check[] {
  const out: Check[] = [];
  const text = visibleText($);
  const words = wordCount(text);
  const rootShell = $("#root, #app, #__next, #___gatsby, [data-reactroot]").filter((_, e) => $(e).text().trim().length < 20).length > 0;
  const noscriptWarn = /enable javascript|requires javascript|javascript is (disabled|required)/i.test($("noscript").text());

  out.push(check({
    id: "ssr", category: "readability", title: "Content is in the HTML (no JavaScript needed)", issue: { fail: "Content needs JavaScript to load", warn: "Little content loads without JavaScript" }, max: 15,
    status: words >= 150 ? "pass" : words >= 50 ? "warn" : "fail",
    earned: words >= 150 ? 15 : words >= 50 ? 7 : 0,
    summary: words >= 150
      ? `${words} words readable without running JavaScript.`
      : `Only ${words} word${words === 1 ? "" : "s"} visible without JavaScript${rootShell || noscriptWarn ? " — looks like a client-rendered app shell" : ""}.`,
    detail:
      "Most AI crawlers and many agents don't execute JavaScript. They read the raw HTML. If your content is rendered client-side (plain React/Vue/Angular builds, many site builders), they see an empty page. " +
      `Raw HTML preview: "${text.slice(0, 280)}${text.length > 280 ? "…" : ""}"`,
    fix: words >= 150 ? undefined : "Use server-side rendering or static generation (Next.js, Nuxt, Astro, Remix), or a prerendering service, so the HTML contains your real content.",
  }));

  // Headings
  const h1s = $("h1").length;
  const levels = $("h1,h2,h3,h4,h5,h6").map((_, e) => Number(e.tagName.slice(1))).get();
  let skips = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips++;
  out.push(check({
    id: "headings", category: "readability", title: "Logical heading structure", issue: { fail: "No main heading (H1)", warn: "Heading structure is messy" }, max: 4,
    status: h1s === 1 && skips === 0 && levels.length >= 3 ? "pass" : h1s >= 1 ? "warn" : "fail",
    summary: `${h1s} H1${h1s === 1 ? "" : "s"}, ${levels.length} headings total, ${skips} skipped level${skips === 1 ? "" : "s"}.`,
    detail: "Agents use headings to outline a page and jump to the right section. Aim for one H1 and nested H2/H3s without skipping levels.",
    fix: h1s === 1 && skips === 0 && levels.length >= 3 ? undefined : "Use exactly one <h1> for the page topic, then <h2>/<h3> for sections. Don't style divs to look like headings.",
  }));

  // Landmarks
  const hasMain = $("main, [role=main]").length > 0;
  const hasNav = $("nav, [role=navigation]").length > 0;
  out.push(check({
    id: "landmarks", category: "readability", title: "Semantic page landmarks", issue: "Missing page landmarks (<main>, <nav>)", max: 3,
    status: hasMain && hasNav ? "pass" : hasMain || hasNav ? "warn" : "fail",
    summary: `${hasMain ? "<main>" : "no <main>"}, ${hasNav ? "<nav>" : "no <nav>"}.`,
    detail: "<main>, <nav>, <header> and <footer> let agents skip boilerplate and go straight to the content.",
    fix: hasMain && hasNav ? undefined : "Wrap primary content in <main> and menus in <nav>.",
  }));

  // Markdown negotiation
  const ct = md.headers["content-type"] || "";
  const servesMd = md.ok && /markdown/i.test(ct);
  out.push(check({
    id: "markdown", category: "readability", title: "Serves Markdown to agents (bonus)", max: 3,
    status: servesMd ? "pass" : "info", earned: servesMd ? 3 : 0,
    summary: servesMd ? "Returns Markdown when asked with Accept: text/markdown." : "Doesn't serve a Markdown version of pages.",
    detail: "Some sites return clean Markdown when a client sends Accept: text/markdown. It's an emerging pattern (several docs platforms support it) that saves agents tokens and parsing errors. Optional.",
    fix: servesMd ? undefined : "Optional: serve a .md version of key pages, or support Accept: text/markdown via middleware.",
  }));

  return out;
}

// --------------------------------------------------------------------------- Structure

function structureChecks($: $Doc): Check[] {
  const out: Check[] = [];
  const { types, invalid, blocks } = jsonLdTypes($);
  const useful = types.filter((t) => USEFUL_LD_TYPES.includes(t));
  out.push(check({
    id: "jsonld", category: "structure", title: "Schema.org structured data (JSON-LD)", issue: { fail: "No structured data (JSON-LD)", warn: "Structured data is thin or invalid" }, max: 10,
    status: useful.length >= 2 && !invalid ? "pass" : types.length ? "warn" : "fail",
    earned: useful.length >= 2 && !invalid ? 10 : useful.length === 1 ? 6 : types.length ? 3 : 0,
    summary: blocks
      ? `${blocks} JSON-LD block${blocks === 1 ? "" : "s"}: ${types.join(", ") || "no @type"}${invalid ? ` (${invalid} invalid)` : ""}.`
      : "No JSON-LD structured data.",
    detail: "Structured data states facts explicitly (this is a Product, its price is X, the business opens at 9) instead of making agents guess from prose. It's the most reliable way to get accurate answers about you.",
    fix: useful.length >= 2 && !invalid ? undefined : "Add JSON-LD for your Organization and WebSite, plus page-specific types (Product, FAQPage, Article, LocalBusiness…). A starter block is included below.",
  }));

  const og = ["og:title", "og:description", "og:image"].filter((k) => meta($, k));
  out.push(check({
    id: "opengraph", category: "structure", title: "Open Graph tags", issue: "Missing Open Graph tags", max: 3,
    status: og.length === 3 ? "pass" : og.length ? "warn" : "fail",
    summary: `${og.length}/3 core Open Graph tags present.`,
    detail: "Open Graph tags (og:title, og:description, og:image) drive link previews in chat apps and are read by many AI tools.",
    fix: og.length === 3 ? undefined : "Add og:title, og:description and og:image meta tags.",
  }));

  const imgs = $("img");
  const missingAlt = imgs.filter((_, e) => $(e).attr("alt") === undefined).length;
  const pct = imgs.length ? Math.round(((imgs.length - missingAlt) / imgs.length) * 100) : 100;
  out.push(check({
    id: "alt", category: "structure", title: "Images have alt text", issue: "Images are missing alt text", max: 2,
    status: pct >= 90 ? "pass" : pct >= 60 ? "warn" : "fail",
    summary: imgs.length ? `${pct}% of ${imgs.length} images have an alt attribute.` : "No <img> tags on the page.",
    detail: "Alt text is how agents understand images, product photos especially.",
    fix: pct >= 90 ? undefined : 'Add descriptive alt text to meaningful images and alt="" to decorative ones.',
  }));
  return out;
}

// --------------------------------------------------------------------------- Actionability

function actionabilityChecks($: $Doc, endpoints: FetchResult[], origin: string): Check[] {
  const out: Check[] = [];
  const u = unlabeledControls($);
  const total = u.buttons + u.links + u.inputs;
  const controls = $("a[href], button, input, select, textarea, [role=button]").length;
  out.push(check({
    id: "a11y-names", category: "actionability", title: "Buttons, links and fields are labeled", issue: "Unlabeled buttons, links or form fields", max: 8,
    status: total === 0 ? "pass" : total <= 3 ? "warn" : "fail",
    summary: total === 0 ? `All ${controls} interactive elements have names.` : `${total} of ${controls} interactive elements have no accessible name.`,
    detail:
      "Browser agents (ChatGPT agent, Claude in Chrome, Operator-style tools) navigate using the accessibility tree, the same structure screen readers use. An icon button with no label shows up as just 'button', so the agent can't tell 'Add to cart' from 'Close'. " +
      `Unlabeled: ${u.buttons} buttons, ${u.links} links, ${u.inputs} form fields.`,
    evidence: u.examples,
    fix: total === 0 ? undefined : "Give icon-only buttons and links an aria-label, and connect every form field to a <label>.",
  }));

  out.push(check({
    id: "clickable-divs", category: "actionability", title: "Clickable things are real buttons or links", issue: "Clickable elements aren't real buttons or links", max: 3,
    status: u.clickableDivs === 0 ? "pass" : u.clickableDivs <= 2 ? "warn" : "fail",
    summary: u.clickableDivs === 0 ? "No click handlers on plain divs/spans in the HTML." : `${u.clickableDivs} div/span elements with onclick and no role.`,
    detail: "Agents look for <button> and <a>. A <div onclick> is invisible to them as a control. (Only inline handlers in the HTML can be detected here; JS-attached handlers can't.)",
    fix: u.clickableDivs === 0 ? undefined : 'Use <button> or <a href>, or at least add role="button" and tabindex="0".',
  }));

  const found = MACHINE_ENDPOINTS.filter((e, i) => {
    const r = endpoints[i];
    if (!r.ok || looksLikeHtml(r.body)) return false;
    try { JSON.parse(r.body); return true; } catch { return false; }
  });
  out.push(check({
    id: "machine-interfaces", category: "actionability", title: "Machine-readable interfaces (bonus)", max: 4,
    status: found.length ? "pass" : "info", earned: found.length ? 4 : 0,
    summary: found.length ? `Found: ${found.map((f) => f.label).join(", ")}.` : "No public API spec, agent card or MCP manifest found.",
    detail:
      "Agents work best when they can call an API instead of clicking through UI. We checked common locations for an OpenAPI spec, an A2A agent card and MCP/plugin manifests. These standards are still settling, so not having one is normal. It's a bonus, not a requirement.",
    evidence: MACHINE_ENDPOINTS.map((e, i) => `${origin}${e.path}: ${endpoints[i].status || endpoints[i].error}`),
    fix: found.length ? undefined : "If you have an API, publish its OpenAPI spec. If agents should take actions for users (book, buy, search inventory), consider an MCP server.",
  }));
  return out;
}

// --------------------------------------------------------------------------- Scoring

function gradeFor(score: number) {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
}

function score(checks: Check[]) {
  const categories = Object.fromEntries(
    (Object.keys(CATEGORIES) as CategoryId[]).map((id) => {
      const cs = checks.filter((c) => c.category === id);
      // Bonus checks only add points; they don't count against you.
      const max = cs.reduce((s, c) => s + (c.status === "info" ? 0 : c.max), 0) || 1;
      const earned = Math.min(max, cs.reduce((s, c) => s + c.earned, 0));
      return [id, { score: Math.round((earned / max) * 100), earned, max }];
    })
  ) as ScanResult["categories"];
  const earned = Object.values(categories).reduce((s, c) => s + c.earned, 0);
  const max = Object.values(categories).reduce((s, c) => s + c.max, 0);
  const total = Math.round((earned / max) * 100);
  return { score: total, grade: gradeFor(total), categories };
}

const SEVERITY: Record<Status, number> = { fail: 0, warn: 1, info: 2, pass: 3 };

export function toFree(r: ScanResult): FreeScanResult {
  const issues = r.checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || (b.max - b.earned) - (a.max - a.earned));
  const counts = { pass: 0, warn: 0, fail: 0, total: r.checks.length };
  r.checks.forEach((c) => { if (c.status !== "info") counts[c.status]++; });
  return {
    url: r.url, finalUrl: r.finalUrl, scannedAt: r.scannedAt, siteName: r.siteName,
    score: r.score, grade: r.grade, categories: r.categories, counts,
    topIssues: issues.slice(0, 3).map((c) => ({ title: c.title, status: c.status, summary: c.summary, category: c.category })),
    lockedIssues: Math.max(0, issues.length - 3),
  };
}

// --------------------------------------------------------------------------- Full report: page sample + artifacts

async function samplePages($: $Doc, robots: ParsedRobots | null, sitemap: FetchResult, home: URL): Promise<string[]> {
  const urls = new Set<string>([home.toString()]);
  let body = sitemap.ok ? sitemap.body : "";
  if (!/<urlset/i.test(body)) {
    // follow one sitemap index / robots sitemap
    const next = body.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1] ?? robots?.sitemaps[0];
    if (next) {
      const r = await safeFetch(next, { accept: "application/xml,text/xml,*/*" });
      body = r.ok ? r.body : "";
    }
  }
  for (const m of body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try { if (new URL(m[1]).hostname === home.hostname) urls.add(m[1]); } catch {}
    if (urls.size >= 10) break;
  }
  if (urls.size < 10) {
    $("a[href]").each((_, e) => {
      if (urls.size >= 10) return;
      try {
        const u = new URL($(e).attr("href")!, home);
        u.hash = "";
        if (u.hostname === home.hostname && /^https?:$/.test(u.protocol) && !/\.(pdf|jpg|png|zip|svg)$/i.test(u.pathname)) urls.add(u.toString());
      } catch {}
    });
  }
  return [...urls].slice(0, 10);
}

async function scanPage(url: string): Promise<PageResult> {
  const r = await safeFetch(url);
  const $ = load(r.body);
  const u = unlabeledControls($);
  return {
    url, status: r.status,
    words: wordCount(visibleText($)),
    title: $("title").first().text().trim(),
    hasH1: $("h1").length > 0,
    jsonLdTypes: jsonLdTypes($).types,
    unlabeledControls: u.buttons + u.links + u.inputs,
    hasDescription: !!meta($, "description"),
  };
}

function buildArtifacts(siteName: string, home: URL, $: $Doc, pages: PageResult[]) {
  const desc = meta($, "description") || meta($, "og:description") || `${siteName} website.`;
  const linkLines = pages
    .filter((p) => p.status >= 200 && p.status < 300)
    .map((p) => `- [${(p.title || new URL(p.url).pathname).replace(/[\[\]]/g, "")}](${p.url})`);
  const llmsTxt = [`# ${siteName}`, "", `> ${desc}`, "", "## Key pages", "", ...linkLines, "", "## Optional", "", `- [Sitemap](${home.origin}/sitemap.xml)`, ""].join("\n");

  const robotsTxt = [
    "# AI assistants fetching pages for a user",
    ...AI_AGENTS.user.map((b) => `User-agent: ${b}`), "Allow: /", "",
    "# AI search engines (cite and link to you)",
    ...AI_AGENTS.search.map((b) => `User-agent: ${b}`), "Allow: /", "",
    "# Model training crawlers: your call. Change Allow to Disallow to opt out.",
    ...AI_AGENTS.training.map((b) => `User-agent: ${b}`), "Allow: /", "",
    "User-agent: *", "Allow: /", "",
    `Sitemap: ${home.origin}/sitemap.xml`, "",
  ].join("\n");

  const logo = meta($, "og:image");
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${home.origin}/#org`, name: siteName, url: home.origin, ...(logo ? { logo } : {}), sameAs: [] },
      { "@type": "WebSite", "@id": `${home.origin}/#website`, name: siteName, url: home.origin, description: desc, publisher: { "@id": `${home.origin}/#org` } },
    ],
  }, null, 2);

  return { llmsTxt, robotsTxt, jsonLd: `<script type="application/ld+json">\n${jsonLd}\n</script>` };
}
