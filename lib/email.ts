import { Resend } from "resend";
import { reportMarkdown } from "./markdown";
import { reportPdf } from "./pdf";
import type { ScanResult } from "./types";

const FROM = process.env.EMAIL_FROM || "AgentScore <reports@checkagentscore.com>";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "hello@checkagentscore.com";

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export async function sendReportEmail(to: string, r: ScanResult, reportUrl: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const resend = new Resend(key);
  const host = new URL(r.finalUrl).hostname;
  const pdf = await reportPdf(r);
  const issues = r.checks.filter((c) => c.status === "fail" || c.status === "warn").length;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#16161a">
    <h1 style="font-size:22px;margin:0 0 8px">Your AgentScore report for ${esc(host)}</h1>
    <p style="font-size:40px;font-weight:800;margin:16px 0 4px">${r.score}/100 <span style="font-size:16px;font-weight:600;color:#6b6b76">Grade ${r.grade}</span></p>
    <p style="color:#6b6b76;margin:0 0 20px">${issues} issue${issues === 1 ? "" : "s"} found, each with a step-by-step fix.</p>
    <p><a href="${esc(reportUrl)}" style="display:inline-block;background:#2b2bd9;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open your full report</a></p>
    <p style="color:#6b6b76;font-size:14px">Your report is attached as a PDF, Markdown and raw JSON. Keep this email: the link above is your access to the report.</p>
    <p style="color:#6b6b76;font-size:14px">Questions? Just reply to this email.</p>
  </div>`;

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: REPLY_TO,
    subject: `Your AgentScore report for ${host}: ${r.score}/100`,
    html,
    text: `Your AgentScore report for ${host}: ${r.score}/100 (Grade ${r.grade}).\n\nOpen your full report: ${reportUrl}\n\nYour report is attached as a PDF, Markdown and raw JSON.\nQuestions? Reply to this email.`,
    attachments: [
      { filename: `agentscore-${host}.pdf`, content: Buffer.from(pdf) },
      { filename: `agentscore-${host}.md`, content: Buffer.from(reportMarkdown(r)) },
      { filename: `agentscore-${host}.json`, content: Buffer.from(JSON.stringify(r, null, 2)) },
    ],
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}
