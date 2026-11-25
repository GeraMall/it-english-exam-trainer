(function () {
  "use strict";

  const stop = {
    en: new Set(("a an the this that these those it its they their them he she his her who whose which what where when why how and or as at by for from in into of on onto off to with without within over under than while although because but if so before after once then i we you your our can could may might should will would am is are was were be been being do does did have has had not also both each one some any many much several more less same other another such very usually often typically simply can forms").split(" ")),
    ru: new Set(("а и но или как на в во из за с со по при до без для от к ко о об у над под то что где если когда который которая которые которых быть может могут еще также уже затем через это этой этот такие такой самое их ей его ее они она он мы вы тем тот те же не").split(" ")),
  };
  const generic = new Set("example typical use way role one two three seven each both practical plausibl correct differ reason characteristic effect benefit advantage machin device how work main particul system can choic requir check count properties program purpose next certain task provide base sort other number approach change".split(" "));
  const englishRelations = /\b(?:is|are|was|were|has|have|can|may|cannot|will|means|uses?|stores?|saves?|keeps?|maintains?|makes?|provides?|helps?|must|lets?|works?|allows?|receives?|controls?|handles?|connects?|consists?|describes?|performs?|runs?|executes?|refers?|represents?|calculates?|supports?|converts?|gives?|displays?|finds?|returns?|reduces?|increases?|sends?|depends?|forwards?|prevents?|requires?|produces?|shows?|compares?|reads?|translates?|holds?)\b/i;
  const russianRelations = /\b[\d]+\b|(?:[а-яё]{3,}(?:ет|ут|ют|ит|ат|ят|ться|ется|ются|илась|али|ен[ыа]|ан[ыа])(?=$|[^а-яё]))/i;

  const synonyms = [
    "central processing unit|cpu|processor", "random access memory|ram|working memory|main memory|primary memory",
    "read only memory|rom", "solid state drive|ssd", "hard disk drive|hdd|hard drive|hard disk",
    "graphics processing unit|gpu|graphics processor", "operating system|os", "world wide web|www|web",
    "local area network|lan", "wide area network|wan", "interface|ui", "application programming interface|api",
    "web browser|browser", "program|programme|application|app", "startup|boot|booting", "shutdown|power off|turn off",
    "transistor count|transistor density", "vacuum tubes|vacuum valves", "integrated circuit|microchip|chip",
    "compute|calculation|calculate|arithmetic", "workload|task load", "clock speed|clock rate|clock frequency",
    "temporarily|temporary|short term", "long term|durable|persistent", "persist|retain|preserve|keep",
    "storage|store|stored|save|saving", "retrieve|fetch|load|read", "write back|writeback", "write through|writethrough",
    "execute|execution|run|running", "instruction|command|operation", "raw data|data|information", "architecture|design|layout",
    "speed|fast|faster|quick|quickly|rapid|rapidly", "delay|latency|waiting|lag", "responsiveness|response time|responsive",
    "capacity|bandwidth|throughput", "carry|transmit|transfer|send", "central|middle", "network node|node|endpoint",
    "switches|switch", "forward|forwarding|route|routing", "wireless|wi fi", "connect|connectivity|connection",
    "access point|ap", "domain name system|dns", "internet protocol|ip", "hostname|host name|domain name",
    "link|hyperlink", "page|webpage|web page", "request|query|search phrase", "crawler|spider|web robot|bot",
    "crawl|crawling|discover|discovery", "indexing|index", "rank|ranking|sort|ordering|order", "relevance|relevant",
    "retrieve|fetch|load|read|find|locate", "directory|catalog|catalogue", "content|contents", "keyboard|keyboards",
    "machine language|machine code|machine instructions", "assembly language|assembly code|assembly", "higher level|high level",
    "source code|source program", "translate|convert|translation", "assembler|assemblies", "behaviour|behavior",
    "front end|frontend|client side", "back end|backend|server side", "visual|appearance|presentation|look",
    "responsive design|responsive layout|responsive site", "accessibility|accessible", "screen reader|assistive technology",
    "authentication|authenticate|identity verification", "multi factor authentication|mfa|two factor authentication|2fa",
    "credentials|password|login details", "infect|infection|attach", "host file|host program|host", "spread|propagate",
    "legitimate|genuine|trusted", "malware|malicious software", "antivirus|anti virus", "signature|fingerprint|pattern",
    "security update|patch|software update", "backup|backups|copy", "restore|recover|recovery|restoration",
    "authorized|authorised|permitted", "encrypt|encryption|encipher", "pseudo random|pseudorandom", "privacy|confidentiality",
    "prove|verify|check|validate", "report|notify|alert", "unknown|unfamiliar|unseen", "real time|real-time",
    "internet of things|iot", "virtual reality|vr", "augmented reality|ar", "artificial neural network|ann|neural network",
    "hidden layer|hidden layers", "learn|train|training|learning", "predefined|preset|known in advance",
    "categorize|categorise|classify|classification|class", "cluster|group|clustering", "modeling|modelling|model",
    "measurement|measure|estimate", "analyse|analyze|analysis", "reliability|reliable|dependable",
    "supercomputer|high performance computer", "personal computer|pc", "individual|single user|one person",
    "portable|portability|mobile", "touch screen|touchscreen|touch input", "multi tasking|multitasking",
    "data base|database", "media|medium", "spread sheet|spreadsheet", "word processing|word processor",
    "ancient|old", "equipment|device|tool|instrument", "count|counting|tally", "simple|basic", "perform|do|carry out",
    "material|substance", "conduct electricity|electrical conductivity|electric conduction", "increase|rise|grow",
    "temperature|heat|hot|hotter|warmth", "global|worldwide|all over the globe|around the world", "infrastructure|network",
    "render|rendering|display|show", "response|reply|answer", "interactive|interaction|interact", "structure|organization|arrangement",
    "document|page|webpage|web page", "address bar|address field|browser bar", "slow|slower|more time|take longer",
    "requested|needed|required", "reach|access", "record|capture|register", "URL|web address|uniform resource locator",
    "resolve|resolution|look up", "queue|buffer", "properties|attributes", "standard|common", "time|duration",
  ];

  function words(value) {
    return String(value ?? "").normalize("NFKC").toLowerCase()
      .replace(/ё/g, "е").replace(/[а-яa-z]+[’']/g, (word) => word.replace(/[’']$/, ""))
      .match(/[a-zа-я]+\d*[a-zа-я]*|\d+/g) || [];
  }

  function englishStem(word) {
    if (word.length < 4) return word;
    return word.replace(/(?:ization|isation)$/, "ize").replace(/(?:ability|ibility)$/, "able")
      .replace(/(?:ation|ition)$/, "at").replace(/ness$/, "").replace(/(?:ies|ied)$/, "y")
      .replace(/(?:ingly|edly|ing|ed|ments|ment|ly)$/, "").replace(/([^s])s$/, "$1")
      .replace(/([^aeiou])\1$/, "$1").replace(/e$/, "");
  }

  function russianStem(word) {
    return word.replace(/[аеёиоуыэюя].*$/, (ending) => {
      if (ending.length < 3) return ending;
      const rest = ending.slice(1).replace(/(?:ывшись|ившись|авшись|явшись|ывши|ивши|авши|явши)$/u, "").replace(/(?:ся|сь)$/u, "")
        .replace(/(?:иями|ями|ами|ыми|ими|ого|его|ому|ему|ую|юю|яя|ая|ое|ее|ые|ие|ях|ах|ев|ов|ей|ия|ию|ий|ых|их|ам|ям|ой|ыи|еи|ю|а|я|ы|е|о|и|у)$/u, "")
        .replace(/(?:остью|ость|ост|остец)$/u, "").replace(/(?:а|и|ы|у|ю|е|о|я|ь)$/u, "");
      return ending[0] + rest;
    });
  }

  const aliases = new Map();
  for (const variants of synonyms) {
    const forms = variants.split("|").map((variant) => words(variant).map(englishStem).join(" "));
    const key = forms.at(-1).replace(/ /g, "_");
    for (const form of forms) aliases.set(form, key);
  }

  function content(input, lang) {
    if (lang === "ru") return input.filter((word) => !stop.ru.has(word)).map(russianStem);
    const stems = input.map(englishStem);
    const result = [];
    for (let index = 0; index < input.length;) {
      const phrase = [5, 4, 3, 2, 1].map((length) => ({ length, form: stems.slice(index, index + length).join(" ") }))
        .find(({ form, length }) => index + length <= input.length && aliases.has(form));
      if (phrase) {
        result.push(aliases.get(phrase.form));
        index += phrase.length;
      } else {
        if (!stop.en.has(input[index])) result.push(stems[index]);
        index++;
      }
    }
    return result;
  }

  function analyze(value, lang) {
    const raw = String(value ?? "").trim().slice(0, 16000);
    const prose = raw.toLowerCase().replace(/ё/g, "е").replace(/[’‘]/g, "'")
      .replace(/\b(can|wo|sha)n't\b/g, (_, auxiliary) => ({ can: "can not", wo: "will not", sha: "shall not" }[auxiliary]))
      .replace(/n't\b/g, " not").replace(/\s+/g, " ");
    const tokens = words(prose);
    const features = content(tokens, lang);
    const clauses = prose.split(/(?:[.!?;]+|\b(?:whereas|while|however|but)\b|\s(?:а|однако|но)\s)/u).map((part) => part.trim()).filter(Boolean);
    const segments = raw.split(/(?:[.!?;]+(?=\s|$)|\n+)/u).map(words).filter((part) => part.length);
    const windows = segments.flatMap((part, index) => {
      const adjacent = segments[index + 1];
      if (adjacent && part.length + adjacent.length <= 50) return [part, [...part, ...adjacent]];
      return [part];
    }).flatMap((part) => part.length > 58 ? Array.from({ length: Math.ceil(part.length / 22) }, (_, index) => part.slice(index * 22, index * 22 + 45)) : [part]);
    const fluent = lang === "en" ? englishRelations.test(prose) : russianRelations.test(raw);
    return { tokens, features, segments, prose, clauses, windows: windows.map((part) => ({ raw: part, features: new Set(content(part, lang)) })), fluent };
  }

  function shared(expected, actual) {
    return expected.reduce((sum, item) => sum + Number(actual.has(item)), 0);
  }

  function distinct(sequence) {
    return [...new Set(sequence.filter(Boolean))];
  }

  function inspected(label, status, detail = "") {
    return { label, status, detail };
  }

  function finish(max, checks, cap, feedback) {
    const weight = max / checks.length;
    const total = checks.reduce((sum, check) => sum + weight * ({ met: 1, partial: 0.5, missing: 0 }[check.status]), 0);
    return { score: Math.min(cap ?? max, Math.round(total * 2) / 2), max, checks, ...(feedback ? { feedback } : {}) };
  }

  function languageShare(answer, lang) {
    const alphabet = lang === "en" ? /^[a-z]/u : /^[а-я]/u;
    const eligible = answer.tokens.filter((word) => /[а-яa-z]/u.test(word));
    return eligible.length ? eligible.filter((word) => alphabet.test(word)).length / eligible.length : 0;
  }

  function earlyResult(max, labels, answer, reference, lang) {
    if (!answer.tokens.length) return finish(max, labels.map((label) => inspected(label, "missing")), undefined, "Ответ отсутствует.");
    if (languageShare(answer, lang) < (lang === "en" ? 0.65 : 0.58)) return finish(max, labels.map((label) => inspected(label, "missing")), 0, lang === "en" ? "Для проверки нужен ответ на английском." : "Для проверки нужен перевод на русский.");
    if (answer.tokens.length >= 4 && answer.tokens.join(" ") === reference.tokens.join(" ")) return finish(max, labels.map((label) => inspected(label, "met")));
    return null;
  }

  function qualityCap(answer, lang, max) {
    const excluded = lang === "en" ? ["and", "or", "also", "such"] : ["и", "или", "а", "тоже", "также"];
    const linking = answer.tokens.filter((word) => stop[lang].has(word) && !excluded.includes(word));
    const variety = distinct(linking).length;
    if (answer.features.length < 2) return 0;
    if (answer.tokens.length >= 8) {
      let ascending = 0;
      let descending = 0;
      for (let index = 1; index < answer.tokens.length; index++) {
        const previous = answer.tokens[index - 1];
        const current = answer.tokens[index];
        ascending += Number(previous <= current);
        descending += Number(previous >= current);
      }
      if (Math.max(ascending, descending) / (answer.tokens.length - 1) > 0.88) return 0;
      if (variety < 2 || linking.length / answer.tokens.length < 0.08) return max < 4 ? 0.5 : 2;
    }
    if (!answer.fluent && variety <= 2) return max < 4 ? 0.5 : 2;
    if (!answer.fluent && variety < 4) return max < 4 ? 1.5 : 4;
    return max;
  }

  function repeatsLabels(answer, labels, lang) {
    const labelFeatures = new Set(content(words(labels.join(" ")), lang));
    const additional = distinct(answer.features).filter((feature) => !labelFeatures.has(feature));
    return additional.length < 2;
  }

  function clauseHas(answer, ...tests) {
    return answer.clauses.some((clause) => tests.every((pattern) => pattern.test(clause)));
  }

  function supported(label, evidence, extra = false, reversed = false) {
    if (reversed) return inspected(label, "missing", "Ключевое соотношение передано наоборот.");
    return inspected(label, evidence ? "met" : extra ? "partial" : "missing");
  }

  function focusedTopic(answer, question) {
    const labels = question.checkpoints;
    const checks = [];
    if (question.prompt.startsWith("What is a cache hit")) {
      const cache = /\bcache\b/;
      const hit = /\bhit\b/;
      const miss = /\bmiss(?:es)?\b|\b(?:absent|missing)\b|\b(?:is|are) not (?:there|present|already|in)\b/;
      const cached = /\b(?:already|present|found|available|in the cache)\b/;
      const fast = /\b(?:fast\w*|quick\w*|close|near|nearby)\b/;
      const slow = /\b(?:slower|longer|more time|lower level|lower cache|lower tier)\b/;
      const next = /\b(?:read|fetch|retriev\w*|load|access|go to|ram|main memory)\b/;
      const stored = /\b(?:stor\w*|copy|copies|keep\w*|contain\w*|holds?)\b/;
      checks.push(supported(labels[0], clauseHas(answer, cache, stored, fast) || clauseHas(answer, cache, stored, /\breus\w*\b/), clauseHas(answer, cache, stored), clauseHas(answer, cache, /\bslower than (?:main memory|ram)\b/)));
      checks.push(supported(labels[1], clauseHas(answer, hit, cached) && !clauseHas(answer, hit, miss), clauseHas(answer, hit, /\b(?:needed|requested|data|value|bytes)\b/), clauseHas(answer, hit, miss) || clauseHas(answer, hit, /\bread from (?:ram|main memory)\b/)));
      checks.push(supported(labels[2], clauseHas(answer, miss, next) && clauseHas(answer, slow, next), clauseHas(answer, miss, next), clauseHas(answer, /\bmiss(?:es)?\b/, /\b(?:data|value|bytes) (?:is|are) (?:present|found|available|already)\b/)));
      return checks;
    }
    if (question.prompt.startsWith("How do preemptive and cooperative multitasking")) {
      const preemptive = /\bpreempt\w*\b/;
      const cooperative = /\bcooperat\w*\b/;
      const stopTask = /\b(?:interrupt\w*|take\w*.{0,20}away|preempts?|suspend\w*|switch\w*.{0,25}task)\b/;
      const self = /\b(?:voluntar\w*|yield\w*|itself|decides?|chooses?|hand\w*.{0,12}over|give\w* up|gives? up)\b/;
      const operator = /\b(?:os|operating system|scheduler|kernel)\b/;
      const responsive = /\b(?:responsiv\w*|freez\w*|stuck|unresponsive|hang\w*|keep .*serving)\b/;
      const backwards = clauseHas(answer, cooperative, stopTask, operator) && !clauseHas(answer, cooperative, /\b(?:not|cannot|can't)\b/, stopTask) || clauseHas(answer, preemptive, self, /\b(?:voluntar\w*|itself)\b/) && !clauseHas(answer, preemptive, /\b(?:fail\w*|without|not)\b/, self);
      checks.push(supported(labels[0], clauseHas(answer, preemptive, stopTask, operator), clauseHas(answer, preemptive, stopTask), backwards));
      checks.push(supported(labels[1], clauseHas(answer, cooperative, self, /\b(?:task\w*|job\w*|process\w*|program\w*)\b/), clauseHas(answer, cooperative, self), backwards));
      checks.push(supported(labels[2], clauseHas(answer, responsive) && answer.clauses.length >= 3, clauseHas(answer, responsive), backwards));
      return checks;
    }
    if (question.prompt.startsWith("What is the difference between bandwidth and latency")) {
      const bandwidth = /\bbandwidth\b/;
      const latency = /\blatency\b/;
      const rate = /\b(?:per (?:second|unit)|data rate|capacity|how (?:many|much)|amount of data|volume of data|maximum throughput)\b/;
      const lag = /\b(?:delay|lag|how long|duration|time.{0,30}takes|time between)\b/;
      const sample = /\b(?:download\w*|file|call|voice\w*|stream\w*|games?|brows\w*)\b/;
      const backwards = clauseHas(answer, bandwidth, /\b(?:is|denotes|means|measures) (?:the |a )?(?:time delay|delay|latency|lag)\b/) || clauseHas(answer, latency, /\b(?:is|denotes|means|measures) (?:the |a )?(?:amount of data|bandwidth|capacity|data rate|maximum throughput)\b/);
      checks.push(supported(labels[0], clauseHas(answer, bandwidth, rate), clauseHas(answer, bandwidth, /\b(?:data|bits|speed)\b/), backwards));
      checks.push(supported(labels[1], clauseHas(answer, latency, lag), clauseHas(answer, latency, /\b(?:time|arriv\w*|packets?)\b/), backwards));
      checks.push(supported(labels[2], clauseHas(answer, sample, /\b(?:late|fast\w*|slow\w*|quick\w*|delays?|capacity|lag)\b/), clauseHas(answer, sample), backwards));
      return checks;
    }
    return null;
  }

  function labelEvidence(answer, reference, label, index, count) {
    const anchors = distinct(content(words(label), "en")).filter((feature) => !generic.has(feature));
    const correspond = reference.segments.map((segment, position) => {
      const features = distinct(content(segment, "en")).filter((feature) => !generic.has(feature));
      return { features, nearby: Math.abs(position - index * (reference.segments.length - 1) / Math.max(count - 1, 1)), hits: shared(anchors, new Set(features)) };
    }).sort((a, b) => b.hits - a.hits || a.nearby - b.nearby)[0];
    const bridge = (correspond?.features || []).filter((feature) => !anchors.includes(feature));
    let best = "missing";
    for (const window of answer.windows) {
      const hits = shared(anchors, window.features);
      const details = shared(bridge, window.features);
      if (anchors.length === 0 || !correspond?.hits) {
        if (details >= Math.max(2, Math.ceil(bridge.length * 0.52))) return "met";
        if (details >= 2 || hits && details) best = "partial";
      } else if (anchors.length === 1) {
        if (hits && (details >= 1 || bridge.length === 0) && window.features.size >= 3) return "met";
        if (hits || details >= Math.max(2, Math.ceil(bridge.length * 0.55))) best = "partial";
      } else {
        if (hits >= Math.ceil(anchors.length * 0.75) && (details >= 1 || window.features.size >= Math.max(4, hits + 1))) return "met";
        if (hits >= Math.ceil(anchors.length * 0.55) || (hits && details >= 1) || details >= Math.max(2, Math.ceil(bridge.length * 0.62))) best = "partial";
        if (hits && details >= Math.max(2, Math.ceil(bridge.length * 0.55))) return "met";
      }
    }
    return best;
  }

  function topic(value, question) {
    const max = 3;
    const labels = question.checkpoints;
    const answer = analyze(value, "en");
    const reference = analyze(question.model, "en");
    const early = earlyResult(max, labels, answer, reference, "en");
    if (early) return early;
    const prompt = new Set(content(words(question.prompt), "en"));
    const newFeatures = distinct(answer.features).filter((feature) => !prompt.has(feature));
    if (!newFeatures.length) return finish(max, labels.map((label) => inspected(label, "missing")), undefined, "Добавьте сведения, которые раскрывают вопрос.");
    const checks = focusedTopic(answer, question) || labels.map((label, index) => inspected(label, labelEvidence(answer, reference, label, index, labels.length)));
    const cap = Math.min(qualityCap(answer, "en", max), newFeatures.length < 3 || repeatsLabels(answer, labels, "en") ? 1 : max);
    return finish(max, checks, cap, cap < max ? "Дополните ответ связным объяснением или примером." : undefined);
  }

  function focusedDefinition(answer, entry, labels) {
    const term = entry.term.toLowerCase();
    if (term === "cache miss" || term === "cache hit") {
      const isMiss = term === "cache miss";
      const absent = clauseHas(answer, /\bcache\b/, /\b(?:missing|not (?:in|found|available|present|find)|absent|fail\w* to find|cannot find|can not find)\b/);
      const present = clauseHas(answer, /\bcache\b/, /(?<!\bnot )(?:\bfound in|\bpresent in|\balready in|\bcan find|\bavailable in)\b/);
      const next = /\b(?:ram|main memory|lower (?:level|tier)|slower memory|a different memory)\b/.test(answer.prose);
      const retrieve = /\b(?:read\w*|fetch\w*|retriev\w*|load\w*|access\w*)\b/.test(answer.prose);
      const reversed = isMiss ? present && !absent : absent && !present;
      const context = /\b(?:data|bytes|value|information|instruction)\b/.test(answer.prose);
      const matched = isMiss ? absent : present;
      return [supported(labels[0], matched, context && /\bcache\b/.test(answer.prose), reversed), supported(labels[1], matched && (isMiss ? next && retrieve : context), matched || next, reversed)];
    }
    if (/^(?:differential|incremental) backup$/.test(term)) {
      const differential = term.startsWith("differential");
      const changed = /\b(?:modifi\w*|chang\w*|updat\w*|new)\b/;
      const backup = /\b(?:bak\w*|backups?|cop\w*|sav\w*|stor\w*)\b/;
      const period = /\b(?:since|after|following|from)\b/;
      const complete = /\b(?:full|complete|initial)\b.{0,18}\b(?:backup|copy|snapshot)\b/;
      const any = /\b(?:preceding|previous|latest|last|most recent)\b.{0,16}\b(?:backup|copy|snapshot)\b/;
      const nonFull = /\b(?:partial|incremental|any)\b.{0,12}\b(?:backup|copy)\b/;
      const reversed = differential ? clauseHas(answer, period, nonFull) : clauseHas(answer, period, complete, /\b(?:always|only|full)\b/) && !clauseHas(answer, complete, /\b(?:regardless|whether|or|either)\b/);
      return [supported(labels[0], clauseHas(answer, changed, backup), clauseHas(answer, backup), reversed), supported(labels[1], clauseHas(answer, period, differential ? complete : any) && !reversed, clauseHas(answer, changed, backup), reversed)];
    }
    if (term === "polymorphism") {
      const operation = /\b(?:method|operation|implementation|interface|instruction|function|call|behav\w*)\b/;
      const types = /\b(?:types?|class(?:es)?|objects?|shape\w*|subtypes?)\b/;
      const variation = /\b(?:differ\w*|depends?|own|unique|override\w*|specializ\w*)\b/;
      const shared = /\b(?:same|common|shared|single|one)\b/;
      const reversed = clauseHas(answer, /\b(?:always|identical\w*|regardless)\b/, /\b(?:same way|same behav\w*|regardless of.{0,15}(?:class|type|object))\b/);
      return [supported(labels[0], clauseHas(answer, operation, types, shared) || clauseHas(answer, types, operation, variation), clauseHas(answer, operation, types), reversed), supported(labels[1], clauseHas(answer, types, operation, variation), clauseHas(answer, types, operation, shared), reversed)];
    }
    return null;
  }

  function definition(value, entry) {
    const max = 2;
    const labels = ["Класс понятия", "Назначение или отличительные признаки"];
    const answer = analyze(value, "en");
    const reference = analyze(entry.definition, "en");
    const early = earlyResult(max, labels, answer, reference, "en");
    if (early) return early;
    const term = new Set(content(words(entry.term), "en"));
    const features = distinct(reference.features).filter((feature) => !term.has(feature));
    const anchor = features.slice(0, Math.min(features.length <= 4 ? 1 : 3, features.length));
    const functionClause = entry.definition.match(/\b(?:used to|responsible for|designed to|whose|that)\s+([^.!?;]+)/i)?.[1].split(/\b(?:such as|for example|including)\b/i)[0];
    const purpose = distinct(content(words(functionClause), "en")).filter((feature) => !term.has(feature) && !generic.has(feature));
    const characteristics = features.filter((feature) => !anchor.includes(feature) && !generic.has(feature));
    const actual = new Set(answer.features.filter((feature) => !term.has(feature)));
    if (!actual.size) return finish(max, labels.map((label) => inspected(label, "missing")), 0, "Раскройте значение термина своими словами.");
    const categoryHits = shared(anchor, actual);
    const details = shared(characteristics, actual);
    const purposeHits = shared(purpose, actual);
    const minDetails = Math.max(1, Math.min(3, Math.ceil(characteristics.length * 0.25)));
    const enoughDetails = details >= minDetails || (purpose.length >= 2 && purposeHits >= Math.max(2, Math.ceil(purpose.length * 0.5)));
    const checks = focusedDefinition(answer, entry, labels) || [
      inspected(labels[0], categoryHits ? "met" : enoughDetails ? "partial" : "missing"),
      inspected(labels[1], enoughDetails ? "met" : details || purposeHits ? "partial" : "missing"),
    ];
    const cap = qualityCap(answer, "en", max);
    return finish(max, checks, cap, cap < max ? "Добавьте связное определение и отличительный признак." : undefined);
  }

  const passageConcepts = {
    "stored-program": [
      ["кабель|провод*|настройк*|параметр*", "переключ*|соедин*|переподключ*|измен*|настраив*", "расчет*|задач*|вычислен*"],
      ["команд*|инструкц*|программ*", "памят*", "считыв*|чита*|хран*|запис*|доступ*|береж*"],
      ["загруз*|загружа*|смен*|меня*|помещ*", "программ*|инструкц*", "оборудован*|аппарат*|машин*|компьютер*", "друг*|нов*|т* же"],
      ["шир*|больш*|разнообраз*|множ*|различн*", "реша*|выполн*|работ*|применя*|применен*|использ*", "задач*|проблем*|операц*|расчет*"],
    ],
    "embedded-sampling": [
      ["датчик*|сенсор*", "батар*|аккумулятор*|автоном*|питан*", "регуляр*|периоди*|интервал*|промежут*", "измер*|замер*|выборк*"],
      ["част*|интервал*", "измер*|замер*|выборк*", "энерги*|энергопотреблен*|питан*|заряд*|расход*"],
      ["накапл*|накоп*|сохран*|запис*|буфер*|собира*", "данн*|замер*|измер*|результат*", "пакет*|групп*|вмест*|одновременно|част*", "переда*|отправ*|пересыла*"],
      ["скорост*|темп*|частот*", "измен*|меня*|вариац*", "задерж*|ожидан*|откл*", "допуст*|приемлем*|терпим*|позвол*"],
    ],
    multicore: [
      ["ядр*|многоядер*|процессор*", "независ*|параллел*|одноврем*", "задач*|прилож*|работ*|вычислен*", "производитель*|пропуск*|быстр*|ускор*"],
      ["общ*|один* и тот|одной и той же|разделя*", "оператив*|основн*|озу", "памят*|озу", "огранич*|снижа*|уреза*|меньш*|препятств*"],
      ["ожида*|ждат*|трат*|задерж*", "передач*|пересыл*|получен*|переда*|перенос*", "данн*|информац*"],
      ["измер*|оцени*|оценк*|анализ*|мониторинг*", "процессор*|цпу", "памят*|озу", "нагруз*|задач*|сценар*|прилож*"],
    ],
    "cache-locality": [
      ["кеш*|кэш*|cache", "быстр*|скор*|ускор*", "оператив*|основн*|озу", "памят*|озу"],
      ["смеж*|сосед*|рядом|близк*", "элемент*|данн*|значен*", "последов*|по порядк*|поочеред*", "чита*|чтен*|считыв*|доступ*"],
      ["один*|одн*|единств*", "обращен*|запрос*|операц*|передач*", "нескол*|групп*|множ*|пакет*", "загруз*|перенест*|попад*|элемент*|кэш*|кеш*"],
      ["промах*|пропуск*|неудач*|cache miss", "непредсказ*|случайн*|беспоряд*|произвольн*", "объем*|количеств*|размер*", "тот же|не меня*|остает*|постоян*|неизменн*|прежн*|равн*"],
    ],
    "flash-wear": [
      ["огранич*|конечн*|лимит*", "цикл*|раз*|числ*|количеств*", "стира*|стер*|удален*", "запис*|программиров*|перезапис*"],
      ["распредел*|разнос*|перераспредел*|черед*", "запис*|программиров*|перезапис*", "износ*|ресурс*|служб*", "блок*|участ*|равномер*"],
      ["логич*|виртуал*", "адрес*", "физич*", "блок*|мест*|страниц*|отображен*|адрес*"],
      ["служб*|долговечн*|ресурс*|жизн*", "завис*|определ*|влия*", "характер*|шаблон*|профил*|тип*", "частот*|интенсив*|объем*|нагруз*"],
    ],
    "graphics-offloading": [
      ["графич*|gpu|видеокарт*|гпу", "параллел*|одноврем*", "пиксел*|точк*|изображен*", "операц*|обработ*|вычислен*"],
      ["копир*|переда*|передач*|перенос*|перенест*", "оператив*|основн*|озу", "графич*|видеопамят*|gpu|видеокарт*", "памят*|видеопамят*|озу"],
      ["небольш*|мал*|коротк*", "изображен*|картинк*|кадр*", "передач*|перенос*|копиров*", "дольш*|больш*|длит*|медлен*", "вычислен*|обработ*"],
      ["крупн*|больш*|нескол*|мног*", "изображен*|картинк*|операц*|действ*", "передач*|перенос*|копиров*", "выигрыш*|польз*|окуп*|перевес*|превосход*|превыс*|оправд*|эффект*"],
    ],
    "job-scheduling": [
      ["производитель*|пропуск*|производствен*", "отклик*|реакц*|реаг*", "баланс*|совмещ*|сохраня*|соглас*|быстр*|оперативн*"],
      ["длитель*|долг*|больш*", "квант*|интервал*|период*|отрезок*", "расход*|издержк*|накладн*", "задерж*|ожидан*|ждат*|отклик*"],
      ["планиров*|диспетчер*", "раньш*|приоритет*|быстрее|в первую очередь|после пауз*", "возобнов*|просну*|активир*|ожидан*", "интерактив*|пользовательск*"],
      ["измер*|оцени*|оценк*|сравн*", "реакц*|отклик*|ответ*", "задач*|работ*|процесс*", "заверш*|выполн*|секунд*|производитель*"],
    ],
    "autosave-recovery": [
      ["регуляр*|период*|интервал*|промежут*|автосохран*", "сохран*|запис*|дела*", "копи*|дубликат*|верс*", "восстанов*|резерв*"],
      ["частот*|част*|интервал*|промежут*", "запис*|сохран*|копир*", "потер*|утрат*|пропаст*", "правк*|измен*|редакт*|работ*"],
      ["запис*|сохран*|копир*", "пауз*|перерыв*|задерж*|останавлива*|переста*|покой*", "пользовател*|редакт*|печата*|ввод*"],
      ["запуск*|перезапуск*|возобнов*|откры*", "верси*|копи*|вариант*", "выбор*|выб*|реш*|остав*|предлаг*"],
    ],
    "network-latency": [
      ["высок*|больш*|быстр*|широк*", "пропуск*|емкост*|производитель*|способност*|широк* канал*", "одноврем*|сразу|параллел*|синхрон*", "передач*|переда*|посыла*|отправ*"],
      ["очеред*|накапл*|скапл*|накопл*|ожидающ*", "пакет*|кадр*|данн*", "маршрутизатор*|роутер*|шлюз*"],
      ["медлен*|задерж*|ожидан*|тормоз*", "отклик*|интерактив*|звон*|голос*|приложен*", "быстр*|скор*", "файл*|загруз*|скачив*"],
      ["тест*|провер*|измер*|замер*", "максим*|пиков*|предел*", "скорост*|пропуск*|трафик*", "проблем*|огранич*|пропуст*|выяв*|замет*"],
    ],
    "layered-diagnostics": [
      ["уров*|сло*|послой*", "сеть|сет*|модел*|описан*", "суз*|сократ*|уменьш*|огранич*", "причин*|сбой*|неисправ*|отказ*|проблем*"],
      ["кабел*|провод*|разъем*", "подключ*|соедин*|связан*", "канал*|интерфейс*|линк*|связ*", "актив*|работ*|исправ*"],
      ["ошиб*|невер*|неправил*|некоррект*", "адрес*|маршрут*|ip", "сет*|устройств*|связ*|обмен*"],
      ["проверк*|проверя*|контрол*|тест*", "уров*|сло*|послой*", "запис*|фикс*|зафикс*|документ*|учет*|учит*", "результат*|част*|элемент*|компонент*|систем*"],
    ],
    "dns-caching": [
      ["разреш*|преобраз*|сопостав*|резолв*|определ*", "домен*|им*", "dns|днс", "обмен*|запрос*|сервер*"],
      ["повтор*|использ*|переиспольз*|кэш*|кеш*|сохран*", "ответ*|запис*|результат*", "огранич*|врем*|срок*|интервал*|ttl"],
      ["скор*|быстр*|ускор*|эффектив*", "запрос*|поиск*|разреш*", "трафик*|нагруз*|обмен*|сетев*", "уменьш*|снижа*|сокращ*|эконом*"],
      ["стар*|устар*|прошл*|прежн*", "адрес*|запис*", "перенос*|переезд*|перемещ*|смен*", "срок*|длитель*|хранен*|кэширован*|кеширован*|ttl"],
    ],
    "search-index": [
      ["инверт*|обрат*|инверс*", "индекс*", "термин*|слов*|фраз*", "документ*|страниц*|запис*"],
      ["поиск*|запрос*|ищет*", "без|не|избег*|быстр*", "просматр*|просмотр*|перебор*|переби*|скан*", "коллекц*|набор*|документ*|содерж*|страниц*"],
      ["част*|быстр*|постоян*", "измен*|меня*|обновл*", "актуаль*|свеж*|текущ*|поддерж*", "слож*|затруд*|труд*|тяжел*"],
      ["частот*|част*|регуляр*", "обход*|посещ*|скан*|перепровер*|запрос*", "измен*|меня*|обновл*|стабил*", "страниц*|сайт*|ресурс*"],
    ],
    "bytecode-portability": [
      ["байт*|bytecode", "промежуточ*|вспомог*", "представл*|форм*|этап*|формат*", "исходн*|код*|трансляц*"],
      ["исполн*|выполн*|интерпретир*", "компил*|машинн*|нативн*", "сред*|рантайм*|runtime|виртуальн*"],
      ["перенос*|разн*|различн*|друг*", "совместим*|подходящ*|поддерж*", "сред*|платформ*|машин*|устройств*"],
      ["задерж*|пауза*|замедл*|ожидани*", "перв*|начальн*|впервые", "компил*", "повтор*|последующ*|снова", "быстр*|ускор*|выигрыш*|выигр*|производитель*"],
    ],
    "web-accessibility": [
      ["структур*|уров*|иерархи*", "заголов*", "экран*|скринридер*|скрин ридер*", "доступ*|чтен*|читающ*|переход*|навигац*|ридер*"],
      ["внешн*|визуальн*|выдел*|полужир*|жирн*|похож*", "заголов*", "размет*|семантич*|навигац*|переход*|навигацион*"],
      ["подпис*|метк*|ярлык*|назван*", "пол*|элемент*|ввод*", "связ*|привяз*|соотнес*|ассоци*", "фокус*|актив*|выбра*"],
      ["провер*|тест*|оцен*|подтверд*", "клавиатур*|клавиш*", "визуальн*|осмотр*|зритель*|внешн*"],
    ],
    "incident-reporting": [
      ["ранн*|заранее|воврем*|своеврем*|до*", "сообщ*|обращен*|отчет*|жалоб*", "приня*|предприн*|действ*|реагир*", "мер*|реакц*|реагир*|безопас*"],
      ["письм*|сообщен*", "ссылк*|переход*|переш*|открыв*", "ввод*|ввел*|вводил*|данн*|сведен*"],
      ["сопостав*|сравн*|свер*|объедин*", "обращен*|отчет*|сообщен*|доклад*", "масштаб*|охват*|размер*|серьез*", "инцидент*|происшеств*|случа*|проблем*"],
      ["доступ*|прост*|легк*|удоб*|найти|понят*", "сообщ*|обращен*|кнопк*|форм*|поряд*", "дальше|дальнейш*|следующ*|ответ*|реакц*|инструкц*", "делат*|действ*|шаг*|выполн*"],
    ],
    "tested-restoration": [
      ["копи*|бэкап*|бекап*|резервир*", "восстанов*|возобнов*|вернут*", "требуем*|задан*|необходим*|установлен*|отведен*", "врем*|срок*|интервал*"],
      ["оборудован*|аппарат*|техник*", "доступ*|налич*", "поряд*|последов*|очеред*", "запуск*|перезапуск*|старт*|перезагруз*", "компонент*|служб*|част*|систем*"],
      ["учен*|тест*|испытан*|трениров*|провер*", "измер*|замер*|оцен*|показыва*", "врем*|длит*|продолжитель*|сколько", "зависим*|связ*|препятств*|проблем*"],
      ["улучш*|уточн*|доработ*|обнов*|усовершенств*|скорректир*", "политик*|правил*|инструкц*|процедур*|поряд*", "копир*|копи*|резерв*", "реаг*|откл*|сбой*|перебо*|инцидент*"],
    ],
    "model-generalization": [
      ["успеш*|хорош*|высок*|качествен*|точн*", "обуч*|трениров*", "ошиб*|плох*|низк*|неточн*", "нов*|неизвест*|друг*|не вид*"],
      ["раздел*|разб*|выдел*|отлож*", "набор*|данн*|выборк*|массив*", "прежде|до|сначала|заранее|предвар*", "настрой*|обуч*|трениров*|подгон*"],
      ["обуча*|трениров*", "тестов*|провер*|контрольн*", "настрой*|параметр*|подгон*|обучен*", "оконч*|итог*|оценк*|оценив*"],
      ["измен*|меня*|смен*", "внедрен*|развертыв*|разверн*|запус*|эксплуатац*", "нов*|повтор*|снова|заново", "измер*|оцен*|провер*|тест*"],
    ],
    "schema-rollout": [
      ["схем*|структур*", "завис*|влия*|затраг*|каса*", "прилож*|программ*|сервис*", "процедур*|процесс*|операц*|работ*"],
      ["оба|обо*|дв*|стар* нов*", "формат*|верси*|схем*", "преобраз*|миграц*|перенос*|конвертац*", "запис*|данн*"],
      ["наблюд*|контрол*|отслеж*|монитор*|след*", "преобраз*|миграц*|перенос*|конвертац*", "целост*|согласован*|коррект*|правиль*"],
      ["отказ*|убрат*|удал*|прекрат*|отключ*", "стар*|прежн*|предыдущ*", "обнов*|перевод*|перевед*", "клиент*|зависим*|потребител*"],
    ],
  };

  function russianPhrase(variant) {
    return (variant.match(/[а-яёa-z0-9]+\*?/giu) || []).flatMap((form) => {
      const prefix = form.endsWith("*");
      const token = words(form)[0];
      if (!token) return [];
      return [{ stem: prefix ? token : russianStem(token), prefix }];
    });
  }

  function matchesRussianPhrase(phrase, window) {
    return phrase.every(({ stem, prefix }) => prefix
      ? window.raw.some((word) => word.startsWith(stem))
      : window.features.has(stem) || window.raw.includes(stem));
  }

  function passageReversals(answer, entry) {
    if (entry.id === "cache-locality") return [
      clauseHas(answer, /к[еэ]ш\S*\s+(?:(?:гораздо|намного|значительно)\s+)?медленн\S*\s+(?:чем\s+)?(?:оператив|основн|озу)/u),
      clauseHas(answer, /(?:последов|по порядк|смеж|сосед)/u, /(?:увеличива|больше|учаща).{0,25}промах/u),
      clauseHas(answer, /(?:обращен|запрос|перенос|загруз|чита|читыва)/u, /(?:только|лишь)\s+од(?:ин|ну|но)\s+(?:элемент|ячейк|значен)/u),
      clauseHas(answer, /(?:непредсказ|вразнобой|случайн|произвольн)/u, /промах\S*.{0,30}(?:реже|уменьш|снижа|сокра|меньше)|(?:реже|уменьш|снижа|сокра|меньше).{0,30}промах/u),
    ];
    if (entry.id === "network-latency") return [
      clauseHas(answer, /(?:пропуск|канал)/u, /(?:исключа|устраня|предотвраща).{0,18}задерж/u) && !clauseHas(answer, /(?:не|нельзя)\s+(?:исключ|устран|предотвра)/u),
      false,
      clauseHas(answer, /очеред/u, /(?:ускоря|сокраща|уменьша).{0,20}(?:отклик|задерж|ожидани)/u),
      answer.clauses.some((clause) => /максим|пиков/u.test(clause) && /скорост|пропуск/u.test(clause) && /достаточн|вполне хват/u.test(clause) && !/недостаточ|не\s+достаточ|не\s*хват|не\s+вполне/u.test(clause)),
    ];
    if (entry.id === "tested-restoration") return [
      answer.clauses.some((clause) => /(?:резерв|б[еэ]кап).{0,18}(?:копи|есть|сохран)?/u.test(clause) && /(?:гарантир|обеспечива).{0,24}восстанов/u.test(clause) && !/(?:не|нельзя)\s+(?:гарантир|обеспечива)|не\s+(?:может|способна)/u.test(clause)),
      clauseHas(answer, /оборудова|перезапуск|зависим/u, /не\s+(?:име\S*\s+значен|важн|влия\S*|нужн)/u),
      clauseHas(answer, /учен|тест|испытан/u, /не\s+(?:позвол|помога|могу|дают).{0,30}(?:измер|замер|выяв|обнаруж)/u),
      clauseHas(answer, /результат|итог/u, /не\s+(?:позвол|помога|могу|дают).{0,20}(?:улучш|уточн|доработ|измен)/u),
    ];
    return [];
  }

  function passage(value, entry) {
    const max = 8;
    const labels = entry.checkpoints;
    const answer = analyze(value, "ru");
    const reference = analyze(entry.translation, "ru");
    const early = earlyResult(max, labels, answer, reference, "ru");
    if (early) return early;
    const reversed = passageReversals(answer, entry);
    const checks = labels.map((label, index) => {
      const groups = (passageConcepts[entry.id]?.[index] || distinct(content(words(label), "ru")))
        .map((choices) => choices.split("|").map(russianPhrase).filter((phrase) => phrase.length));
      const matched = Math.max(0, ...answer.windows.map((window) => groups.filter((variants) => variants.some((phrase) => matchesRussianPhrase(phrase, window))).length));
      const threshold = Math.max(2, Math.ceil(groups.length * 0.72));
      return supported(label, matched >= threshold, matched >= Math.max(1, threshold - 1), reversed[index]);
    });
    const lengthCap = answer.tokens.length < 15 ? 3 : answer.tokens.length < reference.tokens.length * 0.36 ? 5 : max;
    const cap = Math.min(lengthCap, qualityCap(answer, "ru", max), repeatsLabels(answer, labels, "ru") ? 2 : max);
    return finish(max, checks, cap, cap < max ? "Для полной оценки нужен связный перевод всего фрагмента." : undefined);
  }

  window.EXAM_GRADING = { definition, topic, passage };
})();
