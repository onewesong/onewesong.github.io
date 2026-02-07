const fs = require("node:fs");
const path = require("node:path");

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set.");
  }
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(body, heading) {
  const re = new RegExp(
    `^###\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n###\\s+|\\n?$)`,
    "m",
  );
  const match = body.match(re);
  return (match?.[1] ?? "").trim();
}

function splitList(value) {
  return value
    .split(/[,\n]/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function yamlDoubleQuoted(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function sanitizeFilenameBase(title) {
  let name = String(title ?? "").trim();
  name = name.replace(/[\u0000-\u001f]/g, "");
  name = name.replace(/[\\/:*?"<>|]/g, "-");
  name = name.replace(/\s+/g, " ").trim();
  name = name.replace(/\.+$/g, "");
  name = name.slice(0, 120).trim();
  if (!name) return "";
  return name;
}

function findExistingPostByIssueNumber(postsDir, issueNumber) {
  const files = fs.readdirSync(postsDir, { withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    const fullPath = path.join(postsDir, entry.name);
    const content = fs.readFileSync(fullPath, "utf8");
    if (new RegExp(`^issue:\\s*${issueNumber}\\s*$`, "m").test(content)) {
      return fullPath;
    }
  }
  return null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildFrontMatter({ title, dateText, tags, categories, issueNumber }) {
  const lines = ["---"];
  lines.push(`title: ${yamlDoubleQuoted(title)}`);
  lines.push(`date: ${dateText}`);
  lines.push(`issue: ${issueNumber}`);
  if (tags.length > 0) {
    lines.push("tags:");
    for (const tag of tags) lines.push(`  - ${yamlDoubleQuoted(tag)}`);
  }
  if (categories.length > 0) {
    lines.push("categories:");
    for (const category of categories) lines.push(`  - ${yamlDoubleQuoted(category)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function main() {
  const event = readEvent();
  const issue = event?.issue;
  if (!issue) throw new Error("This workflow expects an issues event payload.");

  const issueNumber = issue.number;
  const title = String(issue.title ?? "").trim();
  const body = String(issue.body ?? "");

  const contentFromForm = extractSection(body, "正文");
  const tagsFromForm = extractSection(body, "标签（tags）");
  const categoriesFromForm = extractSection(body, "分类（categories）");
  const dateFromForm = extractSection(body, "发布时间（可选）");

  const content = (contentFromForm || body).trim();
  const tags = splitList(tagsFromForm);
  const categories = splitList(categoriesFromForm);

  const dateText = String(dateFromForm ?? "").trim() || formatDateTime(new Date());

  const postsDir = path.join(process.cwd(), "source", "_posts");
  ensureDir(postsDir);

  const existingPostPath = findExistingPostByIssueNumber(postsDir, issueNumber);

  const filenameBase = sanitizeFilenameBase(title) || `issue-${issueNumber}`;
  let targetPath = path.join(postsDir, `${filenameBase}.md`);

  if (fs.existsSync(targetPath)) {
    const existingTarget = fs.readFileSync(targetPath, "utf8");
    const isSameIssue = new RegExp(`^issue:\\s*${issueNumber}\\s*$`, "m").test(existingTarget);
    if (!isSameIssue && targetPath !== existingPostPath) {
      targetPath = path.join(postsDir, `${filenameBase}-${issueNumber}.md`);
    }
  }

  if (existingPostPath && existingPostPath !== targetPath) {
    if (!fs.existsSync(targetPath)) {
      fs.renameSync(existingPostPath, targetPath);
    }
  }

  const frontMatter = buildFrontMatter({
    title,
    dateText,
    tags,
    categories,
    issueNumber,
  });

  const fullContent = `${frontMatter}\n\n${content}\n`;
  fs.writeFileSync(targetPath, fullContent, "utf8");

  console.log(`Wrote: ${path.relative(process.cwd(), targetPath)}`);
}

main();
