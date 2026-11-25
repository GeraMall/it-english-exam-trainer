(() => {
  "use strict";

  const SAMPLE_RATE = 16000;
  const MAX_SECONDS = 120;
  const FRAME_SAMPLES = SAMPLE_RATE / 50;
  const MODEL_ASSETS = "https://cdn.jsdelivr.net/npm/hama-js@1.7.0/dist/browser/assets/";
  const RUNTIME = "./vendor/hama/browser.js";
  const DICTIONARY = "./vendor/hama/cmudict.dict.gz";
  const EMPTY_AUDIO = "В записи слишком мало различимой английской речи для сравнения.";
  const ARPABET = {
    AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ", B: "b",
    CH: "tʃ", D: "d", DH: "ð", EH: "ɛ", ER: "ɝ", EY: "eɪ", F: "f",
    G: "ɡ", HH: "h", IH: "ɪ", IY: "i", JH: "dʒ", K: "k", L: "l",
    M: "m", N: "n", NG: "ŋ", OW: "oʊ", OY: "ɔɪ", P: "p", R: "ɹ",
    S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "u", V: "v",
    W: "w", Y: "j", Z: "z", ZH: "ʒ",
  };
  const SOUND_VARIANTS = new Map([
    ["g", "ɡ"], ["r", "ɹ"], ["ɻ", "ɹ"], ["ɚ", "ɝ"], ["ɾ", "t"],
    ["ɒ", "ɑ"], ["ɐ", "ʌ"], ["e", "ɛ"], ["əʊ", "oʊ"], ["ɫ", "l"],
  ]);
  const SPELLED = new Set("2FA ADSL AI ALU ANN AR BD CD CGI CLI CNN CPU CSS DDR DDR4 DNS DRAM DSL DVD FGT FTP GB GSM HDD HLAI HTML HTTP IBM IOT IR ISDN ISP JS JVM KB LCD MFA ML MROM NN OOP OS OSI PC PHP RNN SDRAM SDSL SEO SMT SMTP SQL SRAM SSD SSL TB TCP UDP UID URL USB VDSL VR WAN WLAN WWW".split(" "));
  const LETTERS = {
    A: "eɪ", B: "b i", C: "s i", D: "d i", E: "i", F: "ɛ f", G: "dʒ i",
    H: "eɪ tʃ", I: "aɪ", J: "dʒ eɪ", K: "k eɪ", L: "ɛ l", M: "ɛ m",
    N: "ɛ n", O: "oʊ", P: "p i", Q: "k j u", R: "ɑ ɹ", S: "ɛ s",
    T: "t i", U: "j u", V: "v i", W: "d ʌ b ə l j u", X: "ɛ k s",
    Y: "w aɪ", Z: "z i", 2: "t u", 4: "f ɔ ɹ",
  };
  const FIXED_WORDS = {
    ASCII: "æ s k i", BIOS: "b aɪ oʊ s", DDOS: "d i d ɑ s", GUI: "ɡ u i",
    ICANN: "aɪ k æ n", PROM: "p ɹ ɑ m", SATA: "s eɪ t ə",
    WYSIWYG: "w ɪ z i w ɪ ɡ", "WI-FI": "w aɪ f aɪ", WIFI: "w aɪ f aɪ",
  };
  const pending = new Map();
  let worker;
  let nextRequest = 0;
  let asrLoad;
  let g2pLoad;
  let dictionaryLoad;

  const unavailable = (feedback) => ({ score: null, feedback });

  function phoneKey(phone) {
    const clean = phone.normalize("NFC").replace(/[ˈˌ.‿͜͡ː]/gu, "").trim();
    return SOUND_VARIANTS.get(clean) ?? clean;
  }

  function samePhone(target, heard) {
    return target.phones.includes(heard);
  }

  function align(expected, observed) {
    const columns = observed.length + 1;
    const costs = new Uint16Array((expected.length + 1) * columns);
    for (let row = 0; row <= expected.length; row++) costs[row * columns] = row;
    for (let column = 0; column <= observed.length; column++) costs[column] = column;

    for (let row = 1; row <= expected.length; row++) {
      for (let column = 1; column <= observed.length; column++) {
        const cell = row * columns + column;
        const difference = samePhone(expected[row - 1], observed[column - 1]) ? 0 : 1;
        costs[cell] = Math.min(costs[cell - columns - 1] + difference, costs[cell - columns] + 1, costs[cell - 1] + 1);
      }
    }

    const changes = [];
    let row = expected.length;
    let column = observed.length;
    while (row || column) {
      const cell = row * columns + column;
      const target = expected[row - 1];
      const heard = observed[column - 1];
      if (row && column) {
        const difference = samePhone(target, heard) ? 0 : 1;
        if (costs[cell] === costs[cell - columns - 1] + difference) {
          if (difference) changes.push({ word: target.word, expected: target.phones[0], heard });
          row--;
          column--;
          continue;
        }
      }
      if (row && costs[cell] === costs[cell - columns] + 1) {
        changes.push({ word: target.word, expected: target.phones[0], heard: "" });
        row--;
      } else {
        changes.push({ word: target?.word ?? "", expected: "", heard });
        column--;
      }
    }
    return { distance: costs[costs.length - 1], changes: changes.reverse() };
  }

  function audioChunks(samples) {
    const frames = [];
    let strongest = 0;
    for (let offset = 0; offset < samples.length; offset += FRAME_SAMPLES) {
      let energy = 0;
      const end = Math.min(offset + FRAME_SAMPLES, samples.length);
      for (let sample = offset; sample < end; sample++) energy += samples[sample] ** 2;
      const rms = Math.sqrt(energy / (end - offset));
      strongest = Math.max(strongest, rms);
      frames.push(rms);
    }
    if (strongest < 0.003) return [];
    const speechMinimum = Math.max(0.002, strongest * 0.035);
    const first = frames.findIndex((rms) => rms >= speechMinimum);
    const last = frames.findLastIndex((rms) => rms >= speechMinimum);
    if (last - first < 6) return [];

    const segments = [];
    let start = Math.max(0, first - 8);
    const end = Math.min(frames.length, last + 9);
    while (end - start > 750) {
      let cut = start + 650;
      for (let frame = start + 550; frame < start + 750; frame++) {
        const nearbyEnergy = frames[frame - 1] + frames[frame] + frames[frame + 1];
        const cutEnergy = frames[cut - 1] + frames[cut] + frames[cut + 1];
        if (nearbyEnergy < cutEnergy) cut = frame;
      }
      segments.push(samples.subarray(start * FRAME_SAMPLES, cut * FRAME_SAMPLES));
      start = cut;
    }
    segments.push(samples.subarray(start * FRAME_SAMPLES, end * FRAME_SAMPLES));
    return segments;
  }

  async function loadDictionary() {
    const response = await fetch(DICTIONARY);
    if (!response.ok) return new Map();
    const decoded = response.body.pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(decoded).text();
    const dictionary = new Map();
    for (const line of text.split("\n")) {
      const match = line.match(/^([^\s(]+)(?:\(\d+\))? ([A-Z0-2 ]+)/u);
      if (!match) continue;
      const phones = match[2].trim().split(" ").map((code) => code === "AH0" ? "ə" : ARPABET[code.replace(/[012]$/u, "")]).filter(Boolean);
      if (!dictionary.has(match[1])) dictionary.set(match[1], []);
      dictionary.get(match[1]).push(phones);
    }
    return dictionary;
  }

  async function knownPronunciations(token, dictionary) {
    const upper = token.toUpperCase();
    if (Object.hasOwn(FIXED_WORDS, upper)) return [FIXED_WORDS[upper].split(" ")];
    if (SPELLED.has(upper) && token !== token.toLowerCase()) {
      return [Array.from(upper).flatMap((letter) => LETTERS[letter].split(" "))];
    }
    const word = token.toLowerCase();
    if (dictionary.has(word)) return dictionary.get(word);
    if (!g2pLoad) {
      g2pLoad = import(RUNTIME).then(({ G2PBrowserModel }) => G2PBrowserModel.create({
        encoderUrl: `${MODEL_ASSETS}encoder.hama`,
        decoderStepUrl: `${MODEL_ASSETS}decoder_step.hama`,
      })).catch((error) => {
        g2pLoad = undefined;
        throw error;
      });
    }
    const result = await (await g2pLoad).predict(word);
    return [result.alignments.map(({ phoneme }) => phoneKey(phoneme)).filter(Boolean)];
  }

  async function assessSpeech(words, samples, progress) {
    const segments = audioChunks(samples);
    if (!segments.length) return unavailable(EMPTY_AUDIO);
    if (!asrLoad) {
      progress("Загружаю модель произношения. При первом запуске потребуется от 5 МБ.");
      asrLoad = import(RUNTIME).then(({ ASRBrowserModel }) =>
        ASRBrowserModel.create({ modelUrl: `${MODEL_ASSETS}asr_waveform.hama` }),
      ).catch((error) => {
        asrLoad = undefined;
        throw error;
      });
    }
    dictionaryLoad ??= loadDictionary().catch(() => new Map());
    const [asr, dictionary] = await Promise.all([asrLoad, dictionaryLoad]);
    progress("Сравниваю звуки записи с английским текстом.");

    const expected = [];
    const knownWords = new Map();
    for (const word of words) {
      if (!knownWords.has(word)) {
        let variants = await knownPronunciations(word, dictionary);
        if (word.toLowerCase() === "the") variants = [...variants, ["ð", "ə"], ["ð", "i"], ["ð", "ɪ"]];
        const main = variants[0];
        const compatible = variants.filter((phones) => phones.length === main.length);
        knownWords.set(word, main.map((_, index) => [...new Set(compatible.map((phones) => phoneKey(phones[index])))]));
      }
      for (const phones of knownWords.get(word)) expected.push({ word, phones });
    }
    const observed = [];
    for (const segment of segments) {
      const result = await asr.transcribeWaveform(segment, SAMPLE_RATE);
      observed.push(...result.phonemes.map(phoneKey).filter(Boolean));
    }
    if (observed.length < 3 || expected.length < 3) return unavailable(EMPTY_AUDIO);
    const durationRatio = observed.length / expected.length;
    if (durationRatio < 0.4 || durationRatio > 2.2) {
      return unavailable("Длина записи и текста сильно различается. Сверьте, что в поле указан текст этой записи.");
    }
    const { distance, changes } = align(expected, observed);
    const score = 1 - distance / Math.max(expected.length, observed.length);
    const examples = [];
    const exampleWords = new Set();
    if (score >= 0.45) {
      for (const item of changes) {
        if (!item.expected || !item.heard || item.heard.startsWith("<") || exampleWords.has(item.word)) continue;
        examples.push(item);
        exampleWords.add(item.word);
        if (examples.length === 3) break;
      }
    }
    const hints = examples.map(({ word, expected: target, heard }) => `${word} (/${target}/ → /${heard}/)`).join(", ");
    return {
      score,
      details: {
        expected: expected.length,
        recognized: observed.length,
        differences: distance,
        examples,
      },
      feedback: score < 0.45
        ? "Мало звуковых совпадений. Сверьте текст с записью и прослушайте её ещё раз."
        : hints
          ? `Модель услышала различия в этих словах. Сверьте ${hints}. Учитывайте акцент и качество записи.`
          : "Модель сравнила распознанные звуки с текстом. Ударение и интонацию можно проверить при прослушивании.",
    };
  }

  if (typeof window === "undefined") {
    let queue = Promise.resolve();
    self.onmessage = ({ data: { id, words, samples } }) => {
      queue = queue.then(async () => {
        try {
          const result = await assessSpeech(words, samples, (progress) => self.postMessage({ id, progress }));
          self.postMessage({ id, result });
        } catch {
          self.postMessage({ id, result: unavailable("Модель произношения недоступна. Проверьте подключение и попробуйте ещё раз.") });
        }
      });
    };
    return;
  }

  const scriptUrl = document.currentScript.src;

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(scriptUrl, { type: "module", name: "exam-phonemes" });
    worker.onmessage = ({ data: { id, progress, result } }) => {
      const request = pending.get(id);
      if (!request) return;
      if (progress) request.onProgress?.(progress);
      else request.finish(result);
    };
    worker.onerror = () => {
      worker.terminate();
      worker = undefined;
      for (const request of pending.values()) {
        request.finish(unavailable("Браузер не смог запустить модель произношения."));
      }
    };
    return worker;
  }

  async function getSamples(blob) {
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const context = new OfflineContext(1, 1, SAMPLE_RATE);
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > MAX_SECONDS) return null;
    if (audio.numberOfChannels === 1) return audio.getChannelData(0);
    const mono = new Float32Array(audio.length);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const samples = audio.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += samples[i] / audio.numberOfChannels;
    }
    return mono;
  }

  function englishWords(transcript) {
    return String(transcript ?? "").normalize("NFKC").replace(/’/g, "'").match(/(?:2fa|wi-fi|ddr4|[a-z]+(?:'[a-z]+)*)(?![a-z])/gi) ?? [];
  }

  window.EXAM_PHONEMES = {
    async assess(blob, transcript, { onProgress, signal } = {}) {
      signal?.throwIfAborted();
      const words = englishWords(transcript);
      if (!words.length) return unavailable("Добавьте английский текст этой записи, чтобы сравнить звуки.");
      if (words.length > 420) return unavailable("Для фонетики выберите фрагмент до 420 слов.");
      if (!blob?.size) return unavailable("Запишите английский ответ, чтобы сравнить произношение.");
      if (blob.size > 24_000_000) return unavailable("Для фонетики запишите английский ответ до двух минут.");
      onProgress?.("Подготавливаю аудиозапись.");
      let samples;
      try {
        samples = await getSamples(blob);
      } catch {
        return unavailable("Браузер не смог прочитать аудиозапись.");
      }
      signal?.throwIfAborted();
      if (!samples) return unavailable("Для фонетики запишите английский ответ до двух минут.");

      return new Promise((resolve, reject) => {
        const id = ++nextRequest;
        const clean = () => {
          signal?.removeEventListener("abort", abort);
          pending.delete(id);
        };
        const abort = () => {
          clean();
          reject(signal.reason);
        };
        const finish = (result) => {
          clean();
          resolve(result);
        };
        pending.set(id, { finish, onProgress });
        signal?.addEventListener("abort", abort, { once: true });
        try {
          getWorker().postMessage({ id, words, samples }, [samples.buffer]);
        } catch {
          finish(unavailable("Браузер не смог открыть модуль произношения. Откройте тренажёр по локальному или HTTPS-адресу."));
        }
      });
    },
  };
})();
