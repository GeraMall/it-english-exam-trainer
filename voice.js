(() => {
  "use strict";

  const maxSeconds = 120;
  const $ = (id) => document.getElementById(id);
  const timeLabel = (seconds) => [Math.floor(seconds / 60), seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
  const recordingExt = (type) => type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";

  function create({ onReview, onChange }) {
    const recordings = new Map();
    let tasks = [];
    let index = 0;
    let active = false;
    let capture = null;
    let operation = null;
    let notice = "";
    const supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    const elapsed = () => capture?.started ? Math.floor((Date.now() - capture.started) / 1000) : 0;

    function render(focus = false) {
      const task = tasks[index];
      if (!task) return;
      const record = recordings.get(task.key);
      $("voice-section").textContent = task.section;
      $("voice-position").textContent = `${index + 1} из ${tasks.length}`;
      $("voice-prompt").textContent = task.prompt;
      $("voice-prompt").lang = task.promptLanguage;
      $("voice-passage").textContent = task.passage ?? "";
      $("voice-passage").hidden = !task.passage;

      const recording = capture?.phase === "recording";
      $("voice-record").disabled = !supported || !!operation || (!!capture && !recording);
      $("voice-record").classList.toggle("recording-active", recording);
      $("voice-record-label").textContent = recording ? "Завершить ответ" : record ? "Перезаписать ответ" : "Начать ответ";
      $("voice-duration").textContent = timeLabel(capture ? elapsed() : record?.seconds ?? 0);
      $("voice-status").textContent = notice || (record ? "Ответ записан." : "");
      $("voice-prev").disabled = !index || !!capture;
      $("voice-next").disabled = index === tasks.length - 1 || !!capture;
      $("voice-check").disabled = !recordings.size || !!capture || !!operation;
      $("voice-cancel-check").hidden = !operation;
      $("voice-count").textContent = `Записано ${recordings.size} из ${tasks.length}`;

      const audio = $("voice-audio");
      const transcript = $("voice-transcript");
      const transcriptBox = $("voice-transcript-wrap");
      transcriptBox.hidden = !record?.attempted || !!capture || !!operation;
      if (transcript.dataset.task !== task.key) {
        transcriptBox.open = false;
        transcript.dataset.task = task.key;
      }
      transcript.lang = task.language;
      transcript.value = record?.text ?? "";
      $("voice-playback").hidden = !record;
      if (record) {
        if (audio.getAttribute("src") !== record.url) audio.src = record.url;
        $("voice-download").href = record.url;
        $("voice-download").download = `oral-${task.key}.${recordingExt(record.blob.type)}`;
      } else if (audio.hasAttribute("src")) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      if (focus) $("voice-prompt").focus();
    }

    function closeCapture(session) {
      clearInterval(session.clock);
      session.stream?.getTracks().forEach((track) => track.stop());
      if (capture === session) capture = null;
    }

    function stopCapture() {
      if (capture?.phase !== "recording") return;
      const session = capture;
      session.phase = "stopping";
      clearInterval(session.clock);
      notice = "Сохраняем запись…";
      render();
      if (session.recorder.state !== "inactive") session.recorder.stop();
    }

    function discardCapture() {
      if (!capture) return;
      const session = capture;
      capture = null;
      if (session.recorder?.state === "recording") session.recorder.stop();
      closeCapture(session);
    }

    async function startRecording() {
      if (!active || !supported || operation || capture || !tasks[index]) return;
      const session = { task: tasks[index], phase: "requesting" };
      capture = session;
      notice = "Подключаем микрофон…";
      $("voice-audio").pause();
      render();
      try {
        session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (capture !== session || !active) {
          closeCapture(session);
          return;
        }
        const recorder = new MediaRecorder(session.stream);
        session.recorder = recorder;
        const parts = [];
        recorder.addEventListener("dataavailable", ({ data }) => { if (data.size) parts.push(data); });
        recorder.addEventListener("error", () => {
          if (capture !== session) return;
          closeCapture(session);
          notice = "Не удалось записать ответ. Попробуйте ещё раз.";
          render();
        }, { once: true });
        recorder.addEventListener("stop", () => {
          const completed = capture === session;
          const seconds = session.started ? Math.floor((Date.now() - session.started) / 1000) : 0;
          closeCapture(session);
          if (!completed) return;
          if (!parts.length) {
            notice = "Запись пуста. Попробуйте ещё раз.";
            render();
            return;
          }
          const blob = new Blob(parts, { type: recorder.mimeType || parts[0].type });
          const old = recordings.get(session.task.key);
          if (old) URL.revokeObjectURL(old.url);
          recordings.set(session.task.key, { blob, url: URL.createObjectURL(blob), seconds });
          notice = "";
          $("voice-check-status").textContent = "";
          onChange();
          render();
        }, { once: true });
        recorder.start();
        session.phase = "recording";
        session.started = Date.now();
        notice = "Идёт запись. В конце нажмите «Завершить ответ».";
        session.clock = setInterval(() => {
          const seconds = elapsed();
          $("voice-duration").textContent = timeLabel(seconds);
          if (seconds >= maxSeconds) stopCapture();
        }, 250);
        render();
      } catch (error) {
        const failed = capture === session;
        closeCapture(session);
        if (!failed) return;
        notice = error.name === "NotAllowedError" ? "Разрешите доступ к микрофону и попробуйте ещё раз." : "Микрофон недоступен. Проверьте подключение и попробуйте снова.";
        render();
      }
    }

    function changeTask(offset) {
      if (capture || !tasks[index + offset]) return;
      index += offset;
      notice = "";
      render(true);
    }

    function cancelCheck() {
      if (!operation) return;
      operation.abort();
      operation = null;
      $("voice-check-status").textContent = "Проверка остановлена. Записи готовы к повторной проверке.";
      $("voice-check-progress").hidden = true;
      render();
    }

    async function checkRecordings() {
      if (operation || capture || !recordings.size) return;
      const controller = new AbortController();
      operation = controller;
      const signal = controller.signal;
      const selected = tasks.filter((task) => recordings.has(task.key));
      const progress = $("voice-check-progress");
      const status = $("voice-check-status");
      progress.max = selected.length;
      progress.value = 0;
      progress.hidden = false;
      $("voice-audio").pause();
      render();
      const show = (message) => { if (operation === controller) status.textContent = message; };
      let modelIssue = "";

      try {
        for (const [position, task] of selected.entries()) {
          const record = recordings.get(task.key);
          const prefix = `Запись ${position + 1} из ${selected.length}.`;
          show(`${prefix} Распознаём речь…`);
          if (!record.text) {
            try {
              if (modelIssue) throw new Error(modelIssue);
              const options = {
                language: task.language,
                signal,
                onProgress: ({ phase, percent }) => {
                  if (phase === "loading") {
                    const percentText = Number.isFinite(percent) ? ` · ${Math.round(percent)}%` : "";
                    show(`${prefix} Загружаем модель распознавания${percentText}…`);
                  } else if (phase === "transcribing") {
                    show(`${prefix} Распознаём речь…`);
                  }
                },
              };
              const result = await window.EXAM_TRANSCRIPTION.transcribe(record.blob, options);
              signal.throwIfAborted();
              record.text = result.text.trim();
              record.transcriptIssue = record.text ? "" : "Речь не распознана. Можно прослушать или перезаписать ответ.";
            } catch (error) {
              signal.throwIfAborted();
              record.text = "";
              if (error?.code === "MODEL_UNAVAILABLE") modelIssue = error.message;
              record.transcriptIssue = modelIssue || "Не удалось прочитать речь в этой записи. Попробуйте повторить проверку.";
            }
            record.attempted = true;
          }

          if (task.phonetics && record.text && !Number.isFinite(record.phonetics?.score)) {
            show(`${prefix} Проверяем произношение…`);
            try {
              const phonetics = await window.EXAM_PHONEMES.assess(record.blob, record.text, {
                signal,
                onProgress: () => show(`${prefix} Готовим анализ произношения…`),
              });
              signal.throwIfAborted();
              record.phonetics = phonetics;
            } catch {
              signal.throwIfAborted();
              record.phonetics = { score: null, feedback: "Не удалось загрузить или запустить проверку звуков." };
            }
            try {
              if (!record.delivery) {
                const delivery = await window.EXAM_PRONUNCIATION.fromBlob(record.blob, {
                  language: "en",
                  max: 5,
                  recognition: [{ transcript: record.text }],
                });
                signal.throwIfAborted();
                record.delivery = delivery;
              }
            } catch {
              // The phoneme result is usable without delivery metrics.
            }
            signal.throwIfAborted();
          }
          progress.value = position + 1;
        }

        const answers = {};
        const voiceDetails = {};
        let missingTranscripts = 0;
        let missingPhonetics = 0;
        for (const task of selected) {
          const record = recordings.get(task.key);
          if (record.text) answers[task.key] = record.text;
          else missingTranscripts++;
          if (task.phonetics && record.text && !Number.isFinite(record.phonetics?.score)) missingPhonetics++;
          voiceDetails[task.key] = { url: record.url, phonetics: record.phonetics, delivery: record.delivery, transcriptIssue: record.transcriptIssue };
        }
        show(missingTranscripts || missingPhonetics ? "Некоторые записи требуют повторной проверки. Подробности ниже." : "Устные ответы проверены.");
        onReview({ answers, voiceDetails, missingTranscripts, missingPhonetics });
      } catch (error) {
        if (!signal.aborted) show("Проверка прервалась. Записи доступны для повторной проверки.");
      } finally {
        if (operation === controller) {
          operation = null;
          progress.hidden = true;
          render();
        }
      }
    }

    $("voice-record").addEventListener("click", () => {
      if (capture) stopCapture();
      else startRecording();
    });
    $("voice-prev").addEventListener("click", () => changeTask(-1));
    $("voice-next").addEventListener("click", () => changeTask(1));
    $("voice-check").addEventListener("click", checkRecordings);
    $("voice-cancel-check").addEventListener("click", cancelCheck);
    $("voice-save-transcript").addEventListener("click", () => {
      const record = recordings.get(tasks[index]?.key);
      if (!record || operation) return;
      const text = $("voice-transcript").value.trim();
      if (text === record.text) return;
      record.text = text;
      record.transcriptIssue = "";
      record.phonetics = null;
      notice = "Расшифровка сохранена. Запустите проверку ещё раз.";
      onChange();
      render();
    });

    return {
      show(value) {
        active = value;
        $("voice-practice").hidden = !value;
        if (!value) {
          cancelCheck();
          if (capture?.phase === "requesting") discardCapture();
          else stopCapture();
          $("voice-audio").pause();
        } else {
          notice = supported ? "" : "Для записи откройте сайт в браузере с доступом к микрофону.";
          render();
        }
      },
      reset(nextTasks) {
        cancelCheck();
        discardCapture();
        for (const record of recordings.values()) URL.revokeObjectURL(record.url);
        recordings.clear();
        tasks = nextTasks;
        index = 0;
        notice = "";
        $("voice-check-status").textContent = "";
        render();
      },
      get hasWork() {
        return !!capture || !!operation || recordings.size > 0;
      },
      suspend() {
        cancelCheck();
        discardCapture();
        $("voice-audio").pause();
        render();
      },
    };
  }

  window.EXAM_VOICE = { create };
})();
