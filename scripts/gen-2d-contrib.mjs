#!/usr/bin/env node
// Рисует плоский 2D-календарь вкладов (как у GitHub) в day.svg и night.svg.
// Зависимостей нет: только Node 20+, fetch и GitHub GraphQL API.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "conf", "profile-2d-contrib.json"), "utf8"));

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_REPOSITORY_OWNER || process.env.PROFILE_USERNAME;
const outDir = join(root, cfg.outputDir || "profile-2d-contrib");

if (!token) die("Не задан GITHUB_TOKEN");
if (!login) die("Не задан GITHUB_REPOSITORY_OWNER");

const to = new Date();
const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

const query = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
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
    "user-agent": "profile-2d-contrib",
  },
  body: JSON.stringify({
    query,
    variables: { login, from: from.toISOString(), to: to.toISOString() },
  }),
});

if (!res.ok) die(`GitHub API ответил ${res.status}: ${await res.text()}`);

const payload = await res.json();
if (payload.errors) die(`GraphQL: ${JSON.stringify(payload.errors)}`);

const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
if (!calendar) die(`Не удалось получить календарь для «${login}»`);

mkdirSync(outDir, { recursive: true });
for (const themeName of Object.keys(cfg.themes)) {
  const svg = render(calendar, cfg.themes[themeName], cfg);
  const file = join(outDir, `${themeName}.svg`);
  writeFileSync(file, svg, "utf8");
  console.log(`${file} — ${calendar.totalContributions} вкладов`);
}

function render(calendar, theme, cfg) {
  const { cell, gap, radius, labels } = cfg;
  const pad = 16;
  const leftPad = 26; // подписи дней недели
  const topPad = 18; // подписи месяцев
  const legendH = 22;

  const cols = calendar.weeks.length;
  const rows = 7;
  const gridW = cols * cell + (cols - 1) * gap;
  const gridH = rows * cell + (rows - 1) * gap;
  const width = pad * 2 + leftPad + gridW;
  const height = pad * 2 + topPad + gridH + legendH;

  const levels = thresholds(calendar.weeks);
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="График вкладов за год">`,
    `<title>График вкладов за год</title>`,
    `<rect width="${width}" height="${height}" fill="${theme.background}"/>`,
  );

  // Месяцы: подпись над колонкой, где встречается 1-е число.
  const monthNames = labels.months;
  let lastLabelX = -Infinity;
  calendar.weeks.forEach((week, w) => {
    const first = week.contributionDays.find((d) => dayOfMonth(d.date) === 1);
    if (!first) return;
    const x = pad + leftPad + w * (cell + gap);
    if (x - lastLabelX < 26) return;
    lastLabelX = x;
    const name = monthNames[monthOf(first.date)];
    parts.push(text(x, pad + topPad - 6, name, theme.text, 10));
  });

  // Дни недели слева: Пн, Ср, Пт.
  for (const [row, name] of Object.entries(labels.weekdays)) {
    const y = pad + topPad + Number(row) * (cell + gap) + cell - 2;
    parts.push(
      `<text x="${pad + leftPad - 6}" y="${y}" fill="${theme.text}" font-size="10" font-family="${cfg.font}" text-anchor="end">${name}</text>`,
    );
  }

  // Сетка.
  calendar.weeks.forEach((week, w) => {
    week.contributionDays.forEach((day, d) => {
      const x = pad + leftPad + w * (cell + gap);
      const y = pad + topPad + d * (cell + gap);
      const level = levelOf(day.contributionCount, levels);
      parts.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${radius}" fill="${theme.levels[level]}"><title>${day.date}: ${day.contributionCount}</title></rect>`,
      );
    });
  });

  // Легенда: Меньше → Больше.
  const legendY = height - pad - cell;
  const small = 10;
  const textW = (s) => Math.ceil(s.length * 5.4);
  const legendW = textW(labels.less) + 6 + 5 * cell + 4 * gap + 6 + textW(labels.more);
  let lx = width - pad - legendW;

  parts.push(text(lx, legendY + cell - 2, labels.less, theme.text, small));
  lx += textW(labels.less) + 6;
  theme.levels.forEach((color) => {
    parts.push(
      `<rect x="${lx}" y="${legendY}" width="${cell}" height="${cell}" rx="${radius}" fill="${color}"/>`,
    );
    lx += cell + gap;
  });
  lx += 6 - gap;
  parts.push(text(lx, legendY + cell - 2, labels.more, theme.text, small));

  parts.push("</svg>");
  return parts.join("");
}

function text(x, y, value, fill, size) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">${value}</text>`;
}

// Пороговые значения уровней — по квартилям непустых дней, как у GitHub.
function thresholds(weeks) {
  const counts = weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => d.contributionCount)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);

  if (counts.length === 0) return [0, 0, 0];
  const q = (p) => counts[Math.floor(p * (counts.length - 1))];
  return [q(0.25), q(0.5), q(0.75)];
}

function levelOf(count, [q1, q2, q3]) {
  if (count <= 0) return 0;
  if (count <= q1) return 1;
  if (count <= q2) return 2;
  if (count <= q3) return 3;
  return 4;
}

function monthOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCMonth();
}

function dayOfMonth(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDate();
}

function die(message) {
  console.error(message);
  process.exit(1);
}
