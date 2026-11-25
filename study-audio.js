(() => {
  "use strict";

  const maxSeconds = 120;

  function create({ onChange } = {}) {
    const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    const canSpeak = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
    let capture = null;
    let recording = null;
    let checkOperation = null;
    let speech = null;
    let progress = null;
    let error = "";

    function elapsed(session) {
      if (session.seconds !== undefined) return session.seconds;
      if (session.started === undefined) return 0;
      return Math.min(maxSeconds, Math.floor((performance.now() - session.started) / 1000));
    }

    function snapshot() {
      return {
        phase: checkOperation ? "checking" : capture?.phase ?? (recording ? "ready" : "idle"),
        canRecord,
        canSpeak,
        speaking: !!speech,
        url: recording?.url ?? "",
        seconds: capture ? elapsed(capture) : recording?.seconds ?? 0,
        text: recording?.text ?? "",
        phonetics: recording?.phonetics ?? null,
        progress,
        error,
      };
    }

    function emit() {
      onChange?.(snapshot());
    }

    function release(session) {
      clearInterval(session.clock);
      session.stream?.getTracks().forEach((track) => track.stop());
      if (capture === session) capture = null;
    }

    function stop() {
      const session = capture;
      if (session?.phase !== "recording") return;
      session.seconds = elapsed(session);
      session.phase = "stopping";
      clearInterval(session.clock);
      try {
        if (session.recorder.state !== "inactive") session.recorder.stop();
      } catch {
        release(session);
        error = "Не удалось завершить запись. Попробуйте ещё раз.";
      }
      emit();
    }

    function clearSpeech() {
      if (!speech) return;
      speech = null;
      window.speechSynthesis.cancel();
    }

    async function start() {
      if (!canRecord || capture || checkOperation) return;
      clearSpeech();
      const session = { phase: "requesting" };
      capture = session;
      error = "";
      emit();

      try {
        session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (capture !== session) {
          release(session);
          return;
        }

        const recorder = new MediaRecorder(session.stream);
        session.recorder = recorder;
        const chunks = [];
        recorder.addEventListener("dataavailable", ({ data }) => {
          if (data.size) chunks.push(data);
        });
        recorder.addEventListener("error", () => {
          if (capture !== session) return;
          release(session);
          error = "Не удалось записать ответ. Попробуйте ещё раз.";
          emit();
        }, { once: true });
        recorder.addEventListener("stop", () => {
          if (capture !== session) return;
          const seconds = elapsed(session);
          release(session);
          if (chunks.length) {
            const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0].type });
            if (recording) URL.revokeObjectURL(recording.url);
            recording = { blob, url: URL.createObjectURL(blob), seconds };
          } else {
            error = "Запись пуста. Попробуйте ещё раз.";
          }
          emit();
        }, { once: true });

        recorder.start();
        session.started = performance.now();
        session.phase = "recording";
        session.clock = setInterval(() => {
          if (elapsed(session) >= maxSeconds) stop();
          else emit();
        }, 250);
        emit();
      } catch (cause) {
        if (capture !== session) return;
        release(session);
        error = cause?.name === "NotAllowedError"
          ? "Разрешите доступ к микрофону и попробуйте ещё раз."
          : "Не удалось подключить микрофон. Попробуйте ещё раз.";
        emit();
      }
    }

    function stopCheck() {
      if (!checkOperation) return;
      const controller = checkOperation;
      checkOperation = null;
      progress = null;
      controller.abort();
    }

    function cancelCheck() {
      if (!checkOperation) return;
      stopCheck();
      error = "Проверка отменена. Запись доступна для повторной проверки.";
      emit();
    }

    async function check({ language = "en", pronunciation = false } = {}) {
      if (!recording || capture || checkOperation) return;
      clearSpeech();
      const answer = recording;
      const code = String(language).toLowerCase().split(/[-_]/)[0];
      const controller = new AbortController();
      const { signal } = controller;
      checkOperation = controller;
      error = "";
      const update = (event) => {
        if (checkOperation !== controller) return;
        progress = event;
        emit();
      };
      update({ phase: "decode" });
      try {
        if (!answer.text || answer.language !== code) {
          if (!window.EXAM_TRANSCRIPTION) throw new Error("Модуль распознавания недоступен. Обновите страницу.");
          const result = await window.EXAM_TRANSCRIPTION.transcribe(answer.blob, { language: code, onProgress: update, signal });
          signal.throwIfAborted();
          answer.text = result.text?.trim() ?? "";
          answer.language = code;
          answer.phonetics = null;
          if (!answer.text) {
            error = "Речь не распознана. Прослушайте запись и попробуйте ещё раз.";
            return;
          }
        }
        if (pronunciation && code === "en" && !Number.isFinite(answer.phonetics?.score)) {
          const words = answer.text.match(/[a-z]+(?:'[a-z]+)*/gi) ?? [];
          if (answer.seconds < 2 || words.length < 6) {
            answer.phonetics = { score: null, feedback: "Для проверки звуков запишите несколько связанных фраз на английском." };
          } else if (window.EXAM_PHONEMES) {
            update({ phase: "pronunciation" });
            try {
              const result = await window.EXAM_PHONEMES.assess(answer.blob, answer.text, {
                signal,
                onProgress: (message) => update({ phase: "pronunciation", message }),
              });
              signal.throwIfAborted();
              answer.phonetics = result;
            } catch {
              signal.throwIfAborted();
              answer.phonetics = { score: null, feedback: "Проверка произношения пока недоступна. Можно повторить проверку." };
            }
          } else {
            answer.phonetics = { score: null, feedback: "Модуль проверки произношения не загрузился." };
          }
        }
        signal.throwIfAborted();
      } catch (cause) {
        if (!signal.aborted) error = cause?.message || "Не удалось проверить запись. Попробуйте ещё раз.";
      } finally {
        if (checkOperation === controller) {
          checkOperation = null;
          progress = null;
          emit();
        }
      }
    }

    function playModel(text) {
      if (!canSpeak || capture || checkOperation || !text?.trim()) return;
      clearSpeech();
      const voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService && /^en(?:-|$)/i.test(voice.lang));
      const voice = voices.find((candidate) => /^en-US$/i.test(candidate.lang)) ?? voices[0];
      if (!voice) {
        error = "Для озвучивания примера нужен установленный английский голос браузера.";
        emit();
        return;
      }

      error = "";
      const utterance = new SpeechSynthesisUtterance(text.trim());
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 0.9;
      utterance.onend = () => {
        if (speech !== utterance) return;
        speech = null;
        emit();
      };
      utterance.onerror = () => {
        if (speech !== utterance) return;
        speech = null;
        error = "Не удалось озвучить пример.";
        emit();
      };
      speech = utterance;
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        speech = null;
        error = "Не удалось озвучить пример.";
      }
      emit();
    }

    function stopModel() {
      if (!speech) return;
      clearSpeech();
      emit();
    }

    function reset() {
      stopCheck();
      clearSpeech();
      if (capture) {
        const session = capture;
        const recorder = session.recorder;
        capture = null;
        try {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch {
          // Releasing the track also ends capture if the recorder stopped first.
        }
        release(session);
      }
      if (recording) URL.revokeObjectURL(recording.url);
      recording = null;
      error = "";
      emit();
    }

    return {
      start, stop, check, cancelCheck, playModel, stopModel, reset,
      get state() { return snapshot(); },
    };
  }

  window.EXAM_STUDY_AUDIO = { create };
})();

