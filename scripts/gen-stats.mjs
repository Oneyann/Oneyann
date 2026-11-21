#!/usr/bin/env node
// Рисует пиксель-арт карточку «языки + цифры» с деревом и падающими листьями.
// Выход: day.svg и night.svg. Зависимостей нет: Node 20+, fetch и GitHub GraphQL API.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measure, textPath } from "./pixel-font.mjs";

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
  const headerY = 30;
  const rowH = 52;
  const rowsTop = 70;
  const footerGap = 96;
  const rows = stats.languages.length;

  const width = cfg.width;
  const height = Math.max(cfg.minHeight, rowsTop + rows * rowH + footerGap);

  const panelX = cfg.sceneWidth + pad;
  const panelRight = width - pad;
  const panelW = panelRight - panelX;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Языки и статистика" shape-rendering="crispEdges">`,
    `<title>Языки и статистика</title>`,
    `<style>@media (prefers-reduced-motion: reduce){.leaf{display:none}}</style>`,
    `<rect width="${width}" height="${height}" fill="${theme.background}"/>`,
    scene(theme, cfg, width, height),
  ];

  parts.push(path(panelX, headerY, cfg.labels.title, 2, theme.muted));

  const blockW = 6;
  const blockGap = 3;
  const blocks = Math.floor((panelW + blockGap) / (blockW + blockGap));

  stats.languages.forEach((lang, i) => {
    const y = rowsTop + i * rowH;
    const pct = `${formatPct(lang.pct)}%`;
    const pctW = measure(pct, 2);
    const name = fit(lang.name.toUpperCase(), 2, panelW - pctW - 14);

    parts.push(path(panelX, y, name, 2, theme.text));
    parts.push(path(panelRight, y, pct, 2, theme.muted, "end"));

    const barY = y + 24;
    const filled = Math.round((blocks * lang.pct) / 100);
    const bar = [];
    for (let b = 0; b < blocks; b++) {
      const bx = panelX + b * (blockW + blockGap);
      bar.push(`<rect x="${bx}" y="${barY}" width="${blockW}" height="${blockW}"/>`);
    }
    parts.push(`<g fill="${theme.track}">${bar.slice(filled).join("")}</g>`);
    parts.push(`<g fill="${lang.color || theme.muted}">${bar.slice(0, filled).join("")}</g>`);
  });

  const counters = [
    `${stats.repos} ${pluralForm(stats.repos, cfg.labels.repos)} · ${stats.stars} ${pluralForm(stats.stars, cfg.labels.stars)}`,
    `${stats.contribs} ${pluralForm(stats.contribs, cfg.labels.contribs)} за год`,
  ];
  counters.forEach((line, i) => {
    parts.push(path(panelX, height - 78 + i * 24, line.toUpperCase(), 2, i === 0 ? theme.text : theme.muted));
  });

  parts.push("</svg>");
  return parts.join("");
}

// Сцена: земля, дерево с покачиванием и падающие листья.
function scene(theme, cfg, width, height) {
  const p = cfg.pixel;
  const sceneW = cfg.sceneWidth;
  const groundY = height - 26;

  const trunkW = 5 * p;
  const trunkH = 10 * p;
  const trunkX = Math.round((sceneW / 2 - trunkW / 2) / p) * p;
  const trunkY = groundY - trunkH;

  const canopy = cfg.canopy;
  const canopyW = canopy[0].length * p;
  const canopyX = Math.round((sceneW / 2 - canopyW / 2) / p) * p;
  const canopyY = trunkY - canopy.length * p + p * 2;

  const parts = [
    `<rect x="0" y="${groundY}" width="${width}" height="${height - groundY}" fill="${theme.ground}"/>`,
  ];

  // Травинки-пиксели на земле.
  for (let i = 0; i < 24; i++) {
    const gx = (i * 23) % (width - 8);
    const gy = groundY + p + ((i * 7) % 3) * p;
    parts.push(`<rect x="${gx}" y="${gy}" width="${p}" height="${p}" fill="${theme.groundDark}"/>`);
  }

  parts.push(`<rect x="${trunkX}" y="${trunkY}" width="${p}" height="${trunkH}" fill="${theme.trunkDark}"/>`);
  parts.push(
    `<rect x="${trunkX + p}" y="${trunkY}" width="${trunkW - p}" height="${trunkH}" fill="${theme.trunk}"/>`,
  );
  parts.push(
    `<rect x="${trunkX - p * 2}" y="${trunkY + p * 3}" width="${p * 2}" height="${p}" fill="${theme.trunk}"/>`,
    `<rect x="${trunkX + trunkW}" y="${trunkY + p * 4}" width="${p * 2}" height="${p}" fill="${theme.trunk}"/>`,
  );

  const groups = [[], [], []];
  const rnd = mulberry32(20261121);
  canopy.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== "#") continue;
      const roll = rnd();
      const tone = r >= canopy.length - 3 ? 0 : roll < 0.15 ? 0 : roll < 0.7 ? 1 : 2;
      groups[tone].push(
        `<rect x="${canopyX + c * p}" y="${canopyY + r * p}" width="${p}" height="${p}"/>`,
      );
    }
  });

  parts.push(
    `<g><animateTransform attributeName="transform" type="translate" values="0 0;${p} 0;0 0;-${p} 0;0 0" dur="8s" repeatCount="indefinite"/>${groups
      .map((cells, i) => `<g fill="${theme.canopy[i]}">${cells.join("")}</g>`)
      .join("")}</g>`,
  );

  parts.push(leaves(theme, cfg, canopyY, groundY, sceneW));

  // Упавшие листья на земле.
  for (let i = 0; i < 7; i++) {
    const fx = 12 + ((i * 61) % (width - 26));
    parts.push(
      `<rect x="${fx}" y="${groundY + p * 2}" width="${p}" height="${p - 1}" fill="${theme.leaves[(i + 1) % theme.leaves.length]}"/>`,
    );
  }

  return parts.join("");
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function leaves(theme, cfg, canopyY, groundY, sceneW) {
  const out = [];
  const count = cfg.leafCount;

  for (let i = 0; i < count; i++) {
    const startX = 18 + ((i * 23) % (sceneW - 36));
    const startY = canopyY + 30 + ((i * 17) % 40);
    const fall = Math.max(30, groundY - startY + 4);
    const drift = 8 + (i % 3) * 5;
    const size = i % 3 === 0 ? 4 : 3;
    const color = theme.leaves[i % theme.leaves.length];
    const dur = 6 + (i % 4);
    const begin = -(i * 0.85);

    const path = `M0 0C${-drift} ${fall * 0.25} ${drift} ${fall * 0.45} ${-drift / 2} ${fall * 0.6}C${-drift * 1.4} ${fall * 0.75} ${drift / 2} ${fall * 0.9} 0 ${fall}`;

    out.push(
      `<g class="leaf" transform="translate(${startX} ${startY})">` +
        `<rect width="${size}" height="${size}" fill="${color}">` +
        `<animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${path}" rotate="auto"/>` +
        `<animate attributeName="opacity" values="0;1;1;1;0" keyTimes="0;0.08;0.75;0.92;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
        `</rect></g>`,
    );
  }

  return out.join("");
}

function path(x, y, value, scale, fill, anchor = "start") {
  const { d } = textPath(value, x, y, scale, anchor);
  return d ? `<path d="${d}" fill="${fill}"/>` : "";
}

function fit(text, scale, maxWidth) {
  if (measure(text, scale) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}.`, scale) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}.`;
}

function formatPct(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

// Русские формы множественного числа: 1 репозиторий, 2 репозитория, 5 репозиториев.
function pluralForm(count, forms) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function die(message) {
  console.error(message);
  process.exit(1);
}
