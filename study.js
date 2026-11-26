(() => {
  "use strict";

  const bank = window.EXAM_STUDY_DATA;
  const planner = window.EXAM_STUDY_PLAN;
  const $ = (id) => document.getElementById(id);
  if (!bank) {
    $("study-intro").textContent = "Банк упражнений не загрузился. Обновите страницу или откройте материалы курса.";
    $("study-card").hidden = true;
    return;
  }

  const progressKey = "it-english-exam:v1:study";
  const sessionKey = "it-english-exam:v1:study-session";
  const goalKey = "it-english-exam:v1:study-goal";
  const ledgerKey = "it-english-exam:v1:study-day";
  const historyKey = "it-english-exam:v1:history";
  const shortModes = new Set(["vocab", "abbreviations"]);
  const cards = new Map(bank.modes.flatMap(({ id }) => bank.catalog[id].map((item) => [item.id, item])));
  const exercise = {
    vocab: { instruction: "Переведите на английский", intro: "Вспомните английский термин. После проверки попробуйте повторить его по памяти.", placeholder: "Английский термин" },
    definitions: { instruction: "Дайте определение", intro: "Назовите категорию и отличительный признак или назначение. Можно начать с «It is a … that …».", placeholder: "Определение на английском" },
    abbreviations: { instruction: "Расшифруйте по-английски", intro: "Напишите полное название. Подсказка поможет вспомнить первые слова.", placeholder: "Полное название" },
    topics: { instruction: "Ответьте по-английски", intro: "Ответьте прямо, объясните принцип и добавьте пример. Для сравнения назовите обе стороны и ключевое различие.", placeholder: "Ответ на английском" },
    passages: { instruction: "Переведите на русский", intro: "Сначала найдите главную мысль. При переводе сохраните терминологию, условия и связи между предложениями.", placeholder: "Перевод" },
  };
  const modeNames = new Map(bank.modes.map(({ id, title }) => [id, title]));
  const tabNames = { vocab: "Термины", definitions: "Определения", abbreviations: "Аббревиатуры", topics: "Беседа", passages: "Перевод текста" };
  const sectionNames = { terms: "Терминология", topics: "Беседа", passages: "Перевод" };
  const taskNames = { review: "Повторение", terms: "Терминология", topics: "Вопросы по темам", passages: "Перевод текста" };
  const formatNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  const plural = new Intl.PluralRules("ru-RU");
  const selectionNames = new Set(["today", "review", ...modeNames.keys()]);
  const visit = new Set();
  const drafts = new Map();
  let progress = read(progressKey);
  let goal = planner?.normalizeTarget(read(goalKey, 20)) ?? 20;
  let ledger = read(ledgerKey);
  let plan = null;
  const saved = read(sessionKey);
  let mode = modeNames.has(saved.mode) ? saved.mode : "vocab";
  let topicId = window.EXAM_COURSE.topics.some((topic) => topic.id === saved.topicId) ? saved.topicId : "";
  let reviewing = saved.reviewing === true;
  let selection = selectionNames.has(saved.selection) ? saved.selection : reviewing ? "review" : mode;
  let activePage = "";
  let round = null;
  let audioRequest = null;
  const recent = Array.isArray(saved.recent) ? saved.recent.filter((id) => cards.has(id)).slice(-3) : [];

  function read(key, fallback = {}) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
      return value !== null && typeof value === typeof fallback ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      $("study-storage-status").textContent = "Браузер не сохранил изменения. Текущая тренировка доступна до закрытия страницы.";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  const audio = window.EXAM_STUDY_AUDIO?.create({ onChange: audioChanged });

  function sessionSnapshot() {
    return {
      selection,
      mode,
      topicId,
      reviewing,
      itemId: round?.item.id,
      answer: round?.answer,
      shownHints: round?.shownHints,
      assisted: round?.assisted,
      finished: round?.finished,
      revealed: round?.revealed,
      split: round?.split,
      recent,
    };
  }

  function saveSession() {
    write(sessionKey, sessionSnapshot());
  }

  function points(value) {
    const form = { one: "балл", few: "балла", many: "баллов", other: "балла" };
    return `${formatNumber.format(value)} ${form[plural.select(value)]}`;
  }

  function exerciseCount(value) {
    const form = { one: "упражнение", few: "упражнения", many: "упражнений", other: "упражнения" };
    return `${value} ${form[plural.select(value)]}`;
  }

  function guidedTask() {
    return plan?.tasks.find(({ id, count, done }) => id !== "mock" && done < count);
  }

  function renderReadiness(history) {
    const attempts = history.filter((row) => row?.mode === "voice" && row.full && row.timed && !row.preliminary &&
      Number.isFinite(row.total) && row.total >= 0 && row.total <= 30 && Date.parse(row.at) <= Date.now())
      .sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
    let streak = 0;
    for (const row of attempts.slice(0, 2)) {
      if (row.total < goal) break;
      streak++;
    }
    $("study-readiness").textContent = streak >= 2 ?
      "Два полных устных билета подряд на цель. Проверьте себя на новом билете." :
      `Устные билеты на цель подряд · ${streak} / 2. В зачёт идут все три части с таймером.`;
  }

  function renderPlan() {
    if (!planner) {
      $("study-start-plan").disabled = true;
      $("study-goal").disabled = true;
      return;
    }
    const history = read(historyKey, []);
    plan = planner.build({ history, progress, target: goal, ledger });
    const { baseline, target, gap, tasks, workload, dailyMinutes } = plan;
    const next = guidedTask();
    $("study-today").textContent = `${workload.done} / ${workload.count} упражнений`;
    $("study-goal-impact").textContent = `${exerciseCount(workload.count)} сегодня · ≈ ${dailyMinutes} мин`;
    $("study-tasks").innerHTML = tasks.filter(({ id }) => id !== "mock").map((task) => {
      const name = taskNames[task.id] ?? task.label;
      const complete = task.done >= task.count;
      return `<li><button type="button" class="plan-task" data-plan-task="${task.id}" data-complete="${complete}"
        aria-label="${escapeHtml(name)}, ${task.done} из ${task.count}${complete ? ", выполнено" : ""}">
        <span class="plan-check" aria-hidden="true"></span><span class="plan-label">${escapeHtml(name)}</span>
        <span class="plan-count">${task.done} / ${task.count}</span>
      </button></li>`;
    }).join("");
    $("study-start-plan").textContent = !next ? "К полному экзамену" : workload.done ? "Продолжить тренировку" : "Начать тренировку";
    $("study-focus").textContent = !next ? "План на сегодня выполнен" :
      next.id === "review" ? "Начните с повторения" :
        baseline && gap > 0 ? `Фокус · ${sectionNames[plan.focus]}` : "";

    $("study-goal").value = String(target);
    $("study-goal-result").textContent = baseline ? `${formatNumber.format(baseline.total)} / 30` : "—";
    $("study-goal-status").textContent = baseline ? gap > 0 ? `До цели ${points(gap)}` : "Цель достигнута" : "Пока нет оценки";
    $("study-goal-status").classList.toggle("goal-reached", baseline && gap === 0);
    const scale = $("study-goal-scale");
    scale.style.setProperty("--target", `${target / 30 * 100}%`);
    scale.style.setProperty("--actual", `${(baseline?.total ?? 0) / 30 * 100}%`);
    scale.setAttribute("aria-label", `Шкала от 0 до 30, цель ${points(target)}${baseline ? `, последний пробный ${points(baseline.total)}` : ""}`);
    $("study-goal-actual").hidden = !baseline;
    $("study-goal-parts").hidden = !baseline;
    if (baseline) {
      $("study-goal-parts").innerHTML = ["terms", "topics", "passages"].map((id, index) =>
        `<div><dt>${sectionNames[id]}</dt><dd>${formatNumber.format(baseline.parts[index])} / ${[10, 12, 8][index]}</dd></div>`).join("");
    }
    renderReadiness(history);
    $("study-training-meter").hidden = selection !== "today";
    $("study-session-progress").max = workload.count;
    $("study-session-progress").value = workload.done;
    $("study-session-count").textContent = `${workload.done} из ${workload.count}`;
  }

  function renderProgress() {
    const totals = bank.stats(progress);
    document.querySelectorAll("#study-modes [data-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(!reviewing && button.dataset.mode === mode));
    });
    $("study-due").textContent = totals.due;
    $("study-review").disabled = !totals.due && selection !== "review";
    $("study-review").setAttribute("aria-pressed", String(selection === "review"));
    $("study-review").firstElementChild.textContent = selection === "review" ? "К тренировке" : "Повторить";
    renderPlan();
  }

  function reviewedItem(exclude = [...visit]) {
    const selectedMode = round?.item.mode ?? mode;
    const order = bank.modes.map(({ id }) => id);
    const position = order.indexOf(selectedMode);
    const rotated = [...order.slice(position + 1), ...order.slice(0, position + 1)];
    for (const id of rotated) {
      const item = bank.pick(id, progress, { reviewOnly: true, exclude });
      if (item) return item;
    }
    return null;
  }

  function nextItem() {
    if (reviewing) return reviewedItem();
    const filter = mode === "topics" ? topicId : "";
    const item = bank.pick(mode, progress, { topicId: filter, exclude: [...visit] });
    if (item) return item;
    const last = round?.item.id;
    visit.clear();
    return bank.pick(mode, progress, { topicId: filter, exclude: last ? [last] : [] }) ??
      bank.pick(mode, progress, { topicId: filter });
  }

  function begin(item, previous = {}) {
    audioRequest = null;
    audio?.reset();
    if (item) visit.add(item.id);
    round = item ? {
      item,
      cues: bank.hints(item),
      answer: typeof previous.answer === "string" ? previous.answer : "",
      shownHints: Number.isSafeInteger(previous.shownHints) ? Math.max(0, previous.shownHints) : 0,
      assisted: previous.assisted === true,
      finished: previous.finished === true,
      revealed: previous.revealed === true,
      split: previous.split === true,
    } : null;
    render();
    saveSession();
  }

  function moveToNext(focus = true) {
    begin(nextItem());
    if (focus) $(round ? "study-prompt" : "study-empty-action").focus();
  }

  function startTask(task) {
    openTraining(task.id === "review" ? "review" : task.mode);
  }

  function openTraining(nextSelection) {
    location.hash = `train?mode=${nextSelection}`;
  }

  function advanceGuided(focus = true) {
    renderPlan();
    const checked = new Set(Object.keys(ledger.days?.[plan?.day] ?? {}));
    const reviewed = [...checked].filter((id) => ledger.days[plan.day][id].reviewed);
    const lesson = plan?.tasks.filter(({ id, count, done }) => id !== "mock" && done < count) ?? [];
    let item = null;
    let repeatLater = false;
    for (const task of lesson) {
      if (task.id === "review") {
        const exclude = [...reviewed, ...recent, ...(round ? [round.item.id] : [])];
        item = reviewedItem(exclude);
        repeatLater = !item;
      } else {
        const exclude = [...new Set([...checked, ...visit])];
        item = bank.pick(task.mode, progress, { exclude }) ??
          bank.pick(task.mode, progress, { exclude: [...checked, ...(round ? [round.item.id] : [])] });
      }
      if (item) {
        reviewing = task.id === "review";
        mode = item.mode;
        break;
      }
    }
    if (!item && repeatLater) {
      item = reviewedItem([...reviewed, ...(round ? [round.item.id] : [])]);
      reviewing = !!item;
      if (item) mode = item.mode;
    }
    begin(item);
    if (focus) $(round ? "study-prompt" : "study-empty-title").focus();
  }

  function selectTraining(requested) {
    const nextSelection = selectionNames.has(requested) ? requested : "today";
    if (selection === nextSelection && round) {
      renderProgress();
      return;
    }
    drafts.set(selection, sessionSnapshot());
    selection = nextSelection;
    const draft = drafts.get(selection);
    visit.clear();
    if (draft && cards.has(draft.itemId)) {
      mode = draft.mode;
      reviewing = draft.reviewing;
      topicId = draft.topicId;
      begin(cards.get(draft.itemId), draft);
      return;
    }
    reviewing = selection === "review";
    if (selection === "today") {
      advanceGuided(false);
      return;
    }
    if (!reviewing) mode = selection;
    moveToNext(false);
  }

  function passage() {
    const { item, split } = round;
    $("study-passage").hidden = !item.body;
    if (!item.body) return;
    const units = split ? item.body.split(/(?<=[.!?])\s+(?=[A-Z0-9])/u) : [item.body];
    $("study-source").innerHTML = units.map((sentence) => `<p>${escapeHtml(sentence)}</p>`).join("");
    $("study-split").setAttribute("aria-pressed", String(split));
    $("study-split").textContent = split ? "Показать целиком" : "Разбить на предложения";
  }

  function renderHints() {
    const hints = round.cues.slice(0, round.shownHints);
    $("study-hints").hidden = !hints.length;
    $("study-hints").innerHTML = hints.map(({ text, lang }) => `<li lang="${lang === "en" ? "en" : "ru"}">${escapeHtml(text)}</li>`).join("");
    $("study-hint").disabled = round.finished || hints.length >= round.cues.length;
    $("study-hint").textContent = hints.length ? "Ещё подсказка" : "Подсказка";
  }

  function renderFeedback(result) {
    const { item, revealed } = round;
    const el = $("study-feedback");
    const sound = audio?.state;
    const stateLabels = { met: "Учтено", partial: "Частично", missing: "Добавьте" };
    const title = revealed ? "Ответ открыт" : { correct: "Верно", partial: "Есть что дополнить", incorrect: "Стоит повторить" }[result.outcome];
    const solved = shortModes.has(item.mode) ? "Вариант ответа" : "Пример ответа";
    const aliases = (item.aliases ?? []).filter(Boolean).slice(0, 3);
    const checks = result?.checks ?? [];
    const missing = !shortModes.has(item.mode) && checks.find(({ status }) => status === "missing");
    const practiceNote = revealed || result?.outcome !== "correct" || round.assisted || round.shownHints ?
      "В очереди повторения" : "Повторение запланировано";
    const phonetics = sound?.phonetics;
    el.hidden = false;
    el.dataset.outcome = revealed ? "revealed" : result.outcome;
    el.innerHTML = `
      <h4 id="study-feedback-title" tabindex="-1">${title}${result ? ` · ${formatNumber.format(result.score)} / ${result.max}` : ""}</h4>
      ${missing ? `<p><strong>Что добавить</strong> · <span lang="${item.mode === "topics" ? "en" : "ru"}">${escapeHtml(missing.label)}</span></p>` :
        result?.feedback && result.outcome !== "correct" ? `<p>${escapeHtml(result.feedback)}</p>` : ""}
      <details class="study-feedback-detail" ${revealed || result?.outcome === "incorrect" ? "open" : ""}>
        <summary>${solved}</summary>
        <p class="study-answer-model" lang="${item.answerLanguage}">${escapeHtml(item.solution)}</p>
        ${aliases.length ? `<p>Варианты · <span lang="en">${aliases.map(escapeHtml).join(" / ")}</span></p>` : ""}
        ${item.answerLanguage === "en" && sound?.canSpeak ? `<button type="button" class="text-button" data-study-speak>${sound.speaking ? "Остановить пример" : "Прослушать пример"}</button>` : ""}
      </details>
      ${checks.length && !shortModes.has(item.mode) ? `<details class="study-feedback-detail"><summary>Пункты ответа</summary><ul class="study-checklist">${checks.map(({ label, status, detail }) => `
        <li><span class="check-state ${escapeHtml(status)}">${stateLabels[status] ?? "Сверьте"}</span><span>${escapeHtml(label)}</span>
          ${detail ? `<small> ${escapeHtml(detail)}</small>` : ""}</li>`).join("")}</ul></details>` : ""}
      ${Number.isFinite(phonetics?.score) ? `<p>Приблизительное совпадение звуков ${Math.round(phonetics.score * 100)}%</p>` : ""}
      ${phonetics?.feedback ? `<details class="study-feedback-detail"><summary>Произношение</summary><p>${escapeHtml(phonetics.feedback)}</p></details>` : ""}
      <p class="study-note">${practiceNote}</p>`;
  }

  function render() {
    renderProgress();
    const displayMode = round?.item.mode ?? mode;
    $("study-title").textContent = reviewing ? "Повторение" : modeNames.get(displayMode);
    $("study-title").hidden = !reviewing;
    $("study-intro").textContent = reviewing ? "Вспомните ответы на карточки, у которых подошло время повторения." : exercise[displayMode].intro;
    $("study-topic-filter").hidden = reviewing || selection === "today" || mode !== "topics";
    $("study-topic").value = topicId;
    $("study-form-status").textContent = "";
    $("study-card").hidden = !round;
    $("study-empty").hidden = !!round;
    if (!round) {
      const guided = selection === "today";
      if (guided) {
        const finished = !guidedTask();
        $("study-empty-title").textContent = finished ? "Тренировка завершена" : "На сейчас всё";
        $("study-empty-message").textContent = finished ? "Проверьте себя на новом билете с таймером." : "Оставшиеся упражнения доступны из плана.";
        $("study-empty-action").textContent = "К плану";
        $("study-empty-exam").hidden = !finished;
        return;
      }
      const repeatAvailable = reviewing && bank.stats(progress).due > 0;
      $("study-empty-title").textContent = repeatAvailable ? "Круг повторения завершён" : "На сейчас всё";
      $("study-empty-message").textContent = repeatAvailable ? "Можно ещё раз пройти оставшиеся карточки или вернуться к новым заданиям." :
        "Карточки появятся здесь, когда их пора будет повторить.";
      $("study-empty-action").textContent = repeatAvailable ? "Повторить ещё раз" : "Продолжить подготовку";
      $("study-empty-exam").hidden = false;
      return;
    }
    const { item, finished, revealed } = round;
    $("study-instruction").textContent = exercise[item.mode].instruction;
    $("study-prompt").textContent = item.prompt;
    $("study-prompt").lang = item.promptLanguage;
    $("study-topic-label").textContent = item.mode === "topics" || item.mode === "passages" ? item.topicTitle ?? "" : "";
    passage();

    const input = $("study-answer");
    input.value = round.answer;
    input.rows = shortModes.has(item.mode) ? 2 : item.mode === "passages" ? 5 : 4;
    input.lang = item.answerLanguage;
    input.placeholder = exercise[item.mode].placeholder;
    input.readOnly = finished;
    const result = finished && !revealed ? (round.result ??= bank.grade(item, round.answer)) : null;
    if (finished) renderFeedback(result);
    else $("study-feedback").hidden = true;
    $("study-retry").hidden = !finished;
    $("study-check").hidden = finished;
    $("study-reveal").hidden = finished;
    const repair = finished && (revealed || result?.outcome !== "correct");
    $("study-next").textContent = finished ? "Дальше" : "Пропустить";
    $("study-card").dataset.finished = String(finished);
    $("study-retry").className = repair ? "button primary" : "text-button";
    $("study-next").classList.toggle("primary", finished && !repair);
    $("study-next").classList.toggle("secondary", !finished || repair);
    renderHints();
    renderAudio(audio?.state);
  }

  function finish(revealed) {
    if (!round || round.finished) return;
    const answer = $("study-answer").value.trim();
    const status = $("study-form-status");
    if (!answer && !revealed) {
      status.textContent = "Введите ответ или воспользуйтесь подсказкой.";
      $("study-answer").focus();
      return;
    }
    const result = revealed ? null : bank.grade(round.item, answer);
    round.answer = answer;
    round.finished = true;
    round.revealed = revealed;
    round.result = result;
    const previousVisit = recent.indexOf(round.item.id);
    if (previousVisit !== -1) recent.splice(previousVisit, 1);
    recent.push(round.item.id);
    if (recent.length > 3) recent.shift();
    const before = read(progressKey, progress);
    const now = Date.now();
    const previous = before.items?.[round.item.id];
    progress = bank.record(before, round.item, {
      outcome: result?.outcome ?? "incorrect",
      helped: revealed || round.assisted || round.shownHints > 0,
    }, now);
    if (result && planner) {
      ledger = planner.record(read(ledgerKey, ledger), {
        id: round.item.id,
        mode: round.item.mode,
        reviewed: reviewing || Number.isFinite(previous?.dueAt) && previous.dueAt <= now,
      }, now);
      write(ledgerKey, ledger);
    }
    write(progressKey, progress);
    saveSession();
    render();
    $("study-feedback-title").focus();
  }

  function renderAudio(state) {
    if (!round || !state) return;
    $("study-audio").hidden = !state.canRecord;
    const recorder = $("study-record");
    const playing = state.phase === "recording";
    const waiting = ["requesting", "stopping", "checking"].includes(state.phase);
    recorder.disabled = waiting || round.finished;
    recorder.classList.toggle("recording-active", playing);
    $("study-record-label").textContent = playing ? "Закончить запись" : state.url ? "Перезаписать ответ" : "Записать ответ";
    $("study-transcribe").hidden = !state.url || waiting || playing || round.finished;
    $("study-cancel-audio").hidden = state.phase !== "checking";
    $("study-check").disabled = waiting || playing;
    $("study-reveal").disabled = waiting || playing;
    const player = $("study-recording");
    player.hidden = !state.url || playing || state.phase === "requesting" || state.phase === "stopping";
    if (state.url && player.getAttribute("src") !== state.url) player.src = state.url;
    if (!state.url && player.hasAttribute("src")) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    let note = state.error ?? "";
    if (!note && playing) note = "Идёт запись.";
    if (!note && state.phase === "requesting") note = "Подключаем микрофон…";
    if (!note && state.phase === "stopping") note = "Готовим запись…";
    if (!note && state.phase === "checking") {
      const phase = state.progress?.phase;
      const percent = state.progress?.percent;
      note = state.progress?.message ?? (phase === "loading" ? `Загружаем модель${Number.isFinite(percent) ? ` · ${percent}%` : ""}…` :
        phase === "pronunciation" ? "Проверяем произношение…" : "Расшифровываем запись…");
    }
    if (!note && state.text && !round.finished) note = "Проверьте текст расшифровки перед оценкой.";
    $("study-audio-status").textContent = note;
    const speakButton = $("study-feedback").querySelector("[data-study-speak]");
    if (speakButton) speakButton.textContent = state.speaking ? "Остановить пример" : "Прослушать пример";
  }

  function audioChanged(state) {
    if (!round) return;
    if (audioRequest && state.phase === "ready") {
      const request = audioRequest;
      audioRequest = null;
      if (state.text && !round.finished && round.item.id === request.id && round.answer === request.initialAnswer) {
        round.answer = state.text;
        $("study-answer").value = round.answer;
        saveSession();
      }
    }
    renderAudio(state);
  }

  $("study-modes").innerHTML = bank.modes.map(({ id }) => `
    <button type="button" class="study-mode" data-mode="${id}" aria-pressed="false">
      ${escapeHtml(tabNames[id])}
    </button>`).join("");
  $("study-goal").innerHTML = Array.from({ length: 21 }, (_, index) => {
    const value = index + 10;
    return `<option value="${value}">${value} / 30</option>`;
  }).join("");
  $("study-topic").innerHTML = '<option value="">Все 16 тем</option>' +
    [3, 4].map((semester) => `<optgroup label="${semester}-й семестр">${window.EXAM_COURSE.topics.filter((item) => item.semester === semester)
      .map(({ id, title }) => `<option value="${escapeHtml(id)}">${escapeHtml(title)}</option>`).join("")}</optgroup>`).join("");

  $("study-modes").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button && selection !== button.dataset.mode) openTraining(button.dataset.mode);
  });
  $("study-topic").addEventListener("change", (event) => {
    topicId = event.target.value;
    moveToNext();
  });
  $("study-review").addEventListener("click", () => {
    openTraining(selection === "review" ? "today" : "review");
  });
  $("study-goal").addEventListener("change", (event) => {
    if (!planner) return;
    goal = planner.normalizeTarget(event.target.value);
    write(goalKey, goal);
    renderPlan();
    if (plan) $("study-home-status").textContent = `Цель ${points(goal)} · план на ${exerciseCount(plan.workload.count)}`;
  });
  $("study-start-plan").addEventListener("click", () => {
    if (guidedTask()) openTraining("today");
    else location.hash = "trainer";
  });
  $("study-tasks").addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-task]");
    const task = button && plan?.tasks.find(({ id }) => id === button.dataset.planTask);
    if (task) startTask(task);
  });
  $("study-empty-action").addEventListener("click", () => {
    if (selection === "today") {
      location.hash = "practice";
      return;
    }
    if (!bank.stats(progress).due) {
      openTraining("today");
      return;
    }
    visit.clear();
    moveToNext();
  });
  $("study-next").addEventListener("click", () => {
    if (selection === "today") advanceGuided();
    else moveToNext();
  });
  $("study-retry").addEventListener("click", () => {
    begin(round.item, { assisted: true, split: round.split });
    $("study-answer").focus();
  });
  $("study-hint").addEventListener("click", () => {
    if (round.finished || round.shownHints >= round.cues.length) return;
    round.shownHints++;
    renderHints();
    saveSession();
  });
  $("study-reveal").addEventListener("click", () => finish(true));
  $("study-split").addEventListener("click", () => {
    round.split = !round.split;
    passage();
    saveSession();
  });
  $("study-answer").addEventListener("input", (event) => {
    round.answer = event.target.value;
    $("study-form-status").textContent = "";
    saveSession();
  });
  $("study-answer").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && shortModes.has(round.item.mode) && !round.finished) {
      event.preventDefault();
      if (!$("study-check").disabled) finish(false);
    }
  });
  $("study-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("study-check").disabled) finish(false);
  });
  $("study-record").addEventListener("click", () => {
    if (audio.state.phase === "recording") audio.stop();
    else {
      $("study-recording").pause();
      audio.start();
    }
  });
  $("study-transcribe").addEventListener("click", () => {
    audioRequest = { id: round.item.id, initialAnswer: round.answer };
    audio.check({ language: round.item.answerLanguage, pronunciation: round.item.mode === "topics" || round.item.mode === "definitions" });
  });
  $("study-cancel-audio").addEventListener("click", () => {
    audioRequest = null;
    audio.cancelCheck();
  });
  $("study-feedback").addEventListener("click", (event) => {
    if (!event.target.closest("[data-study-speak]")) return;
    if (audio.state.speaking) audio.stopModel();
    else {
      $("study-recording").pause();
      audio.playModel(round.item.solution);
    }
  });
  $("study-recording").addEventListener("play", () => audio?.stopModel());
  window.addEventListener("storage", (event) => {
    if (event.key === progressKey) {
      progress = read(progressKey);
    }
    if (event.key === ledgerKey) ledger = read(ledgerKey);
    if (event.key === goalKey) goal = planner?.normalizeTarget(read(goalKey, 20)) ?? 20;
    if ([progressKey, ledgerKey, goalKey, historyKey].includes(event.key)) renderProgress();
  });
  setInterval(() => {
    if ((activePage === "practice" || activePage === "train") && plan?.day !== planner?.day()) renderProgress();
  }, 5_000);

  const previous = cards.get(saved.itemId);
  if (previous && (selection === "today" || reviewing || (previous.mode === mode && (!topicId || mode !== "topics" || previous.topicId === topicId)))) {
    begin(previous, saved);
  } else if (selection === "today") {
    advanceGuided(false);
  } else {
    moveToNext(false);
  }

  window.EXAM_STUDY_UI = {
    show(page, requested) {
      if (activePage === "train" && page !== "train") {
        audioRequest = null;
        audio?.reset();
      }
      if (page === "train") selectTraining(requested);
      if (page === "practice") renderProgress();
      else $("study-home-status").textContent = "";
      activePage = page;
    },
  };
  window.addEventListener("pagehide", () => {
    audioRequest = null;
    audio?.reset();
  });
})();
