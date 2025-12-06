const STEP_COUNT = 16;
const RADIUS_PADDING = 32;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const OCTAVES = [2, 3, 4, 5];
const NOTE_POOL = OCTAVES.flatMap((oct) =>
  NOTE_NAMES.map((name) => `${name}${oct}`),
).filter((note) => {
  const midi = Tone.Frequency(note).toMidi();
  const min = Tone.Frequency("C2").toMidi();
  const max = Tone.Frequency("B5").toMidi();
  return midi >= min && midi <= max;
});
const NOTE_SET = new Set(NOTE_POOL);
const SCALE_PATTERNS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ixyolidian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  "minor pentatonic": [0, 3, 5, 7, 10],
  "minor melodic": [0, 2, 3, 5, 7, 9, 11],
};

const sequencerEl = document.getElementById("sequencer");
const clearBtn = document.getElementById("clearSteps");
const transportBtn = document.getElementById("transportToggle");
const tempoInput = document.getElementById("tempoInput");
const notePicker = document.getElementById("notePicker");
const arpNotesInput = document.getElementById("arpNotes");
const arpScaleInput = document.getElementById("arpScale");
const arpShapeInput = document.getElementById("arpShape");
const arpOctavesInput = document.getElementById("arpOctaves");
const arpStartInput = document.getElementById("arpStart");
const arpDebugInput = document.getElementById("arpDebug");
const shuffleBtn = document.getElementById("btnShuffle");
const ASSISTANT_STORAGE_KEY = "mandalaAssistantSeen";

const synth = new Tone.PolySynth(Tone.Synth).toDestination();
const steps = [];
const stepNotes = new Array(STEP_COUNT).fill("");
const manualNoteVariants = new Array(STEP_COUNT).fill("dark");
const generatedNotes = new Array(STEP_COUNT).fill("");
const mutedPitchClasses = new Set();
let currentPlaybackIdx = null;
let pickerTargetIndex = null;
let pickerAnchor = null;
let pickerNoteShade = "dark";
let assistantEl = null;

const ensureAudioContext = async () => {
  if (Tone.getContext().state !== "running") {
    await Tone.start();
  }
};

Tone.Transport.loop = true;
Tone.Transport.loopEnd = "1m";
Tone.Transport.bpm.value = Number(tempoInput.value) || 120;

const createSteps = () => {
  for (let i = 0; i < STEP_COUNT; i += 1) {
    const stepBtn = document.createElement("button");
    stepBtn.type = "button";
    stepBtn.className = "sequencer__step";
    stepBtn.innerHTML = `<span class="sequencer__step-note"></span>`;
    stepBtn.setAttribute("aria-pressed", "false");
    stepBtn.dataset.index = i;
    stepBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openNotePicker(stepBtn, i);
    });
    sequencerEl.appendChild(stepBtn);
    steps.push(stepBtn);
  }

  positionSteps();
  window.addEventListener("resize", positionSteps);
};

const positionSteps = () => {
  const size = sequencerEl.clientWidth;
  const center = size / 2;
  const radius = center - RADIUS_PADDING;

  steps.forEach((step, idx) => {
    const angle = (idx / STEP_COUNT) * Math.PI * 2 - Math.PI / 2;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);

    step.style.left = `${x}px`;
    step.style.top = `${y}px`;
  });
};

const formatNoteLabel = (note) => {
  if (!note) return "";
  const trimmed = note.trim();
  if (!trimmed) return "";
  const first = trimmed.slice(0, 1).toUpperCase();
  const rest = trimmed.slice(1);
  return `${first}${rest}`;
};

const getDisplayNote = (index) => stepNotes[index] || generatedNotes[index] || "";

const getPitchClass = (note) => {
  if (!note) return "";
  const match = note.trim().match(/^([A-G](?:#|b)?)/i);
  return match ? match[1].toUpperCase() : "";
};

const isNoteMuted = (note) => mutedPitchClasses.has(getPitchClass(note));

const refreshAllSteps = () => {
  steps.forEach((_, idx) => refreshStepState(idx));
};

const updateStepNoteLabel = (index) => {
  const step = steps[index];
  if (!step) return;
  const noteEl = step.querySelector(".sequencer__step-note");
  if (noteEl) {
    noteEl.textContent = formatNoteLabel(getDisplayNote(index));
  }
};

const refreshStepState = (index) => {
  const stepBtn = steps[index];
  if (!stepBtn) return;
  const hasManual = Boolean(stepNotes[index]);
  const hasGenerated = Boolean(generatedNotes[index]);
  const shade = manualNoteVariants[index] || "dark";
  const note = getDisplayNote(index);
  const muted = isNoteMuted(note);
  stepBtn.classList.toggle("is-active", hasManual);
  stepBtn.classList.toggle("is-light", hasManual && shade === "light");
  stepBtn.classList.toggle("is-dark", hasManual && shade !== "light");
  stepBtn.classList.toggle("is-generated", !hasManual && hasGenerated);
  stepBtn.classList.toggle("is-muted", Boolean(note) && muted);
  stepBtn.setAttribute("aria-pressed", String(hasManual || hasGenerated));
  updateStepNoteLabel(index);
};

const getNoteAtOffset = (rootNote, offsetSemitones) => {
  if (!rootNote && rootNote !== 0) {
    return "";
  }
  const minMidi = Tone.Frequency("C2").toMidi();
  const maxMidi = Tone.Frequency("B6").toMidi();
  const rootMidi = Tone.Frequency(rootNote).toMidi();
  const midi = Math.min(Math.max(rootMidi + offsetSemitones, minMidi), maxMidi);
  return Tone.Frequency(midi, "midi").toNote();
};

const buildShapePermutations = (count) => {
  if (count <= 0) {
    return [[]];
  }
  const source = Array.from({ length: count }, (_, idx) => idx);
  const permutations = [];
  const dfs = (path, remaining) => {
    if (path.length === count) {
      permutations.push([...path]);
      return;
    }
    remaining.forEach((value, idx) => {
      const nextPath = [...path, value];
      const nextRemaining = remaining.filter((_, rIdx) => rIdx !== idx);
      dfs(nextPath, nextRemaining);
    });
  };
  dfs([], source);
  return permutations;
};

const formatShapeValue = (shape) => shape.map((idx) => idx + 1).join("-");
const formatShapeLabel = (shape) => shape.map((idx) => idx + 1).join(" → ");

const parseShapeValue = (value, count) =>
  value
    .split("-")
    .map((num) => Number(num) - 1)
    .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < count);

const sanitizeStartNote = (value) => {
  const candidate = (value || "").trim();
  const fallback = "C2";
  try {
    return candidate ? Tone.Frequency(candidate).toNote() : fallback;
  } catch {
    return fallback;
  }
};

const markAssistantSeen = () => {
  try {
    localStorage.setItem(ASSISTANT_STORAGE_KEY, "1");
  } catch {
    // ignore storage failures
  }
};

const hideAssistant = () => {
  if (assistantEl) {
    assistantEl.remove();
    assistantEl = null;
  }
};

const showAssistant = () => {
  try {
    if (localStorage.getItem(ASSISTANT_STORAGE_KEY)) return;
  } catch {
    // if storage fails, still show assistant once
  }
  if (assistantEl) return;
  const overlay = document.createElement("div");
  overlay.className = "assistant";
  overlay.innerHTML = `
    <div class="assistant__card" role="dialog" aria-label="How to use the sequencer">
      <p class="assistant__eyebrow">First time here?</p>
      <h3 class="assistant__title">Quick start</h3>
      <ol class="assistant__steps">
        <li>Add one note on the circle.</li>
        <li>Choose your parameters (steps, scale, range).</li>
        <li>Tap Shuffle to fill the pattern.</li>
        <li>Press Play to hear it loop.</li>
      </ol>
      <div class="assistant__actions">
        <button type="button" class="btn btn--primary assistant__close" data-assistant-dismiss>Got it</button>
      </div>
    </div>
  `;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      markAssistantSeen();
      hideAssistant();
    }
  });
  const closeBtn = overlay.querySelector("[data-assistant-dismiss]");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      markAssistantSeen();
      hideAssistant();
    });
  }
  assistantEl = overlay;
  document.body.appendChild(overlay);
};

const updateDebugInfo = () => {
  const pattern = getScalePattern(arpScaleInput.value);
  const notesPerArp = Number(arpNotesInput.value) || 1;
  const degrees = pattern.slice(0, notesPerArp);
  const shapeOrder = getShapeOrder();
  const sequence = shapeOrder
    .map((shapeIdx) => degrees[shapeIdx])
    .filter((interval) => typeof interval === "number");
  if (sequence.length === 0) {
    arpDebugInput.value = "";
    return;
  }
  const octaves = Math.max(1, Number(arpOctavesInput.value) || 1);
  const startNote = sanitizeStartNote(arpStartInput.value);
  const ordered = sequence.length > 1 ? [...sequence.slice(1), sequence[0]] : [...sequence];
  const debugNotes = [startNote];
  for (let cycle = 0; cycle < octaves; cycle += 1) {
    ordered.forEach((interval) => {
      debugNotes.push(getNoteAtOffset(startNote, interval + cycle * 12));
    });
  }
  debugNotes.push(getNoteAtOffset(startNote, ordered[0]));
  const debugOrder = debugNotes.join(" → ");
  arpDebugInput.value = debugOrder;
  const manualNote = startNote;
  const settingsSummary = [
    `Number of arp steps: ${notesPerArp}`,
    `Arp style: ${formatShapeLabel(shapeOrder)}`,
    `Scale: ${arpScaleInput.value}`,
    `Range: ${octaves} octave${octaves > 1 ? "s" : ""}`,
    `Starting note: ${manualNote}`,
    `Debug order: ${debugOrder}`,
    `Generated notes:\n${
      generatedNotes.some(Boolean)
        ? generatedNotes
            .map((note, idx) => (note ? `• Step ${idx + 1}: ${note}` : null))
            .filter(Boolean)
            .join("\n")
        : "• none"
    }`,
  ].join("\n");
  document.getElementById("arpSettings").textContent = settingsSummary;
};

const syncShapeOptions = () => {
  const count = Number(arpNotesInput.value) || 1;
  const shapes = buildShapePermutations(count);
  const previous = arpShapeInput.value;
  arpShapeInput.innerHTML = "";
  shapes.forEach((shape) => {
    const option = document.createElement("option");
    option.value = formatShapeValue(shape);
    option.textContent = formatShapeLabel(shape);
    arpShapeInput.appendChild(option);
  });
  const hasPrev = shapes.some((shape) => formatShapeValue(shape) === previous);
  if (hasPrev) {
    arpShapeInput.value = previous;
  }
  updateDebugInfo();
};

const getShapeOrder = () => {
  const count = Number(arpNotesInput.value) || 1;
  const parsed = parseShapeValue(arpShapeInput.value || "", count);
  if (parsed.length === count) {
    return parsed;
  }
  const fallback = buildShapePermutations(count)[0] || [];
  return fallback;
};

const clearGeneratedAt = (index) => {
  generatedNotes[index] = "";
};

const clearGeneratedSteps = () => {
  generatedNotes.fill("");
  steps.forEach((_, idx) => {
    refreshStepState(idx);
  });
};

const applyGeneratedNote = (index, note) => {
  if (stepNotes[index]) {
    return;
  }
  generatedNotes[index] = note;
  refreshStepState(index);
};

const normalizeScaleKey = (value) =>
  (value || "major")
    .toString()
    .trim()
    .toLowerCase();

const getScalePattern = (scaleName) =>
  SCALE_PATTERNS[normalizeScaleKey(scaleName)] || SCALE_PATTERNS.major;

const getIndicesBetween = (startIndex, endIndex) => {
  const indices = [];
  let cursor = (startIndex + 1) % STEP_COUNT;
  while (cursor !== endIndex) {
    indices.push(cursor);
    cursor = (cursor + 1) % STEP_COUNT;
    if (cursor === (startIndex + 1) % STEP_COUNT) {
      break;
    }
  }
  return indices;
};

const shuffleArray = (arr) => {
  const clone = [...arr];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
};

const hideNotePicker = () => {
  notePicker.hidden = true;
  notePicker.innerHTML = "";
  pickerTargetIndex = null;
  pickerAnchor = null;
};

const setNoteShade = (shade, index) => {
  pickerNoteShade = shade === "light" ? "light" : "dark";
  notePicker.querySelectorAll("[data-note-shade]").forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.noteShade === pickerNoteShade);
  });
  if (typeof index === "number" && stepNotes[index]) {
    manualNoteVariants[index] = pickerNoteShade;
    refreshStepState(index);
  }
};

const renderNotePicker = (index) => {
  notePicker.innerHTML = "";
  const currentNote = getDisplayNote(index);
  OCTAVES.forEach((octave) => {
    const rowWrapper = document.createElement("div");
    rowWrapper.className = "note-picker__row";

    const label = document.createElement("div");
    label.className = "note-picker__label";
    label.textContent = `Oct ${octave}`;

    const row = document.createElement("div");
    row.className = "note-picker__octave";

    NOTE_NAMES.forEach((base) => {
      const note = `${base}${octave}`;
      if (!NOTE_SET.has(note)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "note-picker__option";
      btn.textContent = note;
      if (note === stepNotes[index]) {
        btn.classList.add("is-selected");
      }
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await applyNoteSelection(index, note, pickerNoteShade);
        hideNotePicker();
      });
      row.appendChild(btn);
    });

    rowWrapper.appendChild(label);
    rowWrapper.appendChild(row);
    notePicker.appendChild(rowWrapper);
  });

  const shadeRow = document.createElement("div");
  shadeRow.className = "note-picker__shade";

  const shadeLabel = document.createElement("div");
  shadeLabel.className = "note-picker__label";
  shadeLabel.textContent = "Shade";

  const shadeOptions = document.createElement("div");
  shadeOptions.className = "note-picker__shade-options";

  const darkBtn = document.createElement("button");
  darkBtn.type = "button";
  darkBtn.className = "note-picker__chip";
  darkBtn.dataset.noteShade = "dark";
  darkBtn.textContent = "Dark red";
  darkBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setNoteShade("dark", index);
  });

  const lightBtn = document.createElement("button");
  lightBtn.type = "button";
  lightBtn.className = "note-picker__chip";
  lightBtn.dataset.noteShade = "light";
  lightBtn.textContent = "Light red";
  lightBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setNoteShade("light", index);
  });

  shadeOptions.appendChild(darkBtn);
  shadeOptions.appendChild(lightBtn);
  shadeRow.appendChild(shadeLabel);
  shadeRow.appendChild(shadeOptions);
  notePicker.appendChild(shadeRow);

  const muteRow = document.createElement("div");
  muteRow.className = "note-picker__mute";

  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "note-picker__chip note-picker__chip--mute";
  const updateMuteLabel = () => {
    const pitchClass = getPitchClass(currentNote);
    const muted = isNoteMuted(currentNote);
    muteBtn.textContent =
      currentNote && pitchClass
        ? muted
          ? `Unmute ${pitchClass}`
          : `Mute ${pitchClass}`
        : "Mute note";
    muteBtn.disabled = !currentNote;
    muteBtn.classList.toggle("is-selected", muted);
  };
  muteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const pitchClass = getPitchClass(currentNote);
    if (!pitchClass) return;
    if (mutedPitchClasses.has(pitchClass)) {
      mutedPitchClasses.delete(pitchClass);
    } else {
      mutedPitchClasses.add(pitchClass);
    }
    refreshAllSteps();
    updateMuteLabel();
    hideNotePicker();
  });
  updateMuteLabel();
  muteRow.appendChild(muteBtn);
  notePicker.appendChild(muteRow);

  const clearOption = document.createElement("button");
  clearOption.type = "button";
  clearOption.className = "note-picker__clear";
  clearOption.textContent = "Clear note";
  clearOption.addEventListener("click", async () => {
    await applyNoteSelection(index, "", pickerNoteShade);
    hideNotePicker();
  });
  notePicker.appendChild(clearOption);

  const hint = document.createElement("div");
  hint.className = "note-picker__hint";
  hint.textContent = "Tap outside or press Esc to close";
  notePicker.appendChild(hint);

  setNoteShade(manualNoteVariants[index] || "dark", index);
};

const openNotePicker = (stepBtn, index) => {
  pickerTargetIndex = index;
  pickerAnchor = stepBtn;
  pickerNoteShade = manualNoteVariants[index] || "dark";
  renderNotePicker(index);
  notePicker.hidden = false;
  notePicker.style.visibility = "hidden";
  const rect = stepBtn.getBoundingClientRect();
  const pickerRect = notePicker.getBoundingClientRect();
  let top = rect.top + window.scrollY - pickerRect.height - 8;
  if (top < 16) {
    top = rect.bottom + window.scrollY + 8;
  }
  let left = rect.left + window.scrollX - pickerRect.width / 2 + rect.width / 2;
  const maxLeft =
    document.documentElement.clientWidth + window.scrollX - pickerRect.width - 16;
  left = Math.min(Math.max(left, 16), maxLeft);
  notePicker.style.top = `${top}px`;
  notePicker.style.left = `${left}px`;
  notePicker.style.visibility = "visible";
  notePicker.scrollTop = 0;
};

const applyNoteSelection = async (index, note, shade = "dark") => {
  if (note) {
    stepNotes[index] = note;
    manualNoteVariants[index] = shade === "light" ? "light" : "dark";
    clearGeneratedAt(index);
    refreshStepState(index);
    if (!isNoteMuted(note)) {
      await ensureAudioContext();
      synth.triggerAttackRelease(note, "16n");
    }
  } else {
    stepNotes[index] = "";
    manualNoteVariants[index] = "dark";
    clearGeneratedAt(index);
    refreshStepState(index);
  }
};

const clearSteps = () => {
  stepNotes.fill("");
  manualNoteVariants.fill("dark");
  mutedPitchClasses.clear();
  clearGeneratedSteps();
  steps.forEach((_, idx) => {
    refreshStepState(idx);
  });
  hideNotePicker();
  updateDebugInfo();
};

const clearPlaybackHead = () => {
  if (currentPlaybackIdx !== null && steps[currentPlaybackIdx]) {
    steps[currentPlaybackIdx].classList.remove("is-current");
  }
  currentPlaybackIdx = null;
};

const flashStep = (index) => {
  if (steps[index]) {
    clearPlaybackHead();
    steps[index].classList.add("is-current");
    currentPlaybackIdx = index;
  }
};

const handleTempoChange = () => {
  const parsed = Number(tempoInput.value);
  if (!Number.isFinite(parsed)) {
    return;
  }
  const clamped = Math.min(Math.max(parsed, 40), 220);
  tempoInput.value = clamped;
  Tone.Transport.bpm.rampTo(clamped, 0.1);
};

const updateTransportUI = (isPlaying) => {
  transportBtn.textContent = isPlaying ? "Stop" : "Play";
  transportBtn.classList.toggle("btn--primary", !isPlaying);
};

const handleTransportToggle = async () => {
  await ensureAudioContext();
  if (Tone.Transport.state === "started") {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    clearPlaybackHead();
    updateTransportUI(false);
  } else {
    Tone.Transport.position = 0;
    clearPlaybackHead();
    Tone.Transport.start();
    updateTransportUI(true);
  }
};

const handleShuffle = () => {
  const manualIndexes = stepNotes
    .map((note, idx) => (note ? idx : -1))
    .filter((idx) => idx >= 0);

  if (manualIndexes.length === 0) {
    return;
  }

  clearGeneratedSteps();
  const pattern = getScalePattern(arpScaleInput.value);
  const notesPerArp = Number(arpNotesInput.value) || 3;
  const octaveSpan = Number(arpOctavesInput.value) || 1;
  const baseIntervals = pattern.slice(0, Math.max(1, notesPerArp));
  const shapeOrder = getShapeOrder();
  const sequence = shapeOrder
    .map((shapeIdx) => baseIntervals[shapeIdx])
    .filter((interval) => typeof interval === "number");
  if (sequence.length === 0) {
    return;
  }
const orderedIntervals =
  sequence.length > 1 ? [...sequence.slice(1), sequence[0]] : [...sequence];
const stepsPerCycle = orderedIntervals.length;

manualIndexes.sort((a, b) => a - b);

  manualIndexes.forEach((manualIdx, idx) => {
    const nextManualIdx = manualIndexes[(idx + 1) % manualIndexes.length];
    const availablePositions = getIndicesBetween(manualIdx, nextManualIdx).filter(
      (pos) => !stepNotes[pos],
    );
    if (availablePositions.length === 0) {
      return;
    }
    const fillCount = Math.floor(Math.random() * (availablePositions.length + 1));
    const targets = shuffleArray(availablePositions).slice(0, fillCount);
    const targetSet = new Set(targets);
    const orderedTargets = availablePositions
      .map((pos, idx) => ({ pos, idx }))
      .filter(({ pos }) => targetSet.has(pos))
      .sort((a, b) => a.idx - b.idx);

    orderedTargets.forEach(({ pos }, orderIdx) => {
      const span = Math.max(1, octaveSpan);
      if (stepsPerCycle === 0) {
        return;
      }
      const seqIndex = orderIdx % stepsPerCycle;
      const cycle = Math.floor(orderIdx / stepsPerCycle);
      const isManualInterval =
        sequence.length > 1 && seqIndex === stepsPerCycle - 1;
      const octaveCycle =
        span > 0 ? (cycle + (isManualInterval ? 1 : 0)) % span : 0;
      const interval = orderedIntervals[seqIndex] + octaveCycle * 12;
      const note = getNoteAtOffset(stepNotes[manualIdx], interval);
      if (note) {
        applyGeneratedNote(pos, note);
      }
    });
    if (manualIndexes.length === 1) {
      return;
    }
  });
  updateDebugInfo();
};

const sequence = new Tone.Sequence(
  (time, stepIndex) => {
    Tone.Draw.schedule(() => flashStep(stepIndex), time);
    const note = getDisplayNote(stepIndex);
    if (note && !isNoteMuted(note)) {
      synth.triggerAttackRelease(note, "16n", time);
    }
  },
  Array.from({ length: STEP_COUNT }, (_, idx) => idx),
  "16n",
);
sequence.start(0);

document.addEventListener("click", (event) => {
  if (notePicker.hidden) return;
  if (notePicker.contains(event.target)) return;
  if (pickerAnchor && pickerAnchor.contains(event.target)) return;
  hideNotePicker();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideNotePicker();
  }
});

arpStartInput.value = sanitizeStartNote(arpStartInput.value);
syncShapeOptions();
createSteps();
clearBtn.addEventListener("click", clearSteps);
transportBtn.addEventListener("click", handleTransportToggle);
tempoInput.addEventListener("change", handleTempoChange);
arpNotesInput.addEventListener("change", () => {
  syncShapeOptions();
});
arpScaleInput.addEventListener("change", updateDebugInfo);
arpShapeInput.addEventListener("change", updateDebugInfo);
arpOctavesInput.addEventListener("change", updateDebugInfo);
arpStartInput.addEventListener("change", () => {
  arpStartInput.value = sanitizeStartNote(arpStartInput.value);
  updateDebugInfo();
});
shuffleBtn.addEventListener("click", handleShuffle);
showAssistant();
