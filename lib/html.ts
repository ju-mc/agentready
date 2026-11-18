import * as cheerio from "cheerio";

export type $Doc = cheerio.CheerioAPI;

export function load(html: string): $Doc {
  return cheerio.load(html);
}

/** Visible text an agent gets without executing JavaScript. */
export function visibleText($: $Doc): string {
  const clone = cheerio.load($.html());
  clone("script, style, noscript, template, svg, iframe, head").remove();
  return clone("body").text().replace(/\s+/g, " ").trim();
}

export function wordCount(text: string): number {
  return text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

export function jsonLdTypes($: $Doc): { types: string[]; invalid: number; blocks: number } {
  const types = new Set<string>();
  let invalid = 0;
  const scripts = $('script[type="application/ld+json"]');
  const collect = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const t = obj["@type"];
      if (typeof t === "string") types.add(t);
      if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
      if (obj["@graph"]) collect(obj["@graph"]);
    }
  };
  scripts.each((_, el) => {
    try {
      collect(JSON.parse($(el).text()));
    } catch {
      invalid++;
    }
  });
  return { types: [...types], invalid, blocks: scripts.length };
}

/** Interactive elements with no accessible name (what browser agents "see"). */
export function unlabeledControls($: $Doc): { buttons: number; links: number; inputs: number; clickableDivs: number; examples: string[] } {
  const examples: string[] = [];
  const hasName = (el: cheerio.Cheerio<any>) => {
    const text = el.text().replace(/\s+/g, " ").trim();
    if (text) return true;
    if (el.attr("aria-label")?.trim() || el.attr("aria-labelledby") || el.attr("title")?.trim()) return true;
    if (el.find("img[alt]").filter((_, i) => !!$(i).attr("alt")?.trim()).length) return true;
    if (el.find("svg title").length || el.find("[aria-label]").length) return true;
    return false;
  };
  const snippet = (el: cheerio.Cheerio<any>) => ($.html(el) ?? "").replace(/\s+/g, " ").slice(0, 140);

  let buttons = 0;
  $('button, [role="button"], input[type="submit"], input[type="button"]').each((_, e) => {
    const el = $(e);
    if (el.is("input") && el.attr("value")?.trim()) return;
    if (!hasName(el)) {
      buttons++;
      if (examples.length < 5) examples.push(snippet(el));
    }
  });

  let links = 0;
  $("a[href]").each((_, e) => {
    const el = $(e);
    if (!hasName(el)) {
      links++;
      if (examples.length < 5) examples.push(snippet(el));
    }
  });

  let inputs = 0;
  $("input, select, textarea").each((_, e) => {
    const el = $(e);
    const type = (el.attr("type") || "text").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
    const id = el.attr("id");
    const labeled =
      (id && $(`label[for="${id.replace(/"/g, '\\"')}"]`).length > 0) ||
      el.closest("label").length > 0 ||
      !!el.attr("aria-label")?.trim() ||
      !!el.attr("aria-labelledby") ||
      !!el.attr("title")?.trim() ||
      !!el.attr("placeholder")?.trim();
    if (!labeled) {
      inputs++;
      if (examples.length < 5) examples.push(snippet(el));
    }
  });

  const clickableDivs = $("div[onclick], span[onclick]").filter((_, e) => !$(e).attr("role")).length;
  return { buttons, links, inputs, clickableDivs, examples };
}

export function meta($: $Doc, name: string): string {
  return (
    $(`meta[name="${name}"]`).attr("content") ??
    $(`meta[property="${name}"]`).attr("content") ??
    ""
  ).trim();
}
