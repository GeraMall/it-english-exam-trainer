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
    definitions: { instruction: "Дайте определение", intro: "По-английски назовите, что это такое и для чего используется. Достаточно одного или двух предложений.", placeholder: "Определение на английском" },
    abbreviations: { instruction: "Расшифруйте по-английски", intro: "Напишите полное название. Подсказка поможет вспомнить первые слова.", placeholder: "Полное название" },
    topics: { instruction: "Ответьте по-английски", intro: "Объясните своими словами и сравните ответ с опорными мыслями в разборе.", placeholder: "Ответ на английском" },
    passages: { instruction: "Переведите на русский", intro: "Передайте смысл и связи между предложениями. Фрагмент можно разбить на предложения.", placeholder: "Перевод" },
  };
  const modeNames = new Map(bank.modes.map(({ id, title }) => [id, title]));
  const tabNames = { vocab: "Термины", definitions: "Определения", abbreviations: "Аббревиатуры", topics: "Беседа", passages: "Перевод текста" };
  const sectionNames = { terms: "Терминология", topics: "Беседа", passages: "Перевод" };
  const taskNames = { review: "Повторение", terms: "Терминология", topics: "Вопросы по темам", passages: "Перевод текста", mock: "Пробный билет" };
  const formatNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  const plural = new Intl.PluralRules("ru-RU");
  const visit = new Set();
  let progress = read(progressKey);
  let goal = planner?.normalizeTarget(read(goalKey, 20)) ?? 20;
  let ledger = read(ledgerKey);
  let plan = null;
  const saved = read(sessionKey);
  let mode = modeNames.has(saved.mode) ? saved.mode : "vocab";
  let topicId = window.EXAM_COURSE.topics.some((topic) => topic.id === saved.topicId) ? saved.topicId : "";
  let reviewing = saved.reviewing === true;
  let visible = false;
  let round = null;
  let audioRequest = null;

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

  function saveSession() {
    write(sessionKey, {
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
    });
  }

  function points(value) {
    const form = { one: "балл", few: "балла", many: "баллов", other: "балла" };
    return `${formatNumber.format(value)} ${form[plural.select(value)]}`;
  }

  function renderPlan() {
    if (!planner) {
      $("study-start-plan").disabled = true;
      $("study-goal").disabled = true;
      return;
    }
    plan = planner.build({ history: read(historyKey, []), progress, target: goal, ledger });
    const { baseline, target, gap, tasks, completed, todayCards } = plan;
    const next = tasks.find(({ count, done }) => done < count);
    $("study-today").textContent = `${completed} из ${tasks.length} шагов`;
    $("study-tasks").innerHTML = tasks.map((task) => {
      const name = taskNames[task.id] ?? task.label;
      const complete = task.done >= task.count;
      return `<li><button type="button" class="plan-task" data-plan-task="${task.id}" data-complete="${complete}"
        aria-label="${escapeHtml(name)}, ${task.done} из ${task.count}${complete ? ", выполнено" : ""}">
        <span class="plan-check" aria-hidden="true"></span><span class="plan-label">${escapeHtml(name)}</span>
        <span class="plan-count">${task.done} / ${task.count}</span>
      </button></li>`;
    }).join("");
    $("study-start-plan").textContent = next?.id === "mock" || !next ? "К пробному билету" : todayCards ? "Продолжить" : "Начать тренировку";
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
    $("study-goal-breakdown").hidden = !baseline;
    if (baseline) {
      $("study-goal-parts").innerHTML = ["terms", "topics", "passages"].map((id, index) =>
        `<div><dt>${sectionNames[id]}</dt><dd>${formatNumber.format(baseline.parts[index])} / ${[10, 12, 8][index]}</dd></div>`).join("");
    }
  }

  function renderProgress() {
    const totals = bank.stats(progress);
    document.querySelectorAll("#study-modes [data-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(!reviewing && button.dataset.mode === mode));
    });
    $("study-due").textContent = totals.due;
    $("study-review").disabled = !totals.due && !reviewing;
    $("study-review").setAttribute("aria-pressed", String(reviewing));
    $("study-review").firstElementChild.textContent = reviewing ? "Выйти из повторения" : "Повторить";
    renderPlan();
  }

  function reviewedItem() {
    const selectedMode = round?.item.mode ?? mode;
    const order = bank.modes.map(({ id }) => id);
    const position = order.indexOf(selectedMode);
    const rotated = [...order.slice(position + 1), ...order.slice(0, position + 1)];
    for (const id of rotated) {
      const item = bank.pick(id, progress, { reviewOnly: true, exclude: [...visit] });
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
    if (!task || task.id === "mock") {
      location.hash = "trainer";
      return;
    }
    if (task.id === "review") {
      if (reviewing && round && !round.finished) {
        $("study-prompt").focus();
        return;
      }
      reviewing = true;
      visit.clear();
    } else {
      if (!reviewing && mode === task.mode && round && !round.finished) {
        $("study-prompt").focus();
        return;
      }
      mode = task.mode;
      reviewing = false;
    }
    moveToNext();
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
    const practiceNote = revealed || result?.outcome !== "correct" || round.assisted || round.shownHints ?
      "Карточка доступна в повторении." : "Карточка вернётся позже для проверки по памяти.";
    const phonetics = sound?.phonetics;
    el.hidden = false;
    el.dataset.outcome = revealed ? "revealed" : result.outcome;
    el.innerHTML = `
      <h4 id="study-feedback-title" tabindex="-1">${title}${result ? ` · ${formatNumber.format(result.score)} / ${result.max}` : ""}</h4>
      ${result?.feedback ? `<p>${escapeHtml(result.feedback)}</p>` : ""}
      ${checks.length ? `<ul class="study-checklist">${checks.map(({ label, status, detail }) => `
        <li><span class="check-state ${escapeHtml(status)}">${stateLabels[status] ?? "Сверьте"}</span><span>${escapeHtml(label)}</span>
          ${detail ? `<small> ${escapeHtml(detail)}</small>` : ""}</li>`).join("")}</ul>` : ""}
      <p>${solved}</p>
      <p class="study-answer-model" lang="${item.answerLanguage}">${escapeHtml(item.solution)}</p>
      ${aliases.length ? `<p>Допустимые варианты · <span lang="en">${aliases.map(escapeHtml).join(" / ")}</span></p>` : ""}
      ${item.answerLanguage === "en" && sound?.canSpeak ? `<button type="button" class="text-button" data-study-speak>${sound.speaking ? "Остановить пример" : "Прослушать пример"}</button>` : ""}
      ${Number.isFinite(phonetics?.score) ? `<p>Приблизительное совпадение звуков ${Math.round(phonetics.score * 100)}%.</p>` : ""}
      ${phonetics?.feedback ? `<p>${escapeHtml(phonetics.feedback)}</p>` : ""}
      <p class="study-note">${practiceNote}</p>`;
  }

  function render() {
    renderProgress();
    const displayMode = round?.item.mode ?? mode;
    $("study-title").textContent = reviewing ? "Повторение" : modeNames.get(displayMode);
    $("study-title").hidden = !reviewing;
    $("study-intro").textContent = reviewing ? "Вспомните ответы на карточки, у которых подошло время повторения." : exercise[displayMode].intro;
    $("study-topic-filter").hidden = reviewing || mode !== "topics";
    $("study-topic").value = topicId;
    $("study-form-status").textContent = "";
    $("study-card").hidden = !round;
    $("study-empty").hidden = !!round;
    if (!round) {
      const repeatAvailable = reviewing && bank.stats(progress).due > 0;
      $("study-empty-title").textContent = repeatAvailable ? "Круг повторения завершён" : "На сейчас всё";
      $("study-empty-message").textContent = repeatAvailable ? "Можно ещё раз пройти оставшиеся карточки или вернуться к новым заданиям." :
        "Карточки появятся здесь, когда их пора будет повторить.";
      $("study-empty-action").textContent = repeatAvailable ? "Повторить ещё раз" : "Продолжить подготовку";
      return;
    }
    const { item, finished, revealed } = round;
    $("study-instruction").textContent = exercise[item.mode].instruction;
    $("study-prompt").textContent = item.prompt;
    $("study-prompt").lang = item.promptLanguage;
    $("study-topic-label").textContent = item.topicTitle ?? "";
    passage();

    const input = $("study-answer");
    input.value = round.answer;
    input.rows = shortModes.has(item.mode) ? 2 : item.mode === "passages" ? 5 : 4;
    input.lang = item.answerLanguage;
    input.placeholder = exercise[item.mode].placeholder;
    input.readOnly = finished;
    if (finished) renderFeedback(revealed ? null : (round.result ??= bank.grade(item, round.answer)));
    else $("study-feedback").hidden = true;
    $("study-retry").hidden = !finished;
    $("study-check").hidden = finished;
    $("study-reveal").hidden = finished;
    $("study-next").textContent = finished ? "Следующее упражнение" : "Пропустить";
    $("study-card").dataset.finished = String(finished);
    $("study-next").classList.toggle("primary", finished);
    $("study-next").classList.toggle("secondary", !finished);
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
    if (!button || (!reviewing && mode === button.dataset.mode)) return;
    mode = button.dataset.mode;
    reviewing = false;
    moveToNext();
  });
  $("study-topic").addEventListener("change", (event) => {
    topicId = event.target.value;
    moveToNext();
  });
  $("study-review").addEventListener("click", () => {
    reviewing = !reviewing;
    if (reviewing) visit.clear();
    moveToNext();
  });
  $("study-goal").addEventListener("change", (event) => {
    if (!planner) return;
    goal = planner.normalizeTarget(event.target.value);
    write(goalKey, goal);
    renderPlan();
  });
  $("study-start-plan").addEventListener("click", () => {
    if (plan) startTask(plan.tasks.find(({ count, done }) => done < count));
  });
  $("study-tasks").addEventListener("click", (event) => {
    const button = event.target.closest("[data-plan-task]");
    const task = button && plan?.tasks.find(({ id }) => id === button.dataset.planTask);
    if (task) startTask(task);
  });
  $("study-empty-action").addEventListener("click", () => {
    if (!bank.stats(progress).due) reviewing = false;
    visit.clear();
    moveToNext();
  });
  $("study-next").addEventListener("click", () => moveToNext());
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
    if (visible && plan?.day !== planner?.day()) renderProgress();
  }, 5_000);

  const previous = cards.get(saved.itemId);
  if (previous && (reviewing || (previous.mode === mode && (!topicId || mode !== "topics" || previous.topicId === topicId)))) {
    begin(previous, saved);
  } else moveToNext(false);

  window.EXAM_STUDY_UI = {
    show(nextVisible) {
      if (visible && !nextVisible) {
        audioRequest = null;
        audio?.reset();
      }
      if (nextVisible) renderProgress();
      visible = nextVisible;
    },
  };
  window.addEventListener("pagehide", () => {
    audioRequest = null;
    audio?.reset();
  });
})();
