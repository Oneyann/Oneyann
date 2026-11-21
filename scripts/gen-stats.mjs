#!/usr/bin/env node
// Рисует карточку «языки + цифры» в day.svg и night.svg.
// Зависимостей нет: только Node 20+, fetch и GitHub GraphQL API.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "conf", "profile-stats.json"), "utf8"));

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_REPOSITORY_OWNER || process.env.PROFILE_USERNAME;
const outDir = join(root, cfg.outputDir || "profile-stats");

if (!token) die("Не задан GITHUB_TOKEN");
if (!login) die("Не задан GITHUB_REPOSITORY_OWNER");

const to = new Date();
const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

const query = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      repositories(first: 100, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    authorization: `bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "profile-stats",
  },
  body: JSON.stringify({
    query,
    variables: { login, from: from.toISOString(), to: to.toISOString() },
  }),
});

if (!res.ok) die(`GitHub API ответил ${res.status}: ${await res.text()}`);

const payload = await res.json();
if (payload.errors) die(`GraphQL: ${JSON.stringify(payload.errors)}`);

const user = payload.data?.user;
if (!user) die(`Не удалось получить данные для «${login}»`);

const repos = user.repositories.nodes;
const stats = {
  repos: user.repositories.totalCount,
  stars: repos.reduce((sum, r) => sum + r.stargazerCount, 0),
  contribs: user.contributionsCollection.contributionCalendar.totalContributions,
  languages: languagesOf(repos, cfg.maxLanguages),
};

mkdirSync(outDir, { recursive: true });
for (const themeName of Object.keys(cfg.themes)) {
  const svg = render(stats, cfg.themes[themeName], cfg);
  const file = join(outDir, `${themeName}.svg`);
  writeFileSync(file, svg, "utf8");
  console.log(`${file} — ${stats.languages.map((l) => `${l.name} ${l.pct}%`).join(", ")}`);
}

// Суммируем байты по языкам и оставляем верхние, остальное — «Другое».
function languagesOf(repos, limit) {
  const byName = new Map();
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      const current = byName.get(edge.node.name) || { size: 0, color: edge.node.color };
      current.size += edge.size;
      byName.set(edge.node.name, current);
    }
  }

  const sorted = [...byName.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.size - a.size);

  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  if (tail.length > 0) {
    head.push({
      name: cfg.labels.other,
      size: tail.reduce((sum, l) => sum + l.size, 0),
      color: cfg.labels.otherColor,
    });
  }

  const total = head.reduce((sum, l) => sum + l.size, 0) || 1;
  return head.map((l) => ({ ...l, pct: Math.round((l.size / total) * 1000) / 10 }));
}

function render(stats, theme, cfg) {
  const pad = 16;
  const rowH = 26;
  const barH = 4;
  const headerH = 18;
  const innerW = cfg.width - pad * 2;
  const rows = stats.languages.length;
  const footerH = 22;
  const height = pad * 2 + headerH + rows * rowH + footerH;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.width}" height="${height}" viewBox="0 0 ${cfg.width} ${height}" role="img" aria-label="Языки и статистика">`,
    `<title>Языки и статистика</title>`,
    `<rect width="${cfg.width}" height="${height}" fill="${theme.background}"/>`,
  ];

  stats.languages.forEach((lang, i) => {
    const y = pad + headerH + i * rowH;
    const pct = `${formatPct(lang.pct)}%`;
    parts.push(
      text(pad, y + 9, lang.name, theme.text, 11, cfg.font),
      text(cfg.width - pad, y + 9, pct, theme.muted, 11, cfg.font, "end"),
      `<rect x="${pad}" y="${y + 15}" width="${innerW}" height="${barH}" rx="2" fill="${theme.track}"/>`,
      `<rect x="${pad}" y="${y + 15}" width="${Math.max(3, Math.round((innerW * lang.pct) / 100))}" height="${barH}" rx="2" fill="${lang.color || theme.muted}"/>`,
    );
  });

  const footer = [
    plural(stats.repos, cfg.labels.repos),
    plural(stats.stars, cfg.labels.stars),
    plural(stats.contribs, cfg.labels.contribs),
  ].join(" · ");

  parts.push(
    text(pad, pad + 10, cfg.labels.title, theme.muted, 11, cfg.font),
    text(pad, pad + headerH + rows * rowH + 12, footer, theme.muted, 10, cfg.font),
  );
  parts.push("</svg>");
  return parts.join("");
}

function text(x, y, value, fill, size, font, anchor) {
  const anchorAttr = anchor ? ` text-anchor="${anchor}"` : "";
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="${font}"${anchorAttr}>${value}</text>`;
}

function formatPct(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

// Русские формы множественного числа: 1 репозиторий, 2 репозитория, 5 репозиториев.
function plural(count, forms) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  let form = forms[2];
  if (mod10 === 1 && mod100 !== 11) form = forms[0];
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) form = forms[1];
  return `${count} ${form}`;
}

function die(message) {
  console.error(message);
  process.exit(1);
}
