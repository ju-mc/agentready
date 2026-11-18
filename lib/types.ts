export type Status = "pass" | "warn" | "fail" | "info";
export type CategoryId = "access" | "discoverability" | "readability" | "structure" | "actionability";

export const CATEGORIES: Record<CategoryId, { label: string; blurb: string }> = {
  access: { label: "Access", blurb: "Can AI agents reach the site at all?" },
  discoverability: { label: "Discoverability", blurb: "Can agents find and identify your important pages?" },
  readability: { label: "Readability", blurb: "Can agents read your content without running a browser?" },
  structure: { label: "Structured data", blurb: "Is your content labeled in machine-readable formats?" },
  actionability: { label: "Actionability", blurb: "Can browser agents operate your UI and APIs?" },
};

export interface Check {
  id: string;
  category: CategoryId;
  title: string;
  status: Status;
  earned: number;
  max: number;
  /** One-line result. Shown in the free scan for top issues only. */
  summary: string;
  /** Paid: why it matters + what was found. */
  detail?: string;
  /** Paid: how to fix. */
  fix?: string;
  /** Paid: copy-pasteable snippet. */
  snippet?: string;
  evidence?: string[];
}

export interface PageResult {
  url: string;
  status: number;
  words: number;
  title: string;
  hasH1: boolean;
  jsonLdTypes: string[];
  unlabeledControls: number;
  hasDescription: boolean;
}

export interface ScanResult {
  url: string;
  finalUrl: string;
  scannedAt: string;
  siteName: string;
  score: number;
  grade: string;
  categories: Record<CategoryId, { score: number; earned: number; max: number }>;
  checks: Check[];
  pages?: PageResult[];
  artifacts?: { llmsTxt: string; robotsTxt: string; jsonLd: string };
}

/** What the free scan exposes — no details, fixes, or full check list. */
export interface FreeScanResult {
  url: string;
  finalUrl: string;
  scannedAt: string;
  siteName: string;
  score: number;
  grade: string;
  categories: ScanResult["categories"];
  counts: { pass: number; warn: number; fail: number; total: number };
  topIssues: { title: string; status: Status; summary: string; category: CategoryId }[];
  lockedIssues: number;
}
