(function () {
  "use strict";

  const vocabulary = window.EXAM_VOCABULARY;
  const course = window.EXAM_COURSE;
  const grading = window.EXAM_GRADING;
  const day = 24 * 60 * 60 * 1000;
  const intervals = [1, 3, 6, 10, 14];
  const modes = [
    { id: "vocab", title: "Перевод терминов" },
    { id: "definitions", title: "Определения" },
    { id: "abbreviations", title: "Аббревиатуры" },
    { id: "topics", title: "Устные темы" },
    { id: "passages", title: "Перевод текста" },
  ];

  function normalized(value) {
    return String(value ?? "").normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[’']/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^(?:a|an|the) /, "");
  }

  function distinct(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function grouped(items, field) {
    const groups = new Map();
    for (const item of items) {
      const key = normalized(item[field]);
      let group = groups.get(key);
      if (!group) groups.set(key, group = []);
      group.push(item);
    }
    return [...groups.values()];
  }

  const definitionTopics = {
    "history of computers": ["history"],
    "types of computers": ["computer-types"],
    "computer hardware": ["hardware", "cpu"],
    "primary memory": ["storage", "cpu"],
    "secondary storage": ["storage"],
    software: ["software", "application-programs"],
    networks: ["networks"],
    internet: ["internet"],
    "search engines": ["search-engines"],
    "web design": ["web-design"],
    "programming languages": ["programming"],
    "malware and cybercrime": ["malware"],
    "data security": ["data-security"],
    "future of it": ["future-of-it"],
  };
  const topicLookup = new Map(course.topics.map((topic) => [topic.id, topic]));

  function item(mode, prompt, promptLanguage, answerLanguage, solution, extra = {}) {
    return { id: `${mode}:${normalized(prompt)}`, mode, prompt, promptLanguage, answerLanguage, solution, ...extra };
  }

  const definitionCatalog = grouped(vocabulary.definitions, "term").map((entries) => {
    const [first] = entries;
    const topicIds = distinct(entries.flatMap((entry) => definitionTopics[normalized(entry.topic)] ?? []));
    const topic = topicLookup.get(topicIds[0]);
    return item("definitions", first.term, "en", "en", first.definition, {
      entries, aliases: entries.slice(1).map(({ definition }) => definition),
      topicIds, topicId: topic?.id, topicTitle: topic?.title, sourceTopic: first.topic,
    });
  });

  const termsByName = new Map();
  for (const entry of definitionCatalog) {
    const names = [entry.prompt, entry.prompt.replace(/\s*\([^)]*\)/g, ""), ...Array.from(entry.prompt.matchAll(/\(([^)]*)\)/g), (match) => match[1])];
    for (const name of names) {
      const key = normalized(name);
      termsByName.set(key, distinct([...(termsByName.get(key) ?? []), ...entry.topicIds]));
    }
  }

  function terminologyContext(values) {
    const topicIds = distinct(values.flatMap((value) => termsByName.get(normalized(value)) ?? []));
    const topic = topicLookup.get(topicIds[0]);
    return { topicIds, topicId: topic?.id, topicTitle: topic?.title };
  }

  function shortItem(mode, entries, promptField, solutionField, promptLanguage) {
    const [first] = entries;
    const aliases = distinct(entries.flatMap((entry) => [entry[solutionField], ...(entry.aliases ?? [])]));
    const solution = first[solutionField];
    return item(mode, first[promptField], promptLanguage, "en", solution,
      { entries, aliases: aliases.filter((alias) => alias !== solution), ...terminologyContext(aliases) });
  }

  const catalog = {
    vocab: grouped(vocabulary.translations, "ru").map((entries) => shortItem("vocab", entries, "ru", "en", "ru")),
    definitions: definitionCatalog,
    abbreviations: grouped(vocabulary.abbreviations, "short").map((entries) => shortItem("abbreviations", entries, "short", "full", "en")),
    topics: course.topics.flatMap((topic) => topic.questions.map((question) => item("topics", question.prompt, "en", "en", question.model, {
      id: `topics:${topic.id}:${normalized(question.prompt)}`, question, topicId: topic.id, topicTitle: topic.title,
    }))),
    passages: course.passages.map((passage) => item("passages", passage.title, "en", "ru", passage.translation, {
      id: `passages:${passage.id}`, body: passage.text, passage, topicId: passage.topicId, topicTitle: topicLookup.get(passage.topicId)?.title,
    })),
  };

  function entriesOf(state) {
    return state?.items && typeof state.items === "object" ? state.items : {};
  }

  function dueAt(progress, now) {
    return !!progress && Number.isFinite(progress.dueAt) && progress.dueAt <= now;
  }

  function pick(mode, state = {}, { topicId = "", reviewOnly = false, exclude = [], now = Date.now() } = {}) {
    const omitted = new Set(exclude);
    const progress = entriesOf(state);
    const eligible = (catalog[mode] ?? []).filter((card) => !omitted.has(card.id) &&
      (!topicId || card.topicId === topicId || card.topicIds?.includes(topicId)));
    const unseen = eligible.filter((card) => !progress[card.id]);
    const due = eligible.filter((card) => dueAt(progress[card.id], now));
    const choices = reviewOnly ? due : unseen.length ? unseen : due.length ? due : eligible;
    if (!choices.length) return null;
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function shortForms(card) {
    const solution = card.solution.replace(/\s*\([^)]*\)/g, "");
    return distinct([card.solution, solution, ...card.aliases]);
  }

  function shortCue(card) {
    const main = card.solution.replace(/\s*\([^)]*\)/g, "").split("/")[0].trim();
    const primary = normalized(main).split(" ");
    const spelling = primary.length === 1 && primary[0].length <= 3
      ? shortForms(card).map(normalized).map((value) => value.split(" ")).find((parts) => parts.length > 1) ?? primary
      : primary;
    const wordCount = { one: "слово", few: "слова", many: "слов", other: "слова" };
    const plural = new Intl.PluralRules("ru-RU").select(spelling.length);
    const quantity = spelling.length === 1 ? `${spelling[0].length} симв.` : `${spelling.length} ${wordCount[plural]}`;
    const mask = (visible) => spelling.map((word) => word.slice(0, Math.min(visible, Math.max(0, word.length - 1))) + "·".repeat(Math.max(1, word.length - visible))).join(" ");
    const first = [{ text: `В одном из вариантов ${quantity}.`, lang: "ru" }];
    return spelling.some((word) => word.length > 1) ? [...first, { text: mask(1), lang: "en" }] : first;
  }

  function definitionCue(card) {
    const explanation = card.solution.match(/\b(?:is|are|refers to|means|denotes)\s+(.+)/i)?.[1] ?? card.solution;
    const phrase = explanation.split(/[.,;]|\b(?:which|that|who|when|where|used|designed|created|responsible)\b/i)[0].trim();
    const elements = phrase.split(/\s+/).filter(Boolean);
    const opening = elements.slice(0, Math.min(6, Math.ceil(explanation.split(/\s+/).length / 2))).join(" ");
    const prompts = [{ text: "Сначала назовите класс понятия, затем поясните его назначение или отличительный признак.", lang: "ru" }];
    if (opening) prompts.push({ text: `${opening} …`, lang: "en" });
    return prompts;
  }

  const passageTerms = catalog.vocab.flatMap((card) => shortForms(card).map((form) => ({ en: normalized(form), ru: card.prompt })))
    .filter(({ en }) => en.length >= 5).sort((first, second) => second.en.length - first.en.length);

  function passageCue(card) {
    const body = ` ${normalized(card.body)} `;
    const glossary = [];
    const seen = new Set();
    for (const entry of passageTerms) {
      if (!body.includes(` ${entry.en} `) || seen.has(entry.ru)) continue;
      glossary.push(entry);
      seen.add(entry.ru);
      if (glossary.length === 2) break;
    }
    const prompts = [{ text: "Начните с первой фразы. Найдите подлежащее и сказуемое, затем восстановите связи между фразами.", lang: "ru" }];
    for (const { en, ru } of glossary) prompts.push({ text: `${en} — ${ru}`, lang: "ru" });
    if (!glossary.length) prompts.push({ text: card.passage.checkpoints[0], lang: "ru" });
    return prompts;
  }

  function hints(card) {
    switch (card.mode) {
      case "vocab":
      case "abbreviations":
        return shortCue(card);
      case "definitions":
        return definitionCue(card);
      case "topics":
        return card.question.checkpoints.slice(0, 3).map((text) => ({ text, lang: "en" }));
      case "passages":
        return passageCue(card);
      default:
        return [];
    }
  }

  function nearSpelling(actual, expected) {
    if (actual.length < 5 || expected.length < 5 || Math.abs(actual.length - expected.length) > 1) return false;
    const [shorter, longer] = actual.length <= expected.length ? [actual, expected] : [expected, actual];
    for (let index = 0; index < shorter.length; index++) {
      if (shorter[index] === longer[index]) continue;
      if (shorter.length !== longer.length) return shorter.slice(index) === longer.slice(index + 1);
      return shorter.slice(index + 1) === longer.slice(index + 1) ||
        shorter[index] === longer[index + 1] && shorter[index + 1] === longer[index] && shorter.slice(index + 2) === longer.slice(index + 2);
    }
    return shorter !== longer;
  }

  function partialExpansion(actual, expected) {
    const meaningful = (value) => value.split(" ").filter((word) => !["a", "an", "the", "of", "and", "or", "in", "to", "for"].includes(word));
    const expectedWords = meaningful(expected);
    const answerWords = meaningful(actual);
    let position = 0;
    let matches = 0;
    for (const word of expectedWords) {
      const index = answerWords.indexOf(word, position);
      if (index === -1) continue;
      position = index + 1;
      matches++;
    }
    return matches > 0 && expectedWords.length > 1 && matches >= expectedWords.length / 2 && answerWords.length <= expectedWords.length + 1;
  }

  function exactGrade(card, answer) {
    const actual = normalized(answer);
    const forms = shortForms(card).map(normalized);
    const correct = !!actual && forms.includes(actual);
    const partial = !correct && !!actual && forms.some((form) => nearSpelling(actual, form) || card.mode === "abbreviations" && partialExpansion(actual, form));
    const label = card.mode === "vocab" ? "Перевод термина" : "Полная расшифровка";
    const feedback = correct ? "Подходит по словарю." : partial ? "Ответ близок. Проверьте написание или допишите расшифровку." : "Сверьте ответ с примером и попробуйте воспроизвести его по памяти.";
    return { score: correct ? 1 : partial ? 0.5 : 0, max: 1,
      checks: [{ label, status: correct ? "met" : partial ? "partial" : "missing", detail: "" }], feedback };
  }

  function grade(card, answer) {
    const value = String(answer ?? "").trim();
    let result;
    switch (card.mode) {
      case "definitions":
        result = card.entries.map((entry) => grading.definition(value, entry)).sort((first, second) => second.score - first.score)[0];
        break;
      case "topics":
        result = grading.topic(value, card.question);
        break;
      case "passages":
        result = grading.passage(value, card.passage);
        break;
      default:
        result = exactGrade(card, value);
    }
    const outcome = result.score === result.max ? "correct" : result.score > 0 ? "partial" : "incorrect";
    return { ...result, outcome };
  }

  function count(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function record(state = {}, card, { outcome, helped = false }, now = Date.now()) {
    const items = entriesOf(state);
    const previous = items[card.id] ?? {};
    const independent = outcome === "correct" && !helped;
    const streak = independent ? count(previous.streak) + 1 : 0;
    const distance = independent ? intervals[Math.min(streak, intervals.length) - 1] * day : 0;
    return { ...state, attempts: count(state.attempts) + 1, items: { ...items, [card.id]: {
      attempts: count(previous.attempts) + 1,
      successful: count(previous.successful) + Number(independent),
      streak, lastAt: now, dueAt: now + distance, outcome, helped: !!helped,
    } } };
  }

  function stats(state = {}, now = Date.now()) {
    const items = entriesOf(state);
    let attempted = 0;
    let due = 0;
    let learned = 0;
    const byMode = {};
    for (const { id } of modes) {
      const attempts = catalog[id].map((card) => items[card.id]).filter(Boolean);
      const modeDue = attempts.filter((progress) => dueAt(progress, now)).length;
      const modeLearned = attempts.filter((progress) => count(progress.streak) >= 2).length;
      byMode[id] = { attempted: attempts.length, due: modeDue, total: catalog[id].length, learned: modeLearned };
      attempted += attempts.length;
      due += modeDue;
      learned += modeLearned;
    }
    return { attempts: count(state.attempts), attempted, due, learned, modes: byMode };
  }

  window.EXAM_STUDY_DATA = { modes, catalog, pick, hints, grade, record, stats };
})();
