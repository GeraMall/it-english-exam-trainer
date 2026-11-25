(() => {
  "use strict";

  const bank = window.EXAM_STUDY_DATA;
  const $ = (id) => document.getElementById(id);
  if (!bank) {
    $("study-intro").textContent = "Банк упражнений не загрузился. Обновите страницу или откройте материалы курса.";
    $("study-card").hidden = true;
    return;
  }

  const progressKey = "it-english-exam:v1:study";
  const sessionKey = "it-english-exam:v1:study-session";
  const shortModes = new Set(["vocab", "abbreviations"]);
  const cards = new Map(bank.modes.flatMap(({ id }) => bank.catalog[id].map((item) => [item.id, item])));
  const exercise = {
    vocab: { instruction: "Переведите на английский", intro: "Вспомните английский термин. После проверки можно повторить его по памяти.", placeholder: "Термин на английском" },
    definitions: { instruction: "Объясните термин на английском", intro: "Назовите, что это такое и для чего используется. Достаточно одного или двух предложений.", placeholder: "Определение на английском" },
    abbreviations: { instruction: "Расшифруйте аббревиатуру", intro: "Напишите полное название по-английски. Подсказка поможет вспомнить первые слова.", placeholder: "Полная расшифровка" },
    topics: { instruction: "Ответьте на вопрос по-английски", intro: "Попробуйте объяснить своими словами. В разборе сравните ответ с опорными мыслями.", placeholder: "Ответ на английском" },
    passages: { instruction: "Переведите фрагмент на русский", intro: "Передайте смысл и связи между предложениями. Длинный фрагмент можно разбить на предложения.", placeholder: "Перевод на русский" },
  };
  const modeNames = new Map(bank.modes.map(({ id, title }) => [id, title]));
  const formatNumber = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  const visit = new Set();
  let progress = read(progressKey);
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
      return value && typeof value === "object" ? value : fallback;
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

  function renderProgress() {
    const totals = bank.stats(progress);
    let startedModes = 0;
    document.querySelectorAll("#study-modes [data-mode]").forEach((button) => {
      const id = button.dataset.mode;
      const info = totals.modes[id];
      startedModes += Number(info.attempted > 0);
      button.querySelector(".study-mode-count").textContent = `${info.attempted} / ${info.total}`;
      button.setAttribute("aria-pressed", String(!reviewing && id === mode));
    });
    $("study-progress").textContent = `Виды заданий ${startedModes} из ${bank.modes.length} · Карточек разобрано ${totals.attempted}`;
    $("study-progress-bar").value = startedModes;
    $("study-due").textContent = totals.due;
    $("study-review").disabled = !totals.due && !reviewing;
    $("study-review").setAttribute("aria-pressed", String(reviewing));
    $("study-review").firstElementChild.textContent = reviewing ? "Выйти из повторения" : "Повторить карточки";
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
    progress = bank.record(read(progressKey, progress), round.item, {
      outcome: result?.outcome ?? "incorrect",
      helped: revealed || round.assisted || round.shownHints > 0,
    });
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

  $("study-modes").innerHTML = bank.modes.map(({ id, title }) => `
    <button type="button" class="study-mode" data-mode="${id}" aria-pressed="false">
      <span>${escapeHtml(title)}</span><span class="study-mode-count"></span>
    </button>`).join("");
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
      renderProgress();
    }
  });

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
