import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();

async function loadIssues() {
    const { stdout } = await execFileAsync("gh", [
        "issue", "list", "--state", "open", "--limit", "100",
        "--json", "number,title,body,labels,assignees,comments,updatedAt,url",
    ], { cwd: process.cwd() });
    return JSON.parse(stdout);
}

function rankIssue(issue) {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    let score = 0;
    if (labels.some((label) => ["urgent", "p0", "critical", "security"].includes(label))) score += 100;
    if (labels.some((label) => ["bug", "regression", "blocked"].includes(label))) score += 40;
    if (issue.assignees.length === 0) score += 20;
    score += Math.min(issue.comments, 10);
    score += Math.max(0, 14 - Math.floor((Date.now() - Date.parse(issue.updatedAt)) / 86400000));
    return score;
}

function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function issueCard(issue, isPriority) {
    const labels = issue.labels.map((label) => `<span class="label">${escapeHtml(label.name)}</span>`).join("");
    const why = isPriority ? `<p class="why"><strong>Why now:</strong> ${escapeHtml(issue.justification)}</p>` : "";
    return `<article class="card${isPriority ? " priority" : ""}">
      <div class="card-header"><span class="issue-number">#${issue.number}</span><span class="updated">Updated ${new Date(issue.updatedAt).toLocaleDateString()}</span></div>
      <h3><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
      <p class="description">${escapeHtml(issue.body || "No description provided.")}</p>
      <div class="labels">${labels || '<span class="label muted">unlabeled</span>'}</div>${why}
      <button data-issue-number="${issue.number}">Add to current context</button>
    </article>`;
}

function renderHtml(issues) {
    const priority = issues.slice(0, 3);
    const remainder = issues.slice(3);
    const cards = (items, isPriority) => items.length
        ? items.map((issue) => issueCard(issue, isPriority)).join("")
        : '<p class="empty">No issues in this section.</p>';
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Issue triage</title>
<style>
:root { color-scheme: light dark; --bg: var(--background-color-default, #fff); --text: var(--text-color-default, #1f2328); --muted: var(--text-color-muted, #656d76); --border: var(--border-color-default, #d0d7de); --accent: var(--true-color-blue, #0969da); --accent-muted: var(--true-color-blue-muted, #ddf4ff); }
* { box-sizing: border-box; } body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font-sans, system-ui, sans-serif); }
h1 { margin: 0 0 4px; font-size: 24px; } h2 { margin: 28px 0 12px; font-size: 16px; } .subtitle, .updated, .empty { color: var(--muted); }
.grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); } .card { border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
.priority { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-muted); } .card-header { display: flex; justify-content: space-between; gap: 8px; }
.issue-number { color: var(--accent); font-weight: 600; } .updated { font-size: 12px; } h3 { margin: 8px 0; font-size: 16px; } a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
.description { color: var(--muted); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; min-height: 84px; }
.labels { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; } .label { background: var(--accent-muted); border-radius: 999px; padding: 2px 8px; font-size: 12px; } .label.muted { background: var(--border); }
.why { border-left: 3px solid var(--accent); padding-left: 10px; } button { border: 0; border-radius: 6px; padding: 8px 12px; background: var(--accent); color: white; cursor: pointer; font-weight: 600; } button:disabled { opacity: .6; cursor: wait; }
.notice { min-height: 22px; color: var(--muted); margin: 8px 0 0; }
</style></head><body>
<h1>Issue triage</h1><p class="subtitle">The three issues most likely to need attention right now.</p>
<div id="notice" class="notice" role="status" aria-live="polite"></div>
<h2>Priority queue</h2><section class="grid">${cards(priority, true)}</section>
<h2>Remaining open issues</h2><section class="grid">${cards(remainder, false)}</section>
<script>
document.querySelectorAll("button[data-issue-number]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true; document.querySelector("#notice").textContent = "Adding issue to the current context...";
    try {
      const response = await fetch("/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: button.dataset.issueNumber }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to add issue");
      document.querySelector("#notice").textContent = result.message;
    } catch (error) { document.querySelector("#notice").textContent = error.message; button.disabled = false; }
  });
});
</script></body></html>`;
}

async function startServer(instanceId, session) {
    const issues = (await loadIssues()).map((issue) => ({ ...issue, score: rankIssue(issue) }))
        .sort((a, b) => b.score - a.score || b.number - a.number);
    const reasons = [
        "It combines urgency or risk signals with recent activity.",
        "It is active and currently lacks an assignee, so it may be waiting for ownership.",
        "Its labels and recent discussion suggest it could be blocking other work.",
    ];
    issues.slice(0, 3).forEach((issue, index) => { issue.justification = reasons[index]; });
    const server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/context") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const { number } = JSON.parse(body);
                    const issue = issues.find((candidate) => String(candidate.number) === String(number));
                    if (!issue) throw new Error("Issue not found.");
                    await session.send({ prompt: `Add issue #${issue.number} to the current context and help me work on it. Title: ${issue.title}. Description: ${issue.body || "No description provided."} URL: ${issue.url}` });
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ message: `Issue #${issue.number} added to the current context.` }));
                } catch (error) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(issues));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return { server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/` };
}

const session = await joinSession({
    canvases: [createCanvas({
        id: "kanban-triage",
        displayName: "Issue triage board",
        description: "Prioritized Kanban-style board for triaging open repository issues.",
        open: async (ctx) => {
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = await startServer(ctx.instanceId, session);
                servers.set(ctx.instanceId, entry);
            }
            return { title: "Issue triage", url: entry.url };
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            if (entry) {
                servers.delete(ctx.instanceId);
                await new Promise((resolve) => entry.server.close(resolve));
            }
        },
    })],
});
