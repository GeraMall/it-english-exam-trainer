(function () {
  "use strict";

  const FRAME_SECONDS = 0.025;
  const MAX_SECONDS = 600;
  const DEFAULT_SCALE = 5;
  const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

  function clamp(value, low = 0, high = 1) {
    return Math.max(low, Math.min(high, value));
  }

  function percentile(ordered, fraction) {
    return ordered[Math.round((ordered.length - 1) * fraction)];
  }

  function db(power) {
    return 10 * Math.log10(Math.max(1e-10, power));
  }

  function measureFrames(samples, sampleRate) {
    const frameSize = Math.round(sampleRate * FRAME_SECONDS);
    const frameCount = Math.floor(Math.min(samples.length, MAX_SECONDS * sampleRate) / frameSize);
    const step = Math.max(1, Math.floor(sampleRate / 16000));
    const levels = new Array(frameCount);
    let clipped = 0;
    let readings = 0;
    for (let index = 0; index < frameCount; index++) {
      const begin = index * frameSize;
      const end = begin + frameSize;
      let sum = 0;
      let energy = 0;
      let count = 0;
      for (let position = begin; position < end; position += step) {
        const value = samples[position];
        if (!Number.isFinite(value)) continue;
        sum += value;
        energy += value * value;
        clipped += Math.abs(value) >= 0.995 ? 1 : 0;
        count++;
      }
      levels[index] = count ? db(Math.max(0, energy / count - (sum / count) ** 2)) : -100;
      readings += count;
    }
    return { levels, frameTime: frameSize / sampleRate, clippedShare: readings ? clipped / readings : 0 };
  }

  function segmentsOf(frames, frameTime) {
    const segments = [];
    let start = 0;
    while (start < frames.length) {
      let end = start + 1;
      while (end < frames.length && frames[start] === frames[end]) end++;
      const interval = (end - start) * frameTime;
      segments.push({ active: frames[start], start: start * frameTime, end: end * frameTime, duration: interval });
      start = end;
    }
    return segments;
  }

  function joinActivity(levels, threshold, frameTime) {
    const active = levels.map((value) => value >= threshold);
    const groups = segmentsOf(active, frameTime);
    groups.forEach((group, index) => {
      const isolatedSpike = group.active && group.duration < 0.10;
      const shortGap = !group.active && group.duration < 0.14 && index > 0 && index < groups.length - 1;
      if (isolatedSpike || shortGap) active.fill(shortGap, Math.round(group.start / frameTime), Math.round(group.end / frameTime));
    });
    return segmentsOf(active, frameTime).filter((group) => group.active && group.duration >= 0.10);
  }

  function acousticMetrics(samples, sampleRate) {
    const { levels, frameTime, clippedShare } = measureFrames(samples, sampleRate);
    if (!levels.length) return null;
    const ordered = levels.slice().sort((left, right) => left - right);
    const noiseLevel = percentile(ordered, 0.16);
    const voiceLevel = Math.max(percentile(ordered, 0.90), percentile(ordered, 0.98) - 4);
    const signalContrast = voiceLevel - noiseLevel;
    const threshold = Math.max(-57, Math.min(voiceLevel - 4, Math.max(noiseLevel + 6, voiceLevel - 21)));
    const activity = joinActivity(levels, threshold, frameTime);
    const first = activity[0]?.start ?? 0;
    const last = activity.at(-1)?.end ?? 0;
    const spanSeconds = last - first;
    const activeSeconds = activity.reduce((sum, interval) => sum + interval.duration, 0);
    const pauses = activity.slice(1).map((interval, index) => ({
      start: activity[index].end,
      end: interval.start,
      duration: interval.start - activity[index].end,
    })).filter((interval) => interval.duration >= 0.50);
    const longestPause = Math.max(0, ...pauses.map((interval) => interval.duration));
    const pauseSeconds = pauses.reduce((sum, interval) => sum + interval.duration, 0);
    return {
      duration: levels.length * frameTime,
      activeSeconds,
      speechStart: first,
      speechEnd: last,
      spanSeconds,
      pauseShare: spanSeconds ? pauseSeconds / spanSeconds : 0,
      longestPause,
      pauses,
      voiceLevel,
      signalContrast,
      clippedShare,
      activity,
      truncated: samples.length / sampleRate > MAX_SECONDS,
    };
  }

  function tokens(text, language) {
    const value = String(text ?? "").normalize("NFKC").toLowerCase()
      .replace(/[’‘]/g, "'").replace(/ё/g, "е")
      .replace(/\bc\+\+/g, " cplusplus ").replace(/\bc#/g, " csharp ")
      .replace(/\b([a-z])(?:[. ]([a-z])){1,7}(?=[. ,!?;:]|$)/g, (letters) => {
        return letters.includes(".") || letters.replace(/[^a-z]/g, "").length >= 3 ? letters.replace(/[^a-z]/g, "") : letters;
      });
    const alphabet = language === "ru" ? /[а-яa-z0-9]+(?:'[a-z]+)?/gu : /[a-z0-9]+(?:'[a-z]+)?/gu;
    return (value.match(alphabet) ?? []).slice(0, 1200);
  }

  function editDistance(reference, hypothesis) {
    let previous = new Uint16Array(hypothesis.length + 1);
    let current = new Uint16Array(hypothesis.length + 1);
    for (let index = 0; index <= hypothesis.length; index++) previous[index] = index;
    for (let row = 1; row <= reference.length; row++) {
      current[0] = row;
      for (let col = 1; col <= hypothesis.length; col++) {
        current[col] = Math.min(current[col - 1] + 1, previous[col] + 1, previous[col - 1] + Number(reference[row - 1] !== hypothesis[col - 1]));
      }
      [previous, current] = [current, previous];
    }
    return previous[hypothesis.length];
  }

  function wordComparison(reference, hypothesis) {
    if (!reference.length || !hypothesis.length) return null;
    return clamp(1 - editDistance(reference, hypothesis) / reference.length);
  }

  function wordMismatches(reference, hypothesis) {
    const width = hypothesis.length + 1;
    const paths = new Uint8Array((reference.length + 1) * width);
    let previous = new Uint16Array(width);
    let current = new Uint16Array(width);
    for (let column = 1; column < width; column++) {
      previous[column] = column;
      paths[column] = 2;
    }
    for (let row = 1; row <= reference.length; row++) {
      current[0] = row;
      paths[row * width] = 1;
      for (let column = 1; column < width; column++) {
        const diagonal = previous[column - 1] + Number(reference[row - 1] !== hypothesis[column - 1]);
        const remove = previous[column] + 1;
        const insert = current[column - 1] + 1;
        const choice = Math.min(diagonal, remove, insert);
        current[column] = choice;
        paths[row * width + column] = choice === diagonal ? 0 : choice === remove ? 1 : 2;
      }
      [previous, current] = [current, previous];
    }
    const mismatches = [];
    let row = reference.length;
    let column = hypothesis.length;
    while (row || column) {
      const path = paths[row * width + column];
      if (path === 1) {
        mismatches.push({ expected: reference[--row], heard: null, expectedIndex: row });
      } else if (path === 2) {
        mismatches.push({ expected: null, heard: hypothesis[--column], expectedIndex: row });
      } else {
        const expected = reference[--row];
        const heard = hypothesis[--column];
        if (expected !== heard) mismatches.push({ expected, heard, expectedIndex: row });
      }
    }
    return mismatches.reverse();
  }

  function recognizedSegments(recognition, language) {
    const items = typeof recognition === "string" ? [{ transcript: recognition }] : recognition;
    if (!Array.isArray(items)) return [];
    return items.slice(0, 100).flatMap((entry) => {
      const transcript = String(entry?.transcript ?? "").trim().slice(0, 16000);
      const words = tokens(transcript, language);
      if (!words.length) return [];
      const alternatives = Array.isArray(entry.alternatives) ? entry.alternatives.slice(0, 4).flatMap((alternative) => {
        const hypothesis = tokens(typeof alternative === "string" ? alternative : alternative?.transcript, language);
        return hypothesis.length ? [hypothesis] : [];
      }) : [];
      const start = Number.isFinite(entry.start) && entry.start >= 0 ? entry.start : null;
      const end = Number.isFinite(entry.end) && start !== null && entry.end > start ? entry.end : null;
      const confidence = Number.isFinite(entry.confidence) && entry.confidence > 0 && entry.confidence <= 1 ? entry.confidence : null;
      return [{ transcript, words, alternatives, start, end, confidence }];
    });
  }

  function recognitionMetrics(segments, language, expectedText, sound) {
    const heardWords = segments.flatMap(({ words }) => words).slice(0, 1200);
    const expectedWords = tokens(expectedText, language);
    const length = heardWords.length;
    const measuredSpan = segments.filter(({ start, end }) => start !== null && end !== null && end <= sound.duration + 0.4);
    const spokenSeconds = measuredSpan.length === segments.length && measuredSpan.length
      ? Math.max(...measuredSpan.map(({ end }) => end)) - Math.min(...measuredSpan.map(({ start }) => start))
      : sound.spanSeconds;
    const activeDuration = sound.activeSeconds;
    const pace = length >= 6 && spokenSeconds >= 2 ? 60 * length / spokenSeconds : null;
    const activePace = length >= 6 && activeDuration >= 2 ? 60 * length / activeDuration : null;
    const withConfidence = segments.filter(({ confidence }) => confidence !== null);
    const confidenceWeight = withConfidence.reduce((sum, { words }) => sum + words.length, 0);
    const confidence = confidenceWeight ? withConfidence.reduce((sum, part) => sum + part.words.length * part.confidence, 0) / confidenceWeight : null;
    const agreementParts = segments.flatMap((part) => {
      if (!part.alternatives.length) return [];
      const agreement = part.alternatives.map((variant) => wordComparison(part.words, variant));
      return [{ length: part.words.length, fraction: agreement.reduce((sum, value) => sum + value, 0) / agreement.length }];
    });
    const compared = agreementParts.reduce((sum, part) => sum + part.length, 0);
    const expectedAgreement = expectedWords.length >= 3 ? wordComparison(expectedWords, heardWords) : null;
    return {
      recognizedWords: length,
      transcript: segments.map((part) => part.transcript).join(" "),
      pace,
      activePace,
      confidence,
      alternativeAgreement: compared ? agreementParts.reduce((sum, part) => sum + part.length * part.fraction, 0) / compared : null,
      expectedAgreement,
      expectedMismatches: expectedAgreement !== null && expectedAgreement < 1 ? wordMismatches(expectedWords, heardWords) : [],
      uncertain: segments.filter((part) => part.confidence !== null && part.confidence < 0.55)
        .map(({ transcript, start, end }) => ({ transcript, start, end })),
    };
  }

  function check(label, status, detail) {
    return { label, status, detail };
  }

  function scaled(value, max) {
    return clamp(Math.round(value * max * 2) / 2, 0, max);
  }

  function insufficient(max, feedback, metrics = null, checks = []) {
    return { status: "insufficient", score: null, acousticScore: null, recognitionScore: null, max, checks, metrics, feedback };
  }

  function analyze({ samples, sampleRate, recognition = [], language = "en", expectedText = "", max = DEFAULT_SCALE } = {}) {
    max = Number.isFinite(max) && max > 0 ? max : DEFAULT_SCALE;
    if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate < 4000 || sampleRate > 384000) {
      return insufficient(max, "Для разбора нужна аудиозапись ответа.");
    }
    const sound = acousticMetrics(samples, sampleRate);
    if (!sound) return insufficient(max, "Для разбора нужна более длинная запись.");
    const selectedLanguage = String(language).toLowerCase().startsWith("ru") ? "ru" : "en";
    const segments = recognizedSegments(recognition, selectedLanguage);
    const recognized = recognitionMetrics(segments, selectedLanguage, expectedText, sound);
    const metrics = { ...sound, ...recognized };
    if (sound.clippedShare > 0.015) return insufficient(max, "Сигнал перегружен. Уменьшите уровень микрофона и повторите ответ.", metrics,
      [check("Уровень записи", "missing", "В записи обнаружено ограничение пиков сигнала.")]);
    if (sound.voiceLevel < -53) return insufficient(max, "В записи слишком тихий сигнал. Подвиньте микрофон ближе и повторите ответ.", metrics);
    if (sound.signalContrast < 4 || (sound.signalContrast < 7 && recognized.recognizedWords < 4)) {
      return insufficient(max, "Речь слабо отделяется от фона. Попробуйте записать ответ в более тихом месте.", metrics);
    }
    if (sound.activeSeconds < 1.25 || sound.spanSeconds < 2) {
      return insufficient(max, "Для разбора произнесите хотя бы одну полную фразу.", metrics);
    }

    // Leading and trailing silence do not affect delivery. Short internal gaps are normal in speech.
    const pausePenalty = clamp((sound.pauseShare - 0.22) / 0.43) * 0.30;
    const gapPenalty = clamp((sound.longestPause - 2.5) / 5) * 0.28;
    const delivery = 1 - pausePenalty - gapPenalty;
    const acousticScore = scaled(delivery, max);
    const checks = [check("Качество записи", sound.signalContrast >= 11 ? "met" : "partial",
      `${number.format(sound.activeSeconds)} с звучания. Разница между тихими и громкими участками ${number.format(sound.signalContrast)} дБ.`),
    check("Паузы внутри ответа", delivery >= 0.88 ? "met" : delivery >= 0.68 ? "partial" : "missing",
      sound.pauses.length ? `Самая длинная пауза ${number.format(sound.longestPause)} с. Внутренние паузы занимают ${number.format(sound.pauseShare * 100)}% ответа.` : "Длинных пауз между фразами не обнаружено.")];

    if (recognized.pace !== null) {
      checks.push(check("Темп речи", "met", `Распознано ${recognized.recognizedWords} слов, около ${number.format(recognized.pace)} слов в минуту.`));
    }

    // Recognition confidence is implementation-specific. It can flag a segment for replay, but does not lower the score by itself.
    const agreement = recognized.expectedAgreement;
    if (agreement !== null) {
      checks.push(check("Разборчивость при чтении", agreement >= 0.8 ? "met" : agreement >= 0.55 ? "partial" : "missing",
        `Сходство распознанных слов с текстом для чтения ${number.format(agreement * 100)}%.`));
      return { status: "rated", score: scaled(delivery * 0.35 + agreement * 0.65, max), acousticScore,
        recognitionScore: scaled(agreement, max), max, checks, metrics,
        feedback: "Ориентир по паузам и совпадению слов при чтении." };
    }

    if (recognized.alternativeAgreement !== null && recognized.recognizedWords >= 6) {
      const consensus = recognized.alternativeAgreement;
      checks.push(check("Устойчивость распознавания", consensus >= 0.82 ? "met" : "partial",
        `Совпадение вариантов распознавания ${number.format(consensus * 100)}%.`));
    } else if (recognized.recognizedWords >= 6) {
      checks.push(check("Распознавание речи", "met", `Браузер распознал ${recognized.recognizedWords} слов.`));
    }
    return { status: "audio-only", score: acousticScore, acousticScore, recognitionScore: null, max, checks, metrics,
      feedback: recognized.recognizedWords
        ? "Баллы отражают паузы в записи. Расшифровка помогает найти места для повторного прослушивания."
        : "Баллы отражают паузы в записи. Для оценки разборчивости нужен результат распознавания." };
  }

  async function fromBlob(blob, options = {}) {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext || !blob?.size) return insufficient(options.max ?? DEFAULT_SCALE, "Браузеру не удалось открыть запись для разбора.");
    let context;
    try {
      context = new AudioContext();
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      // Use the loudest channel so phase cancellation cannot erase a stereo voice recording.
      let samples = buffer.getChannelData(0);
      let bestPower = -1;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        const step = Math.max(1, Math.floor(data.length / 16000));
        let energy = 0;
        for (let index = 0; index < data.length; index += step) energy += data[index] ** 2;
        if (energy > bestPower) {
          bestPower = energy;
          samples = data;
        }
      }
      return analyze({ ...options, samples, sampleRate: buffer.sampleRate });
    } catch {
      return insufficient(options.max ?? DEFAULT_SCALE, "Браузеру не удалось разобрать формат записи. Запись можно прослушать.");
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }

  window.EXAM_PRONUNCIATION = { analyze, fromBlob };
})();
