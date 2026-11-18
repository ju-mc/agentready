import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy — AgentScore" };

export default function Privacy() {
  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      <h1>Privacy</h1>
      <p className="muted small">Last updated: November 18, 2026</p>

      <h2>What we collect</h2>
      <p><strong>Websites you scan.</strong> When you run a scan, we fetch publicly available pages from the website you enter (like its homepage, robots.txt and sitemap), the same way a search engine or AI assistant would. We only read public pages. We don&apos;t log in, submit forms, or access anything private.</p>
      <p><strong>Scan results.</strong> Results are generated on demand. They may be held in temporary server memory for up to an hour so reloads and downloads are fast. We don&apos;t keep a database of scans.</p>
      <p><strong>IP address.</strong> We briefly use your IP address to limit how many scans one visitor can run, to prevent abuse. It isn&apos;t stored long term.</p>

      <h2>Payments</h2>
      <p>Payments are handled by <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">Stripe</a>. We never see or store your card details. Stripe shares your email address and payment status with us so we can deliver and support your report.</p>

      <h2>Analytics and traffic verification</h2>
      <p>We use a third-party analytics script to understand how visitors find us (for example, which site referred you). It may collect standard visit data such as pages viewed, referrer, browser type and approximate location.</p>

      <h2>Hosting</h2>
      <p>The site is hosted on <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer">Vercel</a>, which keeps standard server logs.</p>

      <h2>Cookies</h2>
      <p>We don&apos;t set our own tracking or advertising cookies. Third-party services above may use their own.</p>

      <h2>We don&apos;t sell your data</h2>
      <p>We don&apos;t sell or rent personal information to anyone.</p>

      <h2>Contact</h2>
      <p>Questions or deletion requests: reach out through <a href="https://checkagentscore.com">checkagentscore.com</a>.</p>

      <p style={{ marginTop: 40 }}><a href="/">← Back to AgentScore</a></p>
    </main>
  );
}
