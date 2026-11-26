(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const vocabulary = window.EXAM_VOCABULARY;
  const course = window.EXAM_COURSE;
  const grading = window.EXAM_GRADING;
  const SpeechRecognizer = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const storage = "it-english-exam:v1:";
  const dataVersion = 2;
  const defaultDate = "2026-12-10";
  const maximum = [10, 12, 8];
  const tracks = [
    ["2.1", "Using the Compunet Browser", "Search Engines"],
    ["3.1", "How Computers Process Information", "Programming Languages"],
    ["3.2", "The Development of Java", "Programming Languages"],
    ["4.1", "Blogs and the History of Blogging", "Web Design"],
    ["5.1", "Viruses", "Malware and Cybercrime"],
    ["5.2", "A Conversation About a Suspected Virus", "Malware and Cybercrime"],
    ["6.1", "An Email About Data Security", "Data Security"],
    ["6.2", "A Conversation About Firewall Settings", "Data Security"],
  ];

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(storage + key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(storage + key, JSON.stringify(value));
      return true;
    } catch {
      $("storage-status").textContent = "Хранилище браузера недоступно. Черновик доступен до закрытия страницы.";
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function randomIndexes(array, count, eligible = () => true) {
    const candidates = array.map((item, index) => ({ item, index })).filter(({ item, index }) => eligible(item, index));
    const picked = [];
    while (picked.length < count && candidates.length) {
      const choice = Math.floor(Math.random() * candidates.length);
      picked.push(candidates.splice(choice, 1)[0].index);
    }
    return picked;
  }

  const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" });
  const moscowDay = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Europe/Moscow" });
  const pluralDays = new Intl.PluralRules("ru-RU");
  const history = read("history", []);
  let examDate = read("date", defaultDate);
  let seconds = read("seconds", 40);
  if (![30, 40, 50].includes(seconds)) seconds = 40;

  let deadline = 0;
  let timerState = "ready";
  let timerText = "";
  let reviewParts = null;
  let reviewMode = "written";
  let reviewPending = false;
  let reviewComplete = false;
  let answerMode = "written";
  let voice;
  let currentMaterial = "topics";
  let currentPage = "";

  const uniqueAbbreviations = [];
  const seenAbbreviations = new Set();

  function buildTicket(number, previous) {
    const used = new Set(previous?.translations ?? []);
    const availableCount = vocabulary.translations.length - used.size;
    const translations = randomIndexes(vocabulary.translations, 4, (_, index) => availableCount < 4 || !used.has(index));
    const definitions = randomIndexes(vocabulary.definitions, 2);
    const abbreviations = randomIndexes(uniqueAbbreviations, 2);
    const semester3 = randomIndexes(course.topics, 2, (topic) => topic.semester === 3);
    const semester4 = randomIndexes(course.topics, 2, (topic) => topic.semester === 4);
    const topics = [...semester3, ...semester4].map((index) => ({
      index,
      question: Math.floor(Math.random() * course.topics[index].questions.length),
    }));
    const passage = randomIndexes(course.passages, 1, (_, index) => course.passages.length === 1 || index !== previous?.passage)[0];
    return { number, translations, definitions, abbreviations, topics, passage, answers: {} };
  }

  function getTicketItems(data) {
    return {
      translations: data.translations.map((index) => vocabulary.translations[index]),
      definitions: data.definitions.map((index) => vocabulary.definitions[index]),
      abbreviations: data.abbreviations.map((index) => uniqueAbbreviations[index]),
      topics: data.topics.map(({ index, question }) => ({
        topic: course.topics[index],
        question: course.topics[index]?.questions[question],
      })),
      passage: course.passages[data.passage],
    };
  }

  function validTicket(data) {
    if (!data || data.dataVersion !== dataVersion || !Number.isSafeInteger(data.number) || data.number < 1 || !data.answers) return false;
    try {
      const items = getTicketItems(data);
      return items.translations.length === 4 && items.definitions.length === 2 && items.abbreviations.length === 2 &&
        [...items.translations, ...items.definitions, ...items.abbreviations].every(Boolean) &&
        items.topics.length === 4 && items.topics.every(({ topic, question }) => topic && question) && !!items.passage;
    } catch {
      return false;
    }
  }

  let ticket;
  function saveDraft() {
    ticket.dataVersion = dataVersion;
    write("ticket", ticket);
  }
  const ticketLabel = () => String(ticket.number).padStart(2, "0");

  function renderDate() {
    const today = moscowDay.format(new Date());
    const target = new Date(examDate + "T00:00:00+03:00");
    if (!Number.isFinite(target.getTime())) {
      examDate = defaultDate;
      renderDate();
      return;
    }
    const days = Math.round((Date.parse(examDate) - Date.parse(today)) / 86400000);
    const inflection = { one: "день", few: "дня", many: "дней", other: "дней" }[pluralDays.select(days)];
    $("days-left").textContent = days > 0 ? `До экзамена ${days} ${inflection}` : days === 0 ? "Экзамен сегодня" : "Дата экзамена прошла";
    $("exam-date-label").textContent = dateFormat.format(target).replace(/\sг\.$/, "");
  }

  function renderTicket() {
    const { translations, definitions, abbreviations, topics, passage } = getTicketItems(ticket);
    $("ticket").innerHTML = `
      <header class="paper-top"><strong>Иностранный язык</strong><span>3–4-й семестры</span></header>
      <div class="paper-heading"><h3>Экзаменационный билет № ${ticketLabel()}</h3><p lang="en">Essential English for IT Students</p></div>
      <section class="paper-section">
        <h4>1. Терминология (до ${maximum[0]}&nbsp;баллов)</h4>
        <p><strong>а)</strong> Переведите на английский язык: ${translations.map(({ru}) => escapeHtml(ru)).join("; ")}.</p>
        <p><strong>б)</strong> Дайте определения на английском языке: <span lang="en">${definitions.map(({term}) => escapeHtml(term)).join("; ")}</span>.</p>
        <p><strong>в)</strong> Расшифруйте аббревиатуры: <span lang="en">${abbreviations.map(({short}) => escapeHtml(short)).join("; ")}</span>.</p>
      </section>
      <section class="paper-section">
        <h4>2. Ответьте на вопросы по четырём темам (до ${maximum[1]}&nbsp;баллов)</h4>
        <ol lang="en">${topics.map(({topic, question}) => `<li><strong>${escapeHtml(topic.title)}.</strong> ${escapeHtml(question.prompt)}</li>`).join("")}</ol>
      </section>
      <section class="paper-section">
        <h4>3. Переведите фрагмент с английского на русский язык устно с листа (до ${maximum[2]}&nbsp;баллов)</h4>
        <p class="paper-passage-title" lang="en">${escapeHtml(passage.title)}</p>
        <p class="paper-passage" lang="en">${escapeHtml(passage.text)}</p>
      </section>
      <footer class="paper-footer"><span>На подготовку ${seconds} сек.</span><span>Тренировочный вариант</span></footer>`;
  }

  function answerRow(key, prompt, language, multiline = false, placeholder = "") {
    const inputAttributes = `id="answer-${key}" data-answer="${key}" lang="${language}" placeholder="${escapeHtml(placeholder)}"`;
    const value = escapeHtml(ticket.answers[key]);
    return `<div class="answer-row"><div class="answer-label"><label for="answer-${key}">${escapeHtml(prompt)}</label>
      ${SpeechRecognizer ? `<button type="button" class="text-button dictate-button" data-dictate="${key}" aria-controls="answer-${key}" aria-pressed="false" aria-label="Диктовать ответ · ${escapeHtml(prompt)}">Диктовать</button>` : ""}
      </div>
      ${multiline
        ? `<textarea ${inputAttributes} rows="2" maxlength="4000">${value}</textarea>`
        : `<input type="text" ${inputAttributes} value="${value}" autocomplete="off" spellcheck="false" maxlength="250">`}
      ${SpeechRecognizer ? `<p class="dictation-status" id="dictation-${key}" role="status"></p>` : ""}
      </div>`;
  }

  function renderAnswers() {
    const { translations, definitions, abbreviations, topics, passage } = getTicketItems(ticket);
    $("answer-fields").innerHTML = `
      <div class="answer-block">
        <h3>1. Терминология</h3>
        <div class="vocab-grid">${translations.map(({ru}, index) => answerRow(`v${index}`, ru, "en", false, "Перевод на английский")).join("")}</div>
        ${definitions.map(({term}, index) => answerRow(`d${index}`, term, "en", true, "Определение на английском")).join("")}
        <div class="vocab-grid">${abbreviations.map(({short}, index) => answerRow(`a${index}`, short, "en", false, "Полная расшифровка")).join("")}</div>
      </div>
      <div class="answer-block">
        <h3>2. Беседа по темам</h3>
        ${topics.map(({question}, index) => answerRow(`q${index}`, question.prompt, "en", true, "Ответ на английском")).join("")}
      </div>
      <div class="answer-block">
        <h3>3. Перевод с листа</h3>
        ${answerRow("passage", passage.title, "ru", true, "Перевод на русский")}
      </div>`;
  }

  function voiceTasks() {
    const { translations, definitions, abbreviations, topics, passage } = getTicketItems(ticket);
    return [
      ...translations.map(({ ru }, index) => ({ key: "v" + index, prompt: ru, promptLanguage: "ru", section: "Переведите на английский" })),
      ...definitions.map(({ term }, index) => ({ key: "d" + index, prompt: term, promptLanguage: "en", section: "Дайте определение на английском" })),
      ...abbreviations.map(({ short }, index) => ({ key: "a" + index, prompt: short, promptLanguage: "en", section: "Расшифруйте аббревиатуру" })),
      ...topics.map(({ topic, question }, index) => ({
        key: "q" + index, prompt: question.prompt, promptLanguage: "en", section: topic.title, phonetics: true,
      })),
      { key: "passage", prompt: "Переведите фрагмент с английского на русский язык", promptLanguage: "ru", section: "Перевод с листа", passage: passage.text, language: "ru" },
    ].map((task) => ({ language: "en", ...task }));
  }

  function switchAnswerMode(mode) {
    if (answerMode === mode || !voice) return;
    answerMode = mode;
    const oral = mode === "voice";
    document.querySelectorAll("[data-answer-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.answerMode === mode));
    });
    if (oral) {
      cancelDictation();
      if (recorder?.state === "recording") recorder.stop();
    }
    $("answer-form").hidden = oral;
    $("written-recording").hidden = oral;
    $("dictation-help").hidden = oral || !SpeechRecognizer;
    $("answers-help").textContent = oral ? "Отвечайте в порядке билета. Когда закончите, отправьте записи на проверку." :
      "Впишите ответы и нажмите «Проверить ответы», чтобы получить оценку из 30.";
    voice.show(oral);
    closeReview();
  }

  function setTimerMessage(value) {
    if (timerText === value) return;
    timerText = value;
    $("timer-status").textContent = value;
  }

  function updateTimer() {
    if (timerState === "running" && Date.now() >= deadline) timerState = "expired";
    const remaining = timerState === "ready" ? seconds : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const newTime = "00:" + String(remaining).padStart(2, "0");
    if ($("timer-clock").textContent !== newTime) $("timer-clock").textContent = newTime;
    $("timer-progress").firstElementChild.style.width = `${remaining / seconds * 100}%`;
    document.querySelector(".timer-card").classList.toggle("expired", timerState === "expired");
    if (timerState === "running") {
      $("timer-toggle").textContent = "Остановить отсчёт";
      setTimerMessage("Идёт подготовка.");
    } else if (timerState === "expired") {
      $("timer-toggle").textContent = "Запустить заново";
      setTimerMessage("Время вышло. Начинайте отвечать.");
    } else {
      $("timer-toggle").textContent = "Запустить отсчёт";
      setTimerMessage("Выберите длительность отсчёта.");
    }
  }

  function startTimer() {
    deadline = Date.now() + seconds * 1000;
    ticket.deadline = deadline;
    ticket.usedTimer = true;
    saveDraft();
    timerState = "running";
    updateTimer();
  }

  function stopTimer() {
    delete ticket.deadline;
    saveDraft();
    timerState = "ready";
    updateTimer();
  }

  function setTimerButtons() {
    document.querySelectorAll("[data-seconds]").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === seconds));
    });
  }

  function normalized(value) {
    return value.normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[’']/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^(?:a|an|the) /, "");
  }

  function autoMatch(input, reference, aliases = []) {
    if (!input) return false;
    const values = [reference, ...aliases, reference.replace(/\s*\([^)]*\)/g, "")];
    return values.some((value) => normalized(value) === normalized(input));
  }

  function scoreText(score, max) {
    return `${numberFormat.format(score)} / ${max}`;
  }

  function userAnswer(answer, lang, voiceDetail) {
    const audio = voiceDetail ? `<audio class="review-answer-audio" controls preload="none" src="${escapeHtml(voiceDetail.url)}" aria-label="Запись ответа"></audio>` : "";
    const missing = voiceDetail ? voiceDetail.transcriptIssue || "Запись пока не расшифрована." : "Ответ пропущен.";
    const text = answer ? `<p class="user-answer" lang="${lang}">${escapeHtml(answer)}</p>` : `<p class="user-answer">${escapeHtml(missing)}</p>`;
    return audio + text;
  }

  function gradeShort(key, input, prompt, reference, aliases = []) {
    const score = Number(autoMatch(input, reference, aliases));
    const note = input ? score ? "Совпало со словарём." : "Сверьте формулировку с вариантами ниже." : "";
    const alternatives = aliases.filter((alias) => normalized(alias) !== normalized(reference));
    return { key, input, prompt, reference, score, note, alternatives };
  }

  function reviewVocab({ input, prompt, reference, score, note, alternatives }, voiceDetail) {
    return `<div class="review-row">
      ${reviewHeading(prompt, score, 1)}
      ${userAnswer(input, "en", voiceDetail)}
      ${note ? `<p>${note}</p>` : ""}
      <p><strong>По словарю</strong> <span lang="en">${escapeHtml(reference)}</span></p>
      ${alternatives.length ? `<p class="user-answer">Также <span lang="en">${alternatives.map(escapeHtml).join("; ")}</span></p>` : ""}
    </div>`;
  }

  function reviewHeading(title, score, max, lang = "ru") {
    return `<header class="review-row-head"><h4 lang="${lang}">${escapeHtml(title)}</h4><span class="review-score">${scoreText(score, max)}</span></header>`;
  }

  function checklist(checks, lang) {
    if (!checks.length) return "";
    const labels = { met: "Найдено", partial: "Частично", missing: "Не найдено" };
    return `<ul class="checkpoints">${checks.map(({ label, status, detail }) => `
      <li><span class="check-state ${escapeHtml(status)}">${labels[status] ?? labels.missing}</span>
        <span lang="${lang}">${escapeHtml(label)}</span>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
      </li>`).join("")}</ul>`;
  }

  function oralTopicScore(result, voiceDetail) {
    const contentScore = Math.round(result.score * (2.5 / 3) * 2) / 2;
    const soundScore = voiceDetail?.phonetics?.score;
    const phoneticScore = !Number.isFinite(soundScore) ? null : soundScore >= 0.66 ? 0.5 : soundScore >= 0.44 ? 0.25 : 0;
    return { ...result, score: contentScore + (phoneticScore ?? 0), contentScore, phoneticScore };
  }

  function reviewPronunciation(result, voiceDetail) {
    if (result.contentScore === undefined || !voiceDetail) return "";
    const phonetics = voiceDetail.phonetics;
    const pauseDetail = voiceDetail.delivery?.checks?.find((check) => check.label === "Паузы внутри ответа")?.detail;
    const percent = Number.isFinite(phonetics?.score) ? `Совпадение звуков ${Math.round(phonetics.score * 100)}%.` : "";
    const phoneticResult = result.phoneticScore === null ? "ожидает оценки" : scoreText(result.phoneticScore, "0,5");
    return `<div class="voice-feedback">
      <p><strong>Содержание</strong> ${scoreText(result.contentScore, "2,5")} <strong>Произношение</strong> ${phoneticResult}</p>
      ${percent ? `<p>${percent}</p>` : ""}
      ${phonetics?.feedback ? `<p>${escapeHtml(phonetics.feedback)}</p>` : ""}
      ${pauseDetail ? `<p>${escapeHtml(pauseDetail)}</p>` : ""}
    </div>`;
  }

  function reviewOpen(key, input, title, result, example, lang, prompt = "", voiceDetail) {
    return `<div class="review-row">
      ${reviewHeading(title, result.score, result.max, "en")}
      ${prompt ? `<p lang="en">${escapeHtml(prompt)}</p>` : ""}
      ${userAnswer(input, lang, voiceDetail)}
      ${result.feedback && input ? `<p>${escapeHtml(result.feedback)}</p>` : ""}
      ${reviewPronunciation(result, voiceDetail)}
      ${checklist(result.checks, lang)}
      <p><strong>${key === "passage" ? "Пример перевода" : "Пример ответа"}</strong></p>
      <p lang="${lang}">${escapeHtml(example)}</p>
    </div>`;
  }

  function renderReview(voiceResult = null) {
    const { translations, definitions, abbreviations, topics, passage } = getTicketItems(ticket);
    const answers = voiceResult ? voiceResult.answers : ticket.answers;
    const voiceDetails = voiceResult?.voiceDetails ?? {};
    const answer = (key) => answers[key]?.trim() ?? "";
    const vocabularyResults = translations.map(({ ru, en, aliases }, index) => gradeShort(`v${index}`, answer(`v${index}`), ru, en, aliases));
    const definitionResults = definitions.map((entry, index) => grading.definition(answer(`d${index}`), entry));
    const abbreviationResults = abbreviations.map(({ short, full, aliases }, index) => gradeShort(`a${index}`, answer(`a${index}`), short, full, aliases));
    const topicResults = topics.map(({ question }, index) => {
      const key = `q${index}`;
      const result = grading.topic(answer(key), question);
      return voiceResult ? oralTopicScore(result, voiceDetails[key]) : result;
    });
    const passageResult = grading.passage(answer("passage"), passage);
    const totalPoints = (results) => results.reduce((sum, result) => sum + result.score, 0);
    $("review-fields").innerHTML = `
      <div class="review-block"><h3>1. Терминология</h3>
        ${vocabularyResults.map((result) => reviewVocab(result, voiceDetails[result.key])).join("")}
        ${definitions.map(({term, definition}, index) => reviewOpen(`d${index}`, answer(`d${index}`), term, definitionResults[index], definition, "en", "", voiceDetails[`d${index}`])).join("")}
        ${abbreviationResults.map((result) => reviewVocab(result, voiceDetails[result.key])).join("")}
      </div>
      <div class="review-block"><h3>2. Беседа по темам</h3>
        ${topics.map(({topic, question}, index) => reviewOpen(`q${index}`, answer(`q${index}`), topic.title, topicResults[index], question.model, "en", question.prompt, voiceDetails[`q${index}`])).join("")}
      </div>
      <div class="review-block"><h3>3. Перевод с листа</h3>
        ${reviewOpen("passage", answer("passage"), passage.title, passageResult, passage.translation, "ru", "", voiceDetails.passage)}
      </div>`;
    $("review").hidden = false;
    reviewMode = voiceResult ? "voice" : "written";
    reviewComplete = voiceTasks().every(({ key }) => answer(key).length > 0);
    $("review-method").textContent = voiceResult ? "Содержание оценивается по расшифровке. В четырёх вопросах беседы тренажёр приблизительно сравнивает звуки записи с произношением распознанных слов." :
      "Тренажёр сверяет термины со словарём и ищет ключевые мысли в развёрнутых ответах. Оценка ориентировочная и учитывает текст ответа.";
    $("review-record").hidden = !!voiceResult || !recordingUrl;
    const pending = !!(voiceResult?.missingTranscripts || voiceResult?.missingPhonetics);
    reviewPending = pending;
    $("review-voice-note").hidden = !pending;
    $("review-voice-note").textContent = pending ? "Итог предварительный. Для некоторых записей нужна повторная расшифровка или проверка звуков." : "";
    $("save-attempt").disabled = !!voiceResult && !Object.keys(answers).length;
    $("edit-answers").textContent = voiceResult ? "Вернуться к записям" : "Вернуться к ответам";
    $("save-status").textContent = "";
    updateScore([
      totalPoints([...vocabularyResults, ...definitionResults, ...abbreviationResults]),
      totalPoints(topicResults),
      passageResult.score,
    ]);
    $("review-title").focus();
  }

  function updateScore(parts = null) {
    reviewParts = parts;
    const total = parts?.reduce((sum, score) => sum + score, 0) ?? 0;
    $("sidebar-score").textContent = parts ? numberFormat.format(total) : "—";
    maximum.forEach((cap, index) => {
      const sectionScore = scoreText(parts?.[index] ?? 0, cap);
      $("part-score-" + (index + 1)).textContent = parts ? sectionScore : cap;
      $("result-part-" + (index + 1)).textContent = sectionScore;
    });
    $("review-total").textContent = scoreText(total, 30);
  }

  function closeReview() {
    $("review").hidden = true;
    updateScore();
  }

  let recorder = null;
  let recordingPending = false;
  let recordingUrl = "";
  let recordingStream = null;
  let dictation = null;

  function finishDictation(session, message = "") {
    if (dictation !== session) return;
    dictation = null;
    session.button.setAttribute("aria-pressed", "false");
    session.button.textContent = "Диктовать";
    session.status.textContent = message;
    $("review-button").disabled = !grading;
  }

  function cancelDictation() {
    if (!dictation) return;
    const session = dictation;
    finishDictation(session);
    session.recognition.abort();
  }

  function toggleDictation(button) {
    const key = button.dataset.dictate;
    const status = $("dictation-" + key);
    if (dictation) {
      if (dictation.button === button) {
        status.textContent = "Завершаем диктовку…";
        dictation.recognition.stop();
      } else {
        status.textContent = "Сначала завершите диктовку в другом поле.";
      }
      return;
    }
    if (recorder?.state === "recording" || recordingPending) {
      status.textContent = "Для диктовки сначала остановите запись.";
      return;
    }

    const field = $("answer-" + key);
    const recognition = new SpeechRecognizer();
    recognition.lang = field.lang === "ru" ? "ru-RU" : "en-GB";
    recognition.continuous = field.tagName === "TEXTAREA";
    const session = { button, status, recognition, transcribed: false };
    dictation = session;
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Закончить диктовку";
    status.textContent = "Подключаем микрофон…";
    $("review-button").disabled = true;

    recognition.onstart = () => {
      if (dictation === session) status.textContent = "Говорите. Распознанный текст появится в поле.";
    };
    recognition.onresult = (event) => {
      if (dictation !== session) return;
      const phrase = Array.from(event.results).slice(event.resultIndex)
        .filter((result) => result.isFinal).map((result) => result[0].transcript.trim()).filter(Boolean).join(" ");
      if (!phrase) return;
      session.transcribed = true;
      field.value = [field.value.trimEnd(), phrase].filter(Boolean).join(" ").slice(0, field.maxLength);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    recognition.onerror = ({ error }) => {
      const message = {
        "not-allowed": "Разрешите браузеру использовать микрофон для диктовки.",
        "service-not-allowed": "Сервис диктовки недоступен в этом браузере.",
        "audio-capture": "Браузер не обнаружил доступный микрофон.",
        "no-speech": "Речь не распознана. Повторите или введите текст.",
      }[error] ?? "Диктовка недоступна. Можно ввести ответ вручную.";
      finishDictation(session, message);
    };
    recognition.onend = () => finishDictation(session, session.transcribed ? "Текст добавлен. Проверьте его перед оценкой." : "Речь не распознана. Повторите или введите текст.");
    try {
      recognition.start();
    } catch {
      finishDictation(session, "Диктовка недоступна. Можно ввести ответ вручную.");
    }
  }

  function clearRecording() {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = "";
    $("record-audio").removeAttribute("src");
    $("review-audio").removeAttribute("src");
    $("record-playback").hidden = true;
    $("review-record").hidden = true;
    $("record-status").textContent = "";
  }

  async function toggleRecording() {
    const button = $("record");
    if (dictation) {
      $("record-status").textContent = "Сначала завершите диктовку.";
      return;
    }
    if (recorder?.state === "recording") {
      button.disabled = true;
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      $("record-status").textContent = "Микрофон недоступен на этой странице. Можно ответить вслух или ввести ответы.";
      return;
    }
    if (recordingPending) return;
    button.disabled = true;
    recordingPending = true;
    const recordingTicket = ticket.number;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ticket.number !== recordingTicket) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      recordingStream = stream;
      const activeRecorder = new MediaRecorder(stream);
      recorder = activeRecorder;
      const parts = [];
      activeRecorder.addEventListener("dataavailable", ({ data }) => { if (data.size) parts.push(data); });
      activeRecorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        recordingStream = null;
        button.disabled = false;
        button.classList.remove("recording-active");
        button.lastChild.textContent = "Записать для прослушивания";
        if (ticket.number !== recordingTicket) return;
        if (!parts.length) {
          $("record-status").textContent = "Запись пуста. Попробуйте говорить чуть дольше.";
          return;
        }
        clearRecording();
        const type = activeRecorder.mimeType || parts[0].type || "audio/webm";
        recordingUrl = URL.createObjectURL(new Blob(parts, { type }));
        $("record-audio").src = recordingUrl;
        $("review-audio").src = recordingUrl;
        $("record-download").href = recordingUrl;
        $("record-download").download = `bilet-${ticketLabel()}.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`;
        $("record-playback").hidden = false;
        $("review-record").hidden = false;
        $("record-status").textContent = "Запись готова. Можно прослушать или скачать.";
      }, { once: true });
      activeRecorder.start();
      button.classList.add("recording-active");
      button.lastChild.textContent = "Остановить запись";
      $("record-status").textContent = "Идёт запись.";
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      $("record-status").textContent = "Не удалось подключить микрофон. Проверьте разрешение и устройство.";
    } finally {
      button.disabled = false;
      recordingPending = false;
    }
  }

  function createNextTicket() {
    cancelDictation();
    if (recorder?.state === "recording") recorder.stop();
    clearRecording();
    const nextNumber = ticket.number + 1;
    ticket = buildTicket(nextNumber, ticket);
    saveDraft();
    closeReview();
    renderTicket();
    renderAnswers();
    voice?.reset(voiceTasks());
    startTimer();
  }

  function renderMaterials() {
    const query = normalized($("material-search").value);
    const contains = (...values) => !query || values.some((value) => normalized(String(value ?? "")).includes(query));
    const output = $("material-output");
    let markup = "";
    if (currentMaterial === "topics") {
      for (const semester of [3, 4]) {
        const topics = course.topics.filter((item) => item.semester === semester && contains(item.title, ...item.questions.map((q) => q.prompt)));
        if (!topics.length) continue;
        markup += `<h3 class="semester-label">${semester}-й семестр</h3>`;
        markup += topics.map((topic) => `
          <details class="material-topic"><summary lang="en">${escapeHtml(topic.title)}</summary>
          ${topic.questions.map((question) => `<div lang="en"><p><strong>${escapeHtml(question.prompt)}</strong></p><p>${escapeHtml(question.model)}</p></div>`).join("")}
          </details>`).join("");
      }
    } else if (currentMaterial === "audio") {
      markup = tracks.filter((track) => contains(...track)).map(([id, title, topic]) => `
        <article class="audio-row">
          <div><h3 lang="en">${id} · ${escapeHtml(title)}</h3><p lang="en">${escapeHtml(topic)}</p></div>
          <audio controls preload="none" src="audio/${id}.mp3" aria-label="${escapeHtml(title)}"></audio>
        </article>`).join("");
    } else {
      const [leftKey, rightKey, leftTitle, rightTitle] = {
        translations: ["ru", "en", "Русский", "Английский"],
        definitions: ["term", "definition", "Термин", "Определение"],
        abbreviations: ["short", "full", "Аббревиатура", "Расшифровка"],
      }[currentMaterial];
      const rows = vocabulary[currentMaterial].filter((row) => contains(row[leftKey], row[rightKey], row.topic, ...(row.aliases ?? [])));
      if (rows.length) markup = `
        <div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">${leftTitle}</th><th scope="col">${rightTitle}</th></tr></thead>
        <tbody>${rows.map((row) => `<tr><td lang="${leftKey === "ru" ? "ru" : "en"}">${escapeHtml(row[leftKey])}</td><td lang="en">${escapeHtml(row[rightKey])}</td></tr>`).join("")}</tbody>
        </table></div>`;
    }
    output.innerHTML = markup || '<p class="empty">По этому запросу ничего не найдено.</p>';
  }

  function renderHistory() {
    const target = $("history-content");
    if (!history.length) {
      target.innerHTML = '<p class="empty">Сохраните результат проверки, чтобы увидеть его здесь.</p>';
      return;
    }
    const best = Math.max(...history.map((row) => row.total));
    const studied = new Set(history.flatMap((row) => row.topicIds ?? [])).size;
    target.innerHTML = `
      <div class="stats">
        <div><strong>${history.length}</strong><span>Попыток</span></div>
        <div><strong>${numberFormat.format(best)} / 30</strong><span>Лучший результат</span></div>
        <div><strong>${studied} / ${course.topics.length}</strong><span>Тем в билетах</span></div>
      </div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Билет</th><th scope="col">Дата</th><th scope="col">Термины</th><th scope="col">Беседа</th><th scope="col">Перевод</th><th scope="col">Итого</th></tr></thead>
      <tbody>${history.map((row) => `
        <tr><td>№ ${row.number}${row.mode === "voice" ? " · устно" : ""}</td><td>${dateFormat.format(new Date(row.at))}</td>
          ${row.parts.map((value, index) => `<td>${numberFormat.format(value)} / ${maximum[index]}</td>`).join("")}
          <td><strong>${numberFormat.format(row.total)} / 30</strong>${row.preliminary ? " · предварительно" : ""}</td>
        </tr>`).join("")}</tbody></table></div>`;
  }

  function showPage() {
    const [requested, query = ""] = location.hash.slice(1).split("?", 2);
    const titles = { practice: "Подготовка к экзамену", train: "Тренировка", trainer: "Полный экзамен", materials: "Материалы", history: "История" };
    const page = Object.hasOwn(titles, requested) ? requested : "practice";
    if (page !== "trainer" && currentPage !== page) {
      cancelDictation();
      voice?.suspend();
    }
    const tab = page === "train" ? "practice" : page;
    document.querySelectorAll("[data-page]").forEach((link) => {
      if (link.dataset.page === tab) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    for (const name of Object.keys(titles)) $("page-" + name).hidden = name !== page;
    $("page-title").textContent = titles[page];
    $("edit-date").hidden = page !== "practice" && page !== "trainer";
    if (page === "materials") renderMaterials();
    if (page === "history") renderHistory();
    window.EXAM_STUDY_UI?.show(page, new URLSearchParams(query).get("mode"));
    if (currentPage && page !== currentPage) {
      window.scrollTo(0, 0);
      $("page-title").focus({ preventScroll: true });
    }
    currentPage = page;
  }

  if (!vocabulary || !course?.topics?.length || !course?.passages?.length) {
    $("ticket").textContent = "Материалы билета не загрузились. Откройте страницу из полной папки тренажёра.";
    return;
  }

  vocabulary.abbreviations.forEach((item) => {
    const key = item.short.toLowerCase();
    if (seenAbbreviations.has(key)) return;
    seenAbbreviations.add(key);
    uniqueAbbreviations.push(item);
  });

  ticket = read("ticket", null);
  if (!validTicket(ticket)) ticket = buildTicket(Math.max(0, ...history.map((row) => row.number)) + 1);
  delete ticket.marks;
  if (Number.isFinite(ticket.deadline)) {
    deadline = ticket.deadline;
    timerState = "running";
  }
  saveDraft();
  renderDate();
  renderTicket();
  renderAnswers();
  if (window.EXAM_VOICE) {
    voice = window.EXAM_VOICE.create({
      onReview: (result) => { if (grading && answerMode === "voice") renderReview(result); },
      onChange: closeReview,
    });
    voice.reset(voiceTasks());
  } else {
    document.querySelector('[data-answer-mode="voice"]').disabled = true;
  }
  $("dictation-help").hidden = !SpeechRecognizer;
  if (!grading) {
    $("review-button").disabled = true;
    $("storage-status").textContent = "Не удалось загрузить проверку. Обновите страницу.";
  }
  setTimerButtons();
  updateTimer();
  showPage();
  setInterval(updateTimer, 200);
  setInterval(renderDate, 30000);

  window.addEventListener("hashchange", showPage);
  document.addEventListener("play", (event) => {
    if (event.target.tagName === "AUDIO") {
      document.querySelectorAll("audio").forEach((audio) => {
        if (audio !== event.target && !audio.paused) audio.pause();
      });
    }
  }, true);
  window.addEventListener("pagehide", () => {
    cancelDictation();
    voice?.suspend();
    recordingStream?.getTracks().forEach((track) => track.stop());
  });

  $("new-ticket").addEventListener("click", () => {
    const hasWork = Object.values(ticket.answers).some((answer) => answer.trim());
    const hasUnsavedAnswers = hasWork && !history.some((row) => row.number === ticket.number && row.savedRevision === (ticket.revision ?? 0));
    if (hasUnsavedAnswers || voice?.hasWork || dictation || recordingUrl || recordingPending || recorder?.state === "recording") {
      $("ticket-dialog").returnValue = "";
      $("ticket-dialog").showModal();
    } else createNextTicket();
  });
  $("ticket-dialog").addEventListener("close", () => {
    if ($("ticket-dialog").returnValue === "new") createNextTicket();
  });
  $("print-ticket").addEventListener("click", () => window.print());

  document.querySelectorAll("[data-seconds]").forEach((button) => {
    button.addEventListener("click", () => {
      seconds = Number(button.dataset.seconds);
      write("seconds", seconds);
      setTimerButtons();
      renderTicket();
      if (timerState === "running") startTimer();
      else stopTimer();
    });
  });
  $("timer-toggle").addEventListener("click", () => {
    if (timerState === "running") stopTimer();
    else startTimer();
  });
  $("go-to-answers").addEventListener("click", () => {
    $("answers-title").focus({ preventScroll: true });
    $("answers").scrollIntoView({ block: "start" });
  });

  $("edit-date").addEventListener("click", () => {
    $("date-input").value = examDate;
    $("date-dialog").returnValue = "";
    $("date-dialog").showModal();
  });
  $("date-dialog").addEventListener("close", () => {
    if ($("date-dialog").returnValue !== "save") return;
    examDate = $("date-input").value;
    write("date", examDate);
    renderDate();
  });

  $("answer-form").addEventListener("input", (event) => {
    const key = event.target.dataset.answer;
    if (!key) return;
    ticket.answers[key] = event.target.value;
    ticket.revision = (ticket.revision ?? 0) + 1;
    saveDraft();
    if (!$("review").hidden) closeReview();
  });

  $("answer-form").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dictate]");
    if (button) toggleDictation(button);
  });

  $("answer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (dictation || !grading) return;
    if (timerState === "running") stopTimer();
    if (recorder?.state === "recording") recorder.stop();
    renderReview();
  });

  document.querySelectorAll("[data-answer-mode]").forEach((button) => {
    button.addEventListener("click", () => switchAnswerMode(button.dataset.answerMode));
  });

  $("save-attempt").addEventListener("click", () => {
    if (!reviewParts || $("save-attempt").disabled) return;
    const existingIndex = history.findIndex((row) => row.number === ticket.number && (row.mode ?? "written") === reviewMode);
    if (existingIndex !== -1) history.splice(existingIndex, 1);
    history.unshift({
      number: ticket.number,
      at: new Date().toISOString(),
      total: reviewParts.reduce((sum, score) => sum + score, 0),
      parts: reviewParts,
      topicIds: getTicketItems(ticket).topics.map(({ topic }) => topic.id),
      savedRevision: ticket.revision ?? 0,
      mode: reviewMode,
      preliminary: reviewPending,
      full: reviewComplete,
      timed: ticket.usedTimer === true || Number.isFinite(ticket.deadline),
    });
    const persisted = write("history", history);
    $("save-status").textContent = persisted ? "Результат сохранён в истории попыток." : "Результат доступен в истории до закрытия страницы.";
  });
  $("edit-answers").addEventListener("click", () => {
    closeReview();
    $(answerMode === "voice" ? "voice-check" : "review-button").focus();
  });

  $("record").addEventListener("click", toggleRecording);
  document.querySelectorAll("[data-material]").forEach((button) => {
    button.addEventListener("click", () => {
      currentMaterial = button.dataset.material;
      document.querySelectorAll("[data-material]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      $("material-search").value = "";
      renderMaterials();
    });
  });
  $("material-search").addEventListener("input", renderMaterials);
})();
