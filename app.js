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
  const idx = Math.min(SHIBA_STAGES.length - 1, Math.floor(count / 5));
  return SHIBA_STAGES[idx];
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

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel(); // stop whatever's currently playing/queued first
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ja-JP";
  const voice = pickJapaneseVoice();
  if (voice) utter.voice = voice;
  speechSynthesis.speak(utter);
}

function renderTopNav() {
  const stage = stageForCompletedCount(state.completedDays.length);
  document.getElementById("home-shiba-emoji").textContent = stage.emoji;
  document.getElementById("home-shiba-name").textContent = state.shibaName || "";
}

function renderNameSection() {
  const displayRow = document.getElementById("name-display-row");
  const editRow = document.getElementById("name-edit-row");
  if (state.shibaName) {
    document.getElementById("shiba-name-display").textContent = state.shibaName;
    displayRow.classList.remove("hidden");
    editRow.classList.add("hidden");
  } else {
    // No name yet — prompt for one right away instead of showing an empty display row.
    displayRow.classList.add("hidden");
    editRow.classList.remove("hidden");
  }
}

function renderDashboard() {
  const stage = stageForCompletedCount(state.completedDays.length);
  document.getElementById("shiba-stage").textContent = stage.emoji;
  document.getElementById("day-progress").textContent =
    `Day ${Math.min(state.currentDay, TOTAL_DAYS)} of ${TOTAL_DAYS} — ${stage.label}`;
  document.getElementById("streak-display").textContent = `🔥 ${state.streak} day streak`;

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
    .sort((a, b) => a - b)
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
    btn.textContent = `Practice: ${dayData.title}`;
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
      <span class="jp">${w.jp}</span>
      <span class="romaji">${w.romaji}</span>
      <span class="en">${w.en}</span>
      <button class="speak-btn" aria-label="Play pronunciation">🔊</button>
    `;
    card.querySelector(".speak-btn").addEventListener("click", () => speak(w.jp));
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

function selectAnswer(btn, choice, answer) {
  const choicesEl = document.getElementById("quiz-choices");
  // Lock the question the instant an answer is picked, so a fast second click
  // can't register during the 0.7s pause before the next question loads.
  choicesEl.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = true));

  const isCorrect = choice === answer;
  btn.classList.add(isCorrect ? "correct" : "incorrect");
  if (isCorrect) quiz.score++;

  const jp = ROMAJI_TO_JP[choice];
  if (jp) speak(jp);

  setTimeout(() => {
    quiz.index++;
    if (quiz.index < quiz.dayData.quiz.length) {
      renderQuizQuestion();
    } else {
      finishQuiz();
    }
  }, 700);
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

  renderTopNav();
  showView("view-results");
}

document.getElementById("btn-home").addEventListener("click", () => {
  renderDashboard();
  showView("view-dashboard");
});

document.getElementById("btn-rename").addEventListener("click", () => {
  document.getElementById("shiba-name-input").value = state.shibaName || "";
  document.getElementById("name-display-row").classList.add("hidden");
  document.getElementById("name-edit-row").classList.remove("hidden");
});

document.getElementById("btn-save-name").addEventListener("click", () => {
  const input = document.getElementById("shiba-name-input");
  const name = input.value.trim();
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
