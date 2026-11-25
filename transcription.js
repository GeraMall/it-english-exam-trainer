(() => {
  "use strict";

  const runtimeUrl = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
  const model = "onnx-community/whisper-tiny";
  const revision = "ff4177021cc41f7db950912b73ea4fdf7d01d8e7";
  const sampleRate = 16000;

  // Only these two ONNX files are needed for the pinned 8-bit model.
  const weightSizes = {
    "onnx/encoder_model_quantized.onnx": 10124990,
    "onnx/decoder_model_merged_quantized.onnx": 30719241,
  };
  const totalWeightBytes = Object.values(weightSizes).reduce((sum, size) => sum + size, 0);

  let runtimeAttempts = 0;
  let runtimePromise;
  let modelPromise;
  let modelReady = false;
  let inferenceQueue = Promise.resolve();
  const progressListeners = new Set();

  function abortable(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  async function readWaveform(blob) {
    const OfflineContext = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error("Браузер не поддерживает обработку аудио.");
    let decoded;
    try {
      // Web Audio decodes and resamples to the context's rate.
      const context = new OfflineContext(1, 1, sampleRate);
      decoded = await context.decodeAudioData(await blob.arrayBuffer());
    } catch (cause) {
      throw new Error("Не удалось прочитать запись. Запишите ответ заново.", { cause });
    }

    const samples = new Float32Array(decoded.length);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
    for (let index = 0; index < samples.length; index++) {
      let value = 0;
      for (const channel of channels) value += channel[index];
      samples[index] = value / channels.length;
    }
    const block = Math.round(sampleRate * 0.02);
    let firstSound = -1;
    let lastSound = -1;
    for (let start = 0; start < samples.length; start += block) {
      const end = Math.min(samples.length, start + block);
      let energy = 0;
      for (let index = start; index < end; index++) energy += samples[index] ** 2;
      if (energy < (end - start) * 0.002 ** 2) continue;
      if (firstSound === -1) firstSound = start;
      lastSound = end;
    }
    if (lastSound - firstSound < block * 2) return null;

    const pad = Math.round(sampleRate * 0.2);
    return samples.subarray(Math.max(0, firstSound - pad), Math.min(samples.length, lastSound + pad));
  }

  function runtime() {
    if (!runtimePromise) {
      const retry = runtimeAttempts > 0 ? "?retry=" + runtimeAttempts : "";
      runtimeAttempts++;
      runtimePromise = import(runtimeUrl + retry).catch((error) => {
        runtimePromise = undefined;
        throw error;
      });
    }
    return runtimePromise;
  }

  function loadModel() {
    if (modelPromise) return modelPromise;
    const loadedWeights = new Map();
    modelPromise = runtime().then(async ({ env, pipeline }) => {
      env.allowLocalModels = false;
      // A single WebAssembly thread also runs in pages without cross-origin isolation.
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = true;
      return pipeline("automatic-speech-recognition", model, {
        revision,
        device: "wasm",
        dtype: "q8",
        progress_callback: ({ status, file, loaded }) => {
          if (!Object.hasOwn(weightSizes, file) || !["progress", "done"].includes(status)) return;
          loadedWeights.set(file, status === "done" ? weightSizes[file] : Math.min(weightSizes[file], loaded || 0));
          const bytes = [...loadedWeights.values()].reduce((sum, size) => sum + size, 0);
          const percent = Math.min(99, Math.floor(bytes / totalWeightBytes * 100));
          progressListeners.forEach((listener) => listener({ phase: "loading", percent }));
        },
      });
    }).then((recognize) => {
      modelReady = true;
      return recognize;
    }).catch((cause) => {
      modelPromise = undefined;
      // A failed WebAssembly initialization stays rejected inside this runtime instance.
      runtimePromise = undefined;
      const error = new Error("Не удалось загрузить модель распознавания. Проверьте подключение к интернету и повторите попытку.", { cause });
      error.code = "MODEL_UNAVAILABLE";
      throw error;
    });
    return modelPromise;
  }

  function trimRepeatedEnding(value) {
    const words = value.trim().split(/\s+/);
    const normalized = words.map((word) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
    // Preserve normal repetition and collapse only a decoding loop at the end.
    for (let size = 1; size <= Math.min(12, Math.floor(words.length / 3)); size++) {
      const end = words.length;
      const last = normalized.slice(end - size).join(" ");
      if (!last.trim()) continue;
      let previous = end - size * 2;
      while (previous >= 0 && normalized.slice(previous, previous + size).join(" ") === last) previous -= size;
      if (end - previous - size >= size * 3) return words.slice(0, previous + size * 2).join(" ");
    }
    return value.trim();
  }

  async function transcribe(blob, { language, onProgress, signal } = {}) {
    signal?.throwIfAborted();
    if (!(blob instanceof Blob) || !blob.size) return { text: "" };
    const notify = (event) => {
      if (!signal?.aborted) onProgress?.(event);
    };
    notify({ phase: "decode" });
    signal?.throwIfAborted();
    const waveform = await abortable(readWaveform(blob), signal);
    if (!waveform) return { text: "" };

    progressListeners.add(notify);
    let recognize;
    try {
      if (!modelReady) notify({ phase: "loading", percent: 0 });
      recognize = await abortable(loadModel(), signal);
    } finally {
      progressListeners.delete(notify);
    }

    const code = String(language ?? "").toLowerCase().split(/[-_]/)[0];
    const modelLanguage = code === "en" ? "english" : code === "ru" ? "russian" : code || null;
    const result = inferenceQueue.then(async () => {
      signal?.throwIfAborted();
      notify({ phase: "transcribing" });
      try {
        return await recognize(waveform, {
          language: modelLanguage,
          task: "transcribe",
          chunk_length_s: 25,
          stride_length_s: 4,
        });
      } catch (cause) {
        throw new Error("Не удалось распознать запись. Повторите попытку или продиктуйте ответ заново.", { cause });
      }
    });
    inferenceQueue = result.catch(() => {});
    const output = await abortable(result, signal);
    return { text: trimRepeatedEnding(output.text ?? "") };
  }

  window.EXAM_TRANSCRIPTION = { transcribe };
})();

