const STORAGE_KEY = "shiba-japanese-state";
const TOTAL_DAYS = 30;

const SHIBA_STAGES = [
  { emoji: "🥚", label: "Egg" },
  { emoji: "🐣", label: "Newborn Pup" },
  { emoji: "🐕", label: "Puppy" },
  { emoji: "🐕‍🦺", label: "Adolescent" },
  { emoji: "🐕‍🦺", label: "Young Adult" },
  { emoji: "🎌🐕", label: "Full-Grown Shiba" },
];
const DAYS_PER_STAGE = 5;

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);
  return { currentDay: 1, completedDays: [], streak: 0, xp: 0, lastCompletedDate: null, shibaName: null };
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();
let quiz = { dayData: null, index: 0, score: 0 };
let activeDayData = null; // whichever day's lesson is currently on screen
let nextLessonDayData = null; // the day offered by the results screen's "Continue" button

// Quiz choices are romaji-only, but pronunciation needs actual kana — build a
// romaji -> kana lookup from every day's word list so we know what to speak.
const ROMAJI_TO_JP = {};
CURRICULUM.forEach((day) => {
  day.words.forEach((w) => {
    ROMAJI_TO_JP[w.romaji] = w.jp;
  });
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function stageForCompletedCount(count) {
  const idx = Math.min(SHIBA_STAGES.length - 1, Math.floor(count / DAYS_PER_STAGE));
  return SHIBA_STAGES[idx];
}

// Progress toward the next stage, for the dashboard's progress bar — moves
// forward with every newly completed lesson, even between actual stage
// changes, so there's always some visible feedback. Returns null once the
// final stage is reached.
function nextStageProgress(count) {
  const idx = Math.min(SHIBA_STAGES.length - 1, Math.floor(count / DAYS_PER_STAGE));
  if (idx >= SHIBA_STAGES.length - 1) return null;
  const next = SHIBA_STAGES[idx + 1];
  const daysIntoStage = count - idx * DAYS_PER_STAGE;
  const pct = Math.min(100, Math.round((daysIntoStage / DAYS_PER_STAGE) * 100));
  return { next, pct, daysToGo: DAYS_PER_STAGE - daysIntoStage };
}

function showView(id) {
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// Available voices load asynchronously in most browsers, so cache them once
// ready rather than querying getVoices() fresh (and often empty) every call.
let cachedVoices = [];
if ("speechSynthesis" in window) {
  const loadVoices = () => { cachedVoices = speechSynthesis.getVoices(); };
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function pickJapaneseVoice() {
  const jaVoices = cachedVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("ja"));
  if (jaVoices.length === 0) return null;
  // Prefer known higher-quality engines (Google's ja-JP voice in Chrome, or
  // "Enhanced"/"Premium" voices on macOS/iOS) over the default robotic one.
  const preferred = jaVoices.find((v) => /google|enhanced|premium|neural/i.test(v.name));
  return preferred || jaVoices[0];
}

// onDone (optional) fires once the audio actually finishes — used by the quiz
// to wait for real playback length instead of guessing a fixed delay.
function speak(text, onDone) {
  if (!("speechSynthesis" in window)) {
    if (onDone) onDone();
    return;
  }
  speechSynthesis.cancel(); // stop whatever's currently playing/queued first
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  const voice = pickJapaneseVoice();
  if (voice) utter.voice = voice;
  if (onDone) {
    let done = false;
    const finish = () => { if (!done) { done = true; onDone(); } };
    utter.onend = finish;
    utter.onerror = finish;
    setTimeout(finish, 4000); // safety net in case the browser never fires onend
  }
  speechSynthesis.speak(utter);
}

function renderTopNav() {
  const stage = stageForCompletedCount(state.completedDays.length);
  document.getElementById("home-shiba-emoji").textContent = stage.emoji;
  document.getElementById("home-shiba-name").textContent = state.shibaName || "";
  document.getElementById("streak-count").textContent = `${state.streak} day streak`;
}

function renderNameSection() {
  const editRow = document.getElementById("name-edit-row");

  const titleText = `${state.shibaName || "Shiba"}'s 30 Day Japanese Lesson`;
  document.getElementById("page-title").textContent = titleText;
  document.title = titleText;

  if (state.shibaName) {
    editRow.classList.add("hidden");
  } else {
    // No name yet — prompt for one right away instead of leaving it blank.
    editRow.classList.remove("hidden");
  }
}

function renderDashboard() {
  const stage = stageForCompletedCount(state.completedDays.length);
  document.getElementById("shiba-stage").textContent = stage.emoji;
  document.getElementById("day-progress").textContent =
    `Day ${Math.min(state.currentDay, TOTAL_DAYS)} of ${TOTAL_DAYS} — ${stage.label}`;

  // Bar fill reflects the whole 30-day journey; the label underneath still
  // counts down to the next character stage specifically.
  const overallPct = Math.min(100, Math.round((state.completedDays.length / TOTAL_DAYS) * 100));
  const barFill = document.getElementById("xp-bar-fill");
  const barLabel = document.getElementById("xp-bar-label");
  barFill.style.width = `${overallPct}%`;

  const progress = nextStageProgress(state.completedDays.length);
  barLabel.textContent = progress
    ? `${progress.daysToGo} lesson${progress.daysToGo === 1 ? "" : "s"} to go until ${progress.next.label}`
    : "Max stage reached!";

  const btn = document.getElementById("btn-start-lesson");
  const dayData = CURRICULUM.find((d) => d.day === state.currentDay);
  btn.disabled = !dayData;
  btn.textContent = dayData ? `Start Day ${state.currentDay}'s Lesson` : "More lessons coming soon!";

  renderNameSection();
  renderPracticeList();
  renderTopNav();
}

function renderPracticeList() {
  const section = document.getElementById("practice-section");
  const list = document.getElementById("practice-list");
  list.innerHTML = "";

  const completedLessons = state.completedDays
    .slice()
    .sort((a, b) => b - a)
    .map((day) => CURRICULUM.find((d) => d.day === day))
    .filter(Boolean);

  if (completedLessons.length === 0) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");

  completedLessons.forEach((dayData) => {
    const btn = document.createElement("button");
    btn.className = "practice-btn";
    btn.textContent = dayData.title;
    btn.addEventListener("click", () => {
      renderLesson(dayData);
      showView("view-lesson");
    });
    list.appendChild(btn);
  });
}

function renderLesson(dayData) {
  activeDayData = dayData;
  document.getElementById("lesson-title").textContent = dayData.title;
  const container = document.getElementById("lesson-cards");
  container.innerHTML = "";
  dayData.words.forEach((w) => {
    const card = document.createElement("div");
    card.className = "word-card";
    card.innerHTML = `
      <span class="romaji">${w.romaji}</span>
      <span class="jp">${w.jp}</span>
      <span class="en">${w.en}</span>
      <button class="speak-btn" aria-label="Play pronunciation">🔊</button>
    `;
    const speakBtn = card.querySelector(".speak-btn");
    const romajiEl = card.querySelector(".romaji");
    speakBtn.addEventListener("click", () => {
      speakBtn.classList.add("playing");
      romajiEl.classList.add("playing");
      speak(w.jp, () => {
        speakBtn.classList.remove("playing");
        romajiEl.classList.remove("playing");
      });
    });
    container.appendChild(card);
  });
}

function startQuiz(dayData) {
  quiz = { dayData, index: 0, score: 0 };
  renderQuizQuestion();
  showView("view-quiz");
}

function renderQuizQuestion() {
  const q = quiz.dayData.quiz[quiz.index];
  document.getElementById("quiz-progress").textContent =
    `Question ${quiz.index + 1} of ${quiz.dayData.quiz.length}`;
  document.getElementById("quiz-question").textContent = q.question;

  const choicesEl = document.getElementById("quiz-choices");
  choicesEl.innerHTML = "";
  q.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice;
    btn.addEventListener("click", () => selectAnswer(btn, choice, q.answer));
    choicesEl.appendChild(btn);
  });
}

const QUIZ_BEAT_MS = 400; // short pause after feedback (and any audio) before advancing

function selectAnswer(btn, choice, answer) {
  const choicesEl = document.getElementById("quiz-choices");
  // Lock the question the instant an answer is picked, so a fast second click
  // can't register before the next question loads.
  choicesEl.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = true));

  const isCorrect = choice === answer;
  btn.classList.add(isCorrect ? "correct" : "incorrect");
  if (isCorrect) quiz.score++;

  const advance = () => {
    setTimeout(() => {
      quiz.index++;
      if (quiz.index < quiz.dayData.quiz.length) {
        renderQuizQuestion();
      } else {
        finishQuiz();
      }
    }, QUIZ_BEAT_MS);
  };

  const jp = ROMAJI_TO_JP[choice];
  if (jp) {
    speak(jp, advance); // wait for the actual pronunciation to finish, then beat, then advance
  } else {
    advance();
  }
}

function finishQuiz() {
  const day = quiz.dayData.day;
  const stageBefore = stageForCompletedCount(state.completedDays.length);
  const alreadyCompleted = state.completedDays.includes(day);

  if (!alreadyCompleted) {
    state.completedDays.push(day);
    state.xp += quiz.score * 10;

    const today = todayStr();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (state.lastCompletedDate === yesterday) {
      state.streak += 1;
    } else if (state.lastCompletedDate !== today) {
      state.streak = 1;
    }
    state.lastCompletedDate = today;

    if (day === state.currentDay) {
      state.currentDay = Math.min(TOTAL_DAYS, day + 1);
    }
    saveState(state);
  }

  const stageAfter = stageForCompletedCount(state.completedDays.length);
  document.getElementById("results-score").textContent =
    `You got ${quiz.score}/${quiz.dayData.quiz.length} correct.`;
  document.getElementById("results-growth").textContent =
    stageAfter.label !== stageBefore.label
      ? `Your Shiba grew into a ${stageAfter.label}! ${stageAfter.emoji}`
      : "Keep going — your Shiba is getting closer to its next stage!";

  nextLessonDayData = CURRICULUM.find((d) => d.day === state.currentDay);
  const nextBtn = document.getElementById("btn-next-lesson");
  if (nextLessonDayData) {
    nextBtn.textContent = `Continue to Day ${nextLessonDayData.day}'s Lesson`;
    nextBtn.classList.remove("hidden");
  } else {
    nextBtn.classList.add("hidden");
  }

  renderTopNav();
  showView("view-results");
}

document.getElementById("btn-home").addEventListener("click", () => {
  renderDashboard();
  showView("view-dashboard");
});

document.getElementById("btn-rename").addEventListener("click", () => {
  // The pencil lives in the global header now, so make sure the rename field
  // it opens is actually visible regardless of which screen it was clicked from.
  renderDashboard();
  showView("view-dashboard");
  const input = document.getElementById("shiba-name-input");
  input.value = state.shibaName || "";
  document.getElementById("name-edit-row").classList.remove("hidden");
  input.focus();
});

document.getElementById("btn-save-name").addEventListener("click", () => {
  const input = document.getElementById("shiba-name-input");
  const name = input.value.trim().slice(0, 20);
  if (!name) return;
  state.shibaName = name;
  saveState(state);
  renderNameSection();
  renderTopNav();
});

document.getElementById("btn-start-lesson").addEventListener("click", () => {
  const dayData = CURRICULUM.find((d) => d.day === state.currentDay);
  if (!dayData) return;
  renderLesson(dayData);
  showView("view-lesson");
});

document.getElementById("btn-to-quiz").addEventListener("click", () => {
  startQuiz(activeDayData);
});

document.getElementById("btn-next-lesson").addEventListener("click", () => {
  if (!nextLessonDayData) return;
  renderLesson(nextLessonDayData);
  showView("view-lesson");
});

document.getElementById("btn-repeat-lesson").addEventListener("click", () => {
  renderLesson(quiz.dayData);
  showView("view-lesson");
});

document.getElementById("btn-to-dashboard").addEventListener("click", () => {
  renderDashboard();
  showView("view-dashboard");
});

renderDashboard();
renderTopNav();
showView("view-dashboard");
