(function () {
  "use strict";

  const DAY_MS = 86_400_000;
  const MAX_SCORE = 30;
  const DEFAULT_TARGET = 20;
  const sections = [
    { id: "terms", title: "Карточки по терминологии", max: 10, modes: ["vocab", "definitions", "abbreviations"] },
    { id: "topics", title: "Ответы по темам", max: 12, modes: ["topics"] },
    { id: "passages", title: "Перевод с листа", max: 8, modes: ["passages"] },
  ];
  const formats = {
    vocab: { label: "Перевод терминов", minutes: 0.5 },
    definitions: { label: "Определения", minutes: 1 },
    abbreviations: { label: "Аббревиатуры", minutes: 0.5 },
    topics: { label: "Ответы по темам", minutes: 2.5 },
    passages: { label: "Перевод с листа", minutes: 3.5 },
  };
  const modeIds = new Set(Object.keys(formats));
  const additionalCards = [
    "vocab", "definitions", "abbreviations", "topics", "vocab", "passages", "definitions", "abbreviations", "vocab", "vocab",
    "vocab", "abbreviations", "definitions", "topics", "vocab", "passages", "definitions", "abbreviations", "vocab", "vocab",
  ];
  const moscowDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  });

  function dateValue(value) {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") return Date.parse(value);
    return NaN;
  }

  function dayKey(value = Date.now()) {
    const time = dateValue(value);
    if (!Number.isFinite(time)) return "";
    const parts = Object.fromEntries(moscowDate.formatToParts(time).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function normalizeTarget(value) {
    const score = value === "" || value == null ? NaN : Number(value);
    if (!Number.isFinite(score)) return DEFAULT_TARGET;
    return Math.min(MAX_SCORE, Math.max(10, Math.round(score)));
  }

  function validParts(parts) {
    return Array.isArray(parts) && parts.length === sections.length &&
      parts.every((score, index) => Number.isFinite(score) && score >= 0 && score <= sections[index].max);
  }

  function latestMock(history = [], now = Date.now()) {
    let latest = null;
    for (const row of Array.isArray(history) ? history : []) {
      if (!row || row.preliminary || !validParts(row.parts)) continue;
      const time = dateValue(row.at);
      if (!Number.isFinite(time) || time > now || (latest && time <= latest.time)) continue;
      const parts = row.parts.slice();
      latest = { at: row.at, mode: row.mode ?? "written", parts, time, total: parts.reduce((total, score) => total + score, 0) };
    }
    return latest;
  }

  function record(ledger = {}, { id, mode, reviewed } = {}, now = Date.now()) {
    const stamp = dateValue(now);
    const day = dayKey(stamp);
    if (typeof id !== "string" || !id || !modeIds.has(mode) || !day) return ledger;
    const before = ledger?.days?.[day] ?? {};
    const previous = Object.hasOwn(before, id) ? before[id] : null;
    const firstAt = Number.isFinite(ledger?.startedAt) ? Math.min(ledger.startedAt, stamp) : stamp;
    const saved = { mode, reviewed: previous?.reviewed === true || reviewed === true, at: Math.max(previous?.at ?? stamp, stamp) };
    return { ...ledger, startedAt: firstAt, days: { ...ledger?.days, [day]: { ...before, [id]: saved } } };
  }

  function completedToday(progress, ledger, today, now) {
    const done = new Map();
    for (const [id, card] of Object.entries(ledger?.days?.[today] ?? {})) {
      if (modeIds.has(card?.mode)) done.set(id, { mode: card.mode, reviewed: card.reviewed === true });
    }
    const boundary = Number.isFinite(ledger?.startedAt) ? ledger.startedAt : Infinity;
    for (const [id, card] of Object.entries(progress?.items ?? {})) {
      if (done.has(id) || !Number.isFinite(card?.lastAt) || card.lastAt > now || card.lastAt >= boundary || dayKey(card.lastAt) !== today) continue;
      if (card.helped && card.outcome === "incorrect") continue;
      const mode = id.split(":", 1)[0];
      if (modeIds.has(mode)) done.set(id, { mode, reviewed: false });
    }
    return done;
  }

  function daysTo(date, today) {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const timestamp = Date.parse(date + "T00:00:00+03:00");
    if (!Number.isFinite(timestamp) || dayKey(timestamp) !== date) return null;
    return Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
  }

  function weakestSection(baseline) {
    if (!baseline) return "terms";
    return sections.map((section, index) => ({ id: section.id, ratio: baseline.parts[index] / section.max }))
      .sort((first, second) => first.ratio - second.ratio)[0].id;
  }

  function practicePlan(target, focus, needsPractice, today) {
    const quota = Object.fromEntries([...modeIds].map((mode) => [mode, 1]));
    const extras = additionalCards.slice(0, target - 10);
    // Add one exercise per target point. An extra short card can make room for practice in the measured weak section.
    if (needsPractice && extras.length > 8) {
      extras[8] = focus === "terms" ? "definitions" : focus;
      if (focus === "passages" && extras.length > 15) extras[15] = "vocab";
    }
    for (const mode of extras) quota[mode]++;

    const counts = Object.fromEntries([...modeIds].map((mode) => [mode, 0]));
    for (const { mode } of today.values()) counts[mode]++;
    return Object.keys(formats).map((mode) => ({
      mode, label: formats[mode].label, count: quota[mode], done: Math.min(quota[mode], counts[mode]),
    }));
  }

  function taskPlan(baseline, focus, practice, progress, today, day, now) {
    const material = sections.map((section) => {
      const parts = practice.filter(({ mode }) => section.modes.includes(mode));
      const next = parts.reduce((best, part) => part.done / part.count < best.done / best.count ? part : best);
      return {
        id: section.id, label: section.title, mode: next.mode,
        count: parts.reduce((sum, part) => sum + part.count, 0),
        done: parts.reduce((sum, part) => sum + part.done, 0),
        ...(section.id === "terms" ? { parts } : {}),
      };
    });
    material.sort((first, second) => Number(second.id === focus) - Number(first.id === focus));

    const reviewed = [...today.values()].filter((card) => card.reviewed).length;
    const pending = Object.entries(progress?.items ?? {}).filter(([id, card]) =>
      modeIds.has(id.split(":", 1)[0]) && Number.isFinite(card?.dueAt) && card.dueAt <= now && !today.get(id)?.reviewed).length;
    const reviewCount = Math.min(5, reviewed + pending);
    if (reviewCount) material.unshift({ id: "review", label: "Карточки к повторению", count: reviewCount, done: Math.min(reviewCount, reviewed) });

    const savedToday = baseline && dayKey(baseline.at) === day;
    const age = baseline ? daysTo(dayKey(baseline.at), day) : null;
    if (!baseline || savedToday || age <= -2) material.push({ id: "mock", label: "Пробный билет", count: 1, done: savedToday ? 1 : 0 });
    return material.sort((first, second) => Number(first.done >= first.count) - Number(second.done >= second.count));
  }

  function build({ history = [], progress = {}, target, ledger = {}, now = Date.now(), examDate } = {}) {
    const stamp = dateValue(now);
    const clock = Number.isFinite(stamp) ? stamp : Date.now();
    const day = dayKey(clock);
    const goal = normalizeTarget(target);
    const latest = latestMock(history, clock);
    const baseline = latest && { total: latest.total, parts: latest.parts, at: latest.at, mode: latest.mode };
    const gap = baseline ? Math.max(0, Math.round((goal - baseline.total) * 100) / 100) : null;
    const focus = weakestSection(baseline);
    const focusIndex = sections.findIndex(({ id }) => id === focus);
    const { title: label, max } = sections[focusIndex];
    const focusDetail = { id: focus, label, score: baseline?.parts[focusIndex] ?? null, max };
    const today = completedToday(progress, ledger, day, clock);
    const practice = practicePlan(goal, focus, focusDetail.score !== null && focusDetail.score < max, today);
    const tasks = taskPlan(baseline, focus, practice, progress, today, day, clock);
    const nextTask = tasks.find(({ count, done }) => done < count) ?? null;
    const count = practice.reduce((sum, part) => sum + part.count, 0);
    const done = practice.reduce((sum, part) => sum + part.done, 0);
    const reviewCount = tasks.find((task) => task.id === "review")?.count ?? 0;
    const dailyMinutes = practice.reduce((sum, part) => sum + part.count * formats[part.mode].minutes, reviewCount);
    return {
      day, target: goal, baseline, gap, focus, focusDetail, daysLeft: daysTo(examDate, day), tasks, nextTask,
      workload: { count, done }, dailyMinutes,
      completed: tasks.filter(({ count, done }) => done >= count).length, todayCards: today.size,
    };
  }

  window.EXAM_STUDY_PLAN = { build, record, normalizeTarget, day: dayKey };
})();
