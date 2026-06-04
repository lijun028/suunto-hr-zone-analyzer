const ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];
const DURATION_LABELS = {
  prevDelta: "上一条 HR 到当前 HR",
  point: "每点 1 秒",
  nextDelta: "当前 HR 到下一条 HR",
  nextDeltaLast1: "当前 HR 到下一条，末条 1 秒",
};
const THRESHOLD_LABELS = {
  raw: "原始阈值",
  round: "四舍五入",
  ceil: "向上取整",
  floor: "向下取整",
};
const BOUNDARY_LABELS = {
  upper: "边界归入高区间",
  lower: "边界归入低区间",
};
const SAMPLE_JSON_NAME = "sample-running-2026-02-25.json";
const SAMPLE_DATA_SCRIPT = "./assets/sample-running-2026-02-25.js";

const hasDom = typeof document !== "undefined";
const els = hasDom
  ? {
      fileInput: document.querySelector("#fileInput"),
      sampleButton: document.querySelector("#sampleButton"),
      dropZone: document.querySelector("#dropZone"),
      fileName: document.querySelector("#fileName"),
      durationMode: document.querySelector("#durationMode"),
      thresholdMode: document.querySelector("#thresholdMode"),
      boundaryMode: document.querySelector("#boundaryMode"),
      precisionInput: document.querySelector("#precisionInput"),
      exportCsv: document.querySelector("#exportCsv"),
      status: document.querySelector("#status"),
      summaryGrid: document.querySelector("#summaryGrid"),
      zoneRows: document.querySelector("#zoneRows"),
      bestRows: document.querySelector("#bestRows"),
      boundaryRows: document.querySelector("#boundaryRows"),
      activeRule: document.querySelector("#activeRule"),
      boundaryHint: document.querySelector("#boundaryHint"),
    }
  : {};

const state = {
  parsed: null,
  result: null,
  fileName: "",
};

if (hasDom) {
  els.fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) readFile(file);
  });

  els.sampleButton.addEventListener("click", loadSampleJson);

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragover");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });

  [els.durationMode, els.thresholdMode, els.boundaryMode, els.precisionInput].forEach((control) => {
    control.addEventListener("input", () => {
      if (state.parsed) render();
    });
  });

  els.bestRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-combo]");
    if (!button) return;
    const combo = JSON.parse(button.dataset.combo);
    els.durationMode.value = combo.durationMode;
    els.thresholdMode.value = combo.thresholdMode;
    els.boundaryMode.value = combo.boundaryMode;
    render();
  });

  els.exportCsv.addEventListener("click", () => {
    if (!state.result) return;
    const csv = buildCsv(state.result);
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "suunto-hr-zone-comparison.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

async function readFile(file) {
  state.fileName = file.name;
  els.fileName.textContent = file.name;
  setStatus("正在解析文件...");

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const parsed = parseSuuntoJson(json);
    state.parsed = parsed;
    els.precisionInput.value = String(parsed.inferredPrecision);
    els.exportCsv.disabled = false;
    render();
  } catch (error) {
    state.parsed = null;
    state.result = null;
    els.exportCsv.disabled = true;
    clearOutput();
    setStatus(error.message || "文件解析失败", true);
  }
}

async function loadSampleJson() {
  els.sampleButton.disabled = true;
  setStatus("正在加载示例 JSON...");

  try {
    await ensureSampleData();
    const json = window.SUUNTO_SAMPLE_JSON;
    if (!json) throw new Error("示例数据没有加载成功。");

    const parsed = parseSuuntoJson(json);
    state.fileName = SAMPLE_JSON_NAME;
    state.parsed = parsed;
    els.fileName.textContent = SAMPLE_JSON_NAME;
    els.precisionInput.value = String(parsed.inferredPrecision);
    els.exportCsv.disabled = false;
    render();
  } catch (error) {
    state.parsed = null;
    state.result = null;
    els.exportCsv.disabled = true;
    clearOutput();
    setStatus(error.message || "示例 JSON 加载失败", true);
  } finally {
    els.sampleButton.disabled = false;
  }
}

function ensureSampleData() {
  if (window.SUUNTO_SAMPLE_JSON) return Promise.resolve();
  if (window.SUUNTO_SAMPLE_DATA_LOADING) return window.SUUNTO_SAMPLE_DATA_LOADING;

  window.SUUNTO_SAMPLE_DATA_LOADING = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SAMPLE_DATA_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("无法读取本地示例数据文件。"));
    document.head.appendChild(script);
  });

  return window.SUUNTO_SAMPLE_DATA_LOADING;
}

function parseSuuntoJson(json) {
  const root = json?.DeviceLog ?? json?.deviceLog ?? json;
  const header = root?.Header ?? root?.header ?? json?.Header ?? json?.header ?? {};
  const personal =
    header?.Personal ?? header?.personal ?? root?.Personal ?? root?.personal ?? json?.Personal ?? {};

  const hrZones = findHrZones(root, header, json);
  const samples = findSamples(root, json);
  if (!hrZones) throw new Error("没有找到 HrZones。");
  if (!samples?.length) throw new Error("没有找到 Samples。");

  const maxHR = toNumber(
    personal?.MaxHR ?? personal?.maxHR ?? personal?.MaxHr ?? header?.MaxHR ?? root?.MaxHR
  );
  const headerDuration = toNumber(header?.Duration ?? header?.duration ?? root?.Duration);
  const pauseDuration = toNumber(header?.PauseDuration ?? header?.pauseDuration ?? root?.PauseDuration);

  const rawThresholds = [
    toNumber(hrZones.Zone2LowerLimit),
    toNumber(hrZones.Zone3LowerLimit),
    toNumber(hrZones.Zone4LowerLimit),
    toNumber(hrZones.Zone5LowerLimit),
  ];

  if (rawThresholds.some((value) => !Number.isFinite(value))) {
    throw new Error("HrZones 缺少 Zone2-Zone5 的 LowerLimit。");
  }

  const reportedDurations = [1, 2, 3, 4, 5].map((zone) =>
    finiteOrZero(toNumber(hrZones[`Zone${zone}Duration`]))
  );

  const hrSamples = samples
    .map((sample, index) => {
      const hr = extractHr(sample);
      if (!Number.isFinite(hr)) return null;
      return {
        index,
        hr,
        timeMs: extractTimeMs(sample),
      };
    })
    .filter(Boolean);

  if (!hrSamples.length) throw new Error("Samples 中没有找到 HR 数值。");

  const inferredPrecision = clamp(inferPrecision(hrSamples.map((sample) => sample.hr)), 0, 6);
  const timeStats = getTimeStats(hrSamples);

  return {
    root,
    header,
    hrZones,
    samples,
    hrSamples,
    rawThresholds,
    reportedDurations,
    maxHR,
    headerDuration,
    pauseDuration,
    inferredPrecision,
    timeStats,
  };
}

function findHrZones(...containers) {
  for (const container of containers) {
    const direct =
      container?.HrZones ??
      container?.HRZones ??
      container?.hrZones ??
      container?.Header?.HrZones ??
      container?.Header?.HRZones;
    if (looksLikeHrZones(direct)) return direct;
  }
  return findDeep(containers[0], looksLikeHrZones, 7);
}

function looksLikeHrZones(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      "Zone1Duration" in value &&
      "Zone2LowerLimit" in value &&
      "Zone5LowerLimit" in value
  );
}

function findSamples(...containers) {
  for (const container of containers) {
    const direct = container?.Samples ?? container?.samples ?? container?.DeviceLog?.Samples;
    if (looksLikeSamples(direct)) return direct;
  }
  return findDeep(containers[0], looksLikeSamples, 7);
}

function looksLikeSamples(value) {
  return (
    Array.isArray(value) &&
    value.some((item) => item && typeof item === "object" && Number.isFinite(extractHr(item)))
  );
}

function findDeep(value, predicate, maxDepth, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > maxDepth || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    if (!child || typeof child !== "object") continue;
    const match = findDeep(child, predicate, maxDepth, depth + 1, seen);
    if (match) return match;
  }
  return null;
}

function extractHr(sample) {
  const value =
    sample?.HR ??
    sample?.Hr ??
    sample?.hr ??
    sample?.HeartRate ??
    sample?.heartRate ??
    sample?.HeartRateHz ??
    sample?.heartRateHz;
  return toNumber(value);
}

function extractTimeMs(sample) {
  const raw =
    sample?.TimeISO8601 ??
    sample?.timeISO8601 ??
    sample?.Timestamp ??
    sample?.timestamp ??
    sample?.Time ??
    sample?.time ??
    sample?.UTC;

  if (typeof raw === "number") {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function render() {
  const parsed = state.parsed;
  const options = getOptions();
  const result = analyze(parsed, options);
  state.result = result;

  renderStatus(result);
  renderSummary(result);
  renderZoneRows(result);
  renderBestRows(result);
  renderBoundaryRows(result);
}

function getOptions() {
  return {
    durationMode: els.durationMode.value,
    thresholdMode: els.thresholdMode.value,
    boundaryMode: els.boundaryMode.value,
    precision: clamp(Number.parseInt(els.precisionInput.value, 10), 0, 6),
  };
}

function analyze(parsed, options) {
  const thresholds = parsed.rawThresholds.map((value) =>
    transformThreshold(value, options.thresholdMode, options.precision)
  );
  const sampleDurations = getSampleDurations(parsed.hrSamples, options.durationMode);
  const zones = parsed.hrSamples.map((sample) =>
    getZone(sample.hr, thresholds, options.boundaryMode)
  );
  const computedDurations = [0, 0, 0, 0, 0];
  const pointCounts = [0, 0, 0, 0, 0];

  zones.forEach((zone, index) => {
    computedDurations[zone - 1] += sampleDurations[index];
    pointCounts[zone - 1] += 1;
  });

  const reportedTotal = sum(parsed.reportedDurations);
  const computedTotal = sum(computedDurations);
  const headerDuration = Number.isFinite(parsed.headerDuration) ? parsed.headerDuration : NaN;
  const bestCombos = getBestCombos(parsed, options.precision);
  const boundaryStats = getBoundaryStats(parsed.hrSamples, sampleDurations, thresholds, options.precision);

  return {
    parsed,
    options,
    thresholds,
    sampleDurations,
    zones,
    computedDurations,
    pointCounts,
    reportedTotal,
    computedTotal,
    headerDuration,
    bestCombos,
    boundaryStats,
  };
}

function getSampleDurations(samples, mode) {
  const hasTimes = samples.every((sample) => Number.isFinite(sample.timeMs));
  if (mode === "point" || !hasTimes) return samples.map(() => 1);

  return samples.map((sample, index) => {
    if (mode === "prevDelta") {
      if (index === 0) return 0;
      return cleanDelta(sample.timeMs - samples[index - 1].timeMs);
    }
    if (mode === "nextDelta") {
      if (index === samples.length - 1) return 0;
      return cleanDelta(samples[index + 1].timeMs - sample.timeMs);
    }
    if (mode === "nextDeltaLast1") {
      if (index === samples.length - 1) return 1;
      return cleanDelta(samples[index + 1].timeMs - sample.timeMs);
    }
    return 1;
  });
}

function cleanDelta(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms / 1000;
}

function getZone(hr, thresholds, boundaryMode) {
  const [z2, z3, z4, z5] = thresholds;
  if (boundaryMode === "lower") {
    if (hr <= z2 + Number.EPSILON) return 1;
    if (hr <= z3 + Number.EPSILON) return 2;
    if (hr <= z4 + Number.EPSILON) return 3;
    if (hr <= z5 + Number.EPSILON) return 4;
    return 5;
  }

  if (hr < z2 - Number.EPSILON) return 1;
  if (hr < z3 - Number.EPSILON) return 2;
  if (hr < z4 - Number.EPSILON) return 3;
  if (hr < z5 - Number.EPSILON) return 4;
  return 5;
}

function transformThreshold(value, mode, precision) {
  if (mode === "raw") return value;
  const factor = 10 ** precision;
  if (mode === "round") return Math.round((value + Number.EPSILON) * factor) / factor;
  if (mode === "ceil") return Math.ceil((value - Number.EPSILON) * factor) / factor;
  if (mode === "floor") return Math.floor((value + Number.EPSILON) * factor) / factor;
  return value;
}

function getBestCombos(parsed, precision) {
  const combos = [];
  for (const durationMode of Object.keys(DURATION_LABELS)) {
    for (const thresholdMode of Object.keys(THRESHOLD_LABELS)) {
      for (const boundaryMode of Object.keys(BOUNDARY_LABELS)) {
        const result = analyzeShallow(parsed, {
          durationMode,
          thresholdMode,
          boundaryMode,
          precision,
        });
        combos.push(result);
      }
    }
  }
  return combos
    .sort((a, b) => a.totalAbsDiff - b.totalAbsDiff || Math.abs(a.totalDiff) - Math.abs(b.totalDiff))
    .slice(0, 8);
}

function analyzeShallow(parsed, options) {
  const thresholds = parsed.rawThresholds.map((value) =>
    transformThreshold(value, options.thresholdMode, options.precision)
  );
  const sampleDurations = getSampleDurations(parsed.hrSamples, options.durationMode);
  const computedDurations = [0, 0, 0, 0, 0];

  parsed.hrSamples.forEach((sample, index) => {
    const zone = getZone(sample.hr, thresholds, options.boundaryMode);
    computedDurations[zone - 1] += sampleDurations[index];
  });

  const diffs = computedDurations.map((value, index) => value - parsed.reportedDurations[index]);
  return {
    options,
    computedDurations,
    totalAbsDiff: sum(diffs.map(Math.abs)),
    totalDiff: sum(computedDurations) - sum(parsed.reportedDurations),
  };
}

function getBoundaryStats(samples, sampleDurations, thresholds, precision) {
  const step = 10 ** -precision;
  return thresholds.map((threshold, index) => {
    let hitPoints = 0;
    let hitSeconds = 0;
    let nearbyPoints = 0;
    const nearbyValues = new Map();

    samples.forEach((sample, sampleIndex) => {
      if (almostEqual(sample.hr, threshold, Math.max(step / 20, 1e-9))) {
        hitPoints += 1;
        hitSeconds += sampleDurations[sampleIndex];
      }
      if (Math.abs(sample.hr - threshold) <= step + Number.EPSILON) {
        nearbyPoints += 1;
        const key = formatNumber(sample.hr, precision);
        nearbyValues.set(key, (nearbyValues.get(key) || 0) + 1);
      }
    });

    return {
      name: `Zone ${index + 2} Lower`,
      threshold,
      hitPoints,
      hitSeconds,
      nearbyPoints,
      nearbyValues: [...nearbyValues.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([value, count]) => `${value}:${count}`)
        .join(" "),
    };
  });
}

function renderStatus(result) {
  const warnings = [];
  if (!result.parsed.hrSamples.every((sample) => Number.isFinite(sample.timeMs))) {
    warnings.push("部分 HR sample 没有可解析时间，时间差算法会按每点 1 秒处理。");
  }
  if (Number.isFinite(result.headerDuration)) {
    const officialVsHeader = result.reportedTotal - result.headerDuration;
    warnings.push(`官方区间合计与 Header.Duration 差 ${formatSeconds(officialVsHeader)}。`);
  }
  const best = result.bestCombos[0];
  warnings.push(`当前规则总绝对误差 ${formatSeconds(getTotalAbsDiff(result))}；最接近组合 ${formatSeconds(best.totalAbsDiff)}。`);
  setStatus(warnings.join(" "));
}

function renderSummary(result) {
  const parsed = result.parsed;
  const minHr = Math.min(...parsed.hrSamples.map((sample) => sample.hr));
  const maxSampleHr = Math.max(...parsed.hrSamples.map((sample) => sample.hr));
  const maxGap = parsed.timeStats.maxGap;
  const metrics = [
    {
      label: "官方区间合计",
      value: formatSeconds(result.reportedTotal),
      note: `运动时长 ${formatMaybeSeconds(result.headerDuration)}`,
    },
    {
      label: "重算区间合计",
      value: formatSeconds(result.computedTotal),
      note: `差 ${formatSeconds(result.computedTotal - result.reportedTotal)}`,
    },
    {
      label: "HR Sample",
      value: String(parsed.hrSamples.length),
      note: `原始 Samples ${parsed.samples.length}`,
    },
    {
      label: "MaxHR",
      value: Number.isFinite(parsed.maxHR) ? `${formatHz(parsed.maxHR)} Hz` : "N/A",
      note: Number.isFinite(parsed.maxHR) ? `${formatBpm(parsed.maxHR)} bpm` : "",
    },
    {
      label: "Sample HR 范围",
      value: `${formatHz(minHr)}-${formatHz(maxSampleHr)}`,
      note: `${formatBpm(minHr)}-${formatBpm(maxSampleHr)} bpm`,
    },
    {
      label: "最大 HR 间隔",
      value: Number.isFinite(maxGap) ? formatSeconds(maxGap) : "N/A",
      note: `推断精度 ${parsed.inferredPrecision} 位`,
    },
  ];

  els.summaryGrid.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric">
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(metric.value)}</strong>
          <small>${escapeHtml(metric.note)}</small>
        </article>
      `
    )
    .join("");
}

function renderZoneRows(result) {
  const rows = ZONE_NAMES.map((name, index) => {
    const reported = result.parsed.reportedDurations[index];
    const computed = result.computedDurations[index];
    const diff = computed - reported;
    const diffPct = reported ? (diff / reported) * 100 : NaN;
    return `
      <tr>
        <td><span class="zone-pill zone-${index + 1}">${name}</span></td>
        <td>${formatRange(result.thresholds, index, "hz", result.options.boundaryMode, result.parsed.maxHR)}</td>
        <td>${formatRange(result.thresholds, index, "bpm", result.options.boundaryMode, result.parsed.maxHR)}</td>
        <td>${formatSeconds(reported)}</td>
        <td>${formatSeconds(computed)}</td>
        <td class="${diffClass(diff)}">${formatSignedSeconds(diff)}</td>
        <td class="${diffClass(diff)}">${Number.isFinite(diffPct) ? `${formatSigned(diffPct, 2)}%` : "N/A"}</td>
        <td>${result.pointCounts[index]}</td>
      </tr>
    `;
  });

  const totalDiff = result.computedTotal - result.reportedTotal;
  rows.push(`
    <tr>
      <td class="text-cell"><strong>Total</strong></td>
      <td></td>
      <td></td>
      <td><strong>${formatSeconds(result.reportedTotal)}</strong></td>
      <td><strong>${formatSeconds(result.computedTotal)}</strong></td>
      <td class="${diffClass(totalDiff)}"><strong>${formatSignedSeconds(totalDiff)}</strong></td>
      <td></td>
      <td><strong>${sum(result.pointCounts)}</strong></td>
    </tr>
  `);

  els.zoneRows.innerHTML = rows.join("");
  els.activeRule.textContent = `${DURATION_LABELS[result.options.durationMode]} / ${THRESHOLD_LABELS[result.options.thresholdMode]} / ${BOUNDARY_LABELS[result.options.boundaryMode]}`;
}

function renderBestRows(result) {
  els.bestRows.innerHTML = result.bestCombos
    .map((combo) => {
      const options = combo.options;
      const isActive =
        options.durationMode === result.options.durationMode &&
        options.thresholdMode === result.options.thresholdMode &&
        options.boundaryMode === result.options.boundaryMode;
      const label = `${DURATION_LABELS[options.durationMode]} / ${THRESHOLD_LABELS[options.thresholdMode]} / ${BOUNDARY_LABELS[options.boundaryMode]}`;
      return `
        <tr>
          <td class="text-cell">
            <button class="combo-button" type="button" data-combo="${escapeAttr(
              JSON.stringify(options)
            )}">${escapeHtml(label)}${isActive ? " *" : ""}</button>
          </td>
          <td>${formatSeconds(combo.totalAbsDiff)}</td>
          <td class="${diffClass(combo.totalDiff)}">${formatSignedSeconds(combo.totalDiff)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderBoundaryRows(result) {
  els.boundaryRows.innerHTML = result.boundaryStats
    .map(
      (item) => `
        <tr>
          <td class="text-cell">${escapeHtml(item.name)}</td>
          <td>${formatHz(item.threshold)}</td>
          <td>${item.hitPoints}</td>
          <td>${formatSeconds(item.hitSeconds)}</td>
          <td title="${escapeAttr(item.nearbyValues)}">${item.nearbyPoints}</td>
        </tr>
      `
    )
    .join("");
  els.boundaryHint.textContent = `± ${formatHz(10 ** -result.options.precision)} Hz`;
}

function clearOutput() {
  els.summaryGrid.innerHTML = "";
  els.zoneRows.innerHTML = "";
  els.bestRows.innerHTML = "";
  els.boundaryRows.innerHTML = "";
  els.activeRule.textContent = "";
  els.boundaryHint.textContent = "";
}

function setStatus(message, isError = false) {
  els.status.classList.toggle("error", isError);
  els.status.textContent = message;
}

function getTimeStats(samples) {
  const deltas = [];
  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1].timeMs;
    const current = samples[index].timeMs;
    if (Number.isFinite(prev) && Number.isFinite(current) && current >= prev) {
      deltas.push((current - prev) / 1000);
    }
  }
  return {
    maxGap: deltas.length ? Math.max(...deltas) : NaN,
    avgGap: deltas.length ? sum(deltas) / deltas.length : NaN,
  };
}

function formatRange(thresholds, zoneIndex, unit, boundaryMode, maxHR) {
  const values = unit === "bpm" ? thresholds.map((value) => value * 60) : thresholds;
  const cap = unit === "bpm" ? maxHR * 60 : maxHR;
  const formatter = unit === "bpm" ? formatPlainBpm : formatPlainHz;
  const lowerInclusive = boundaryMode === "upper";

  if (zoneIndex === 0) {
    return `${lowerInclusive ? "<" : "<="} ${formatter(values[0])}`;
  }
  if (zoneIndex === 4) {
    const text = `${lowerInclusive ? ">=" : ">"} ${formatter(values[3])}`;
    return Number.isFinite(cap) ? `${text} / max ${formatter(cap)}` : text;
  }

  const lower = values[zoneIndex - 1];
  const upper = values[zoneIndex];
  return `${lowerInclusive ? ">=" : ">"} ${formatter(lower)} - ${
    lowerInclusive ? "<" : "<="
  } ${formatter(upper)}`;
}

function buildCsv(result) {
  const header = [
    "zone",
    "range_hz",
    "range_bpm",
    "reported_seconds",
    "computed_seconds",
    "diff_seconds",
    "diff_percent",
    "sample_points",
  ];
  const rows = ZONE_NAMES.map((name, index) => {
    const reported = result.parsed.reportedDurations[index];
    const computed = result.computedDurations[index];
    const diff = computed - reported;
    const diffPct = reported ? (diff / reported) * 100 : "";
    return [
      name,
      formatRange(result.thresholds, index, "hz", result.options.boundaryMode, result.parsed.maxHR),
      formatRange(result.thresholds, index, "bpm", result.options.boundaryMode, result.parsed.maxHR),
      roundTo(reported, 3),
      roundTo(computed, 3),
      roundTo(diff, 3),
      diffPct === "" ? "" : roundTo(diffPct, 4),
      result.pointCounts[index],
    ];
  });

  rows.push([
    "Total",
    "",
    "",
    roundTo(result.reportedTotal, 3),
    roundTo(result.computedTotal, 3),
    roundTo(result.computedTotal - result.reportedTotal, 3),
    "",
    sum(result.pointCounts),
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function getTotalAbsDiff(result) {
  return sum(
    result.computedDurations.map((value, index) =>
      Math.abs(value - result.parsed.reportedDurations[index])
    )
  );
}

function inferPrecision(values) {
  return values.reduce((max, value) => Math.max(max, decimalPlaces(value)), 0);
}

function decimalPlaces(value) {
  const text = String(value);
  if (!text.includes(".")) return 0;
  return text.split(".")[1].replace(/0+$/, "").length;
}

function almostEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function roundTo(value, digits) {
  if (!Number.isFinite(value)) return "";
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${roundTo(value, 3).toFixed(3)} s` : "N/A";
}

function formatMaybeSeconds(value) {
  return Number.isFinite(value) ? formatSeconds(value) : "N/A";
}

function formatSignedSeconds(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${roundTo(value, 3).toFixed(3)} s`;
}

function formatSigned(value, digits) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${roundTo(value, digits).toFixed(digits)}`;
}

function formatHz(value) {
  return Number.isFinite(value) ? `${formatPlainHz(value)}` : "N/A";
}

function formatBpm(value) {
  return Number.isFinite(value) ? `${formatPlainBpm(value * 60)}` : "N/A";
}

function formatPlainHz(value) {
  return Number.isFinite(value) ? roundTo(value, 3).toFixed(3) : "N/A";
}

function formatPlainBpm(value) {
  return Number.isFinite(value) ? roundTo(value, 2).toFixed(2) : "N/A";
}

function formatNumber(value, digits) {
  return Number.isFinite(value) ? roundTo(value, digits).toFixed(digits) : "N/A";
}

function diffClass(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.001) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

if (typeof module !== "undefined") {
  module.exports = {
    parseSuuntoJson,
    analyze,
    analyzeShallow,
    getSampleDurations,
    getZone,
    transformThreshold,
    buildCsv,
    labels: {
      DURATION_LABELS,
      THRESHOLD_LABELS,
      BOUNDARY_LABELS,
    },
  };
}
