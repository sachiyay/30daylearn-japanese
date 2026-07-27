const STORAGE_KEY = "shiba-japanese-state";
const TOTAL_DAYS = 30;

const SHIBA_STAGES = [
  { image: "assets/shiba/shiba-01.png", label: "Egg" },
  { image: "assets/shiba/shiba-02.png", label: "Hatching" },
  { image: "assets/shiba/shiba-03.png", label: "Newborn Pup" },
  { image: "assets/shiba/shiba-04.png", label: "Baby Pup" },
  { image: "assets/shiba/shiba-05.png", label: "Puppy" },
  { image: "assets/shiba/shiba-06.png", label: "Young Puppy" },
  { image: "assets/shiba/shiba-07.png", label: "Juvenile" },
  { image: "assets/shiba/shiba-08.png", label: "Adolescent" },
  { image: "assets/shiba/shiba-09.png", label: "Young Adult" },
  { image: "assets/shiba/shiba-10.png", label: "Adult" },
  { image: "assets/shiba/shiba-11.png", label: "Full-Grown Shiba" },
];
const DAYS_PER_STAGE = 3;

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);
  return { currentDay: 1, completedDays: [], streak: 0, xp: 0, lastCompletedDate: null, shibaName: null };
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const isNewUser = localStorage.getItem(STORAGE_KEY) === null;
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

// Elements waiting for the very first name-save before they reveal — set by
// runWelcomeSequence, consumed by the btn-save-name handler.
let pendingRevealEls = [];

// First-visit-only: types out a welcome message in the egg's spot, then
// crossfades it out as the egg + name field fade in to replace it. The rest
// of the dashboard (progress bar, start-lesson button) stays hidden until
// the user actually saves a name.
function runWelcomeSequence() {
  const line1 = "Welcome to your Japanese Lesson!";
  const line2 = "Let's grow your shiba-inu as you play :)";
  // "<br>" is kept as one whole token (never typed character-by-character),
  // so it's inserted atomically and never briefly shows as literal text.
  const tokens = [...line1.split(""), "<br>", ...line2.split("")];

  const welcomeEl = document.getElementById("welcome-message");
  const stageOneEls = [
    document.getElementById("shiba-stage"),
    document.getElementById("name-edit-row"),
  ];
  const stageTwoEls = [
    document.getElementById("day-progress"),
    document.getElementById("xp-bar-track"),
    document.getElementById("xp-bar-label"),
    document.getElementById("btn-start-lesson"),
  ];

  welcomeEl.classList.remove("hidden");
  [...stageOneEls, ...stageTwoEls].forEach((el) => el.classList.add("reveal-hidden"));

  let i = 0;
  const typeSpeed = 70; // ms per character
  const typer = setInterval(() => {
    i++;
    const shown = tokens.slice(0, i).join("");
    welcomeEl.innerHTML = shown + (i < tokens.length ? "|" : "");
    if (i >= tokens.length) clearInterval(typer);
  }, typeSpeed);

  const readPause = 2200; // time to actually read the finished message before it fades
  setTimeout(() => {
    welcomeEl.classList.add("reveal-hidden"); // fade the message out...
    stageOneEls.forEach((el) => el.classList.remove("reveal-hidden")); // ...as the egg + name field fade in
    pendingRevealEls = stageTwoEls; // held back until the name is actually saved
  }, tokens.length * typeSpeed + readPause);
}

function showView(id) {
  const current = document.querySelector(".view:not(.hidden)");
  const next = document.getElementById(id);
  if (current === next) return;

  const activateNext = () => {
    if (current) {
      current.classList.add("hidden");
      current.style.opacity = "";
    }
    next.classList.remove("hidden");
    next.style.opacity = "0";
    void next.offsetWidth; // force a reflow so the opacity change below actually transitions
    next.style.opacity = "1";
  };

  if (current) {
    current.style.opacity = "0";
    setTimeout(activateNext, 180);
  } else {
    activateNext();
  }
}

// Same fade-out-then-in used between full screens, but for swapping content
// within a single element (e.g. one quiz question to the next).
function fadeSwapContent(el, updateFn) {
  el.style.opacity = "0";
  setTimeout(() => {
    updateFn();
    void el.offsetWidth; // force a reflow so the opacity change below actually transitions
    el.style.opacity = "1";
  }, 180);
}

// Celebratory burst, centered on the whole app box and scaled to its size
// (via getBoundingClientRect) so it reads clearly on any screen, including
// small mobile ones where the header pill alone was too small/cramped to notice.
function celebrateConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const anchor = document.getElementById("app");
  const rect = anchor.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;

  const colors = ["#e07a3f", "#66bb6a", "#42a5f5", "#ffca28", "#ec407a", "#ab47bc"];

  for (let i = 0; i < 56; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${originX}px`;
    piece.style.top = `${originY}px`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];

    // Gravity-style arc: shoots up to a peak, then falls back down past the origin.
    // Spread is scaled to the box's own size so it covers it proportionally.
    const dx = (Math.random() - 0.5) * rect.width * 0.9;
    const peakY = -(rect.height * 0.12 + Math.random() * rect.height * 0.22);
    const dy = rect.height * 0.22 + Math.random() * rect.height * 0.3;
    piece.style.setProperty("--dx", `${dx}px`);
    piece.style.setProperty("--peakY", `${peakY}px`);
    piece.style.setProperty("--dy", `${dy}px`);
    piece.style.animationDelay = `${Math.random() * 120}ms`;

    document.body.appendChild(piece);
    piece.addEventListener("animationend", () => piece.remove());
  }
}

// Shows the new stage's artwork centered on screen with a bounce-in, holds
// it briefly, then fades it away — used when the Shiba levels up.
function showLevelUpReveal(stage) {
  const overlay = document.getElementById("level-up-overlay");
  document.getElementById("level-up-image").src = stage.image;
  document.getElementById("level-up-label").textContent = stage.label;

  overlay.classList.remove("hidden", "fading");
  void overlay.offsetWidth; // force reflow so the bounce-in animation restarts each time
  overlay.classList.add("visible");

  setTimeout(() => {
    overlay.classList.add("fading");
    setTimeout(() => {
      overlay.classList.remove("visible", "fading");
      overlay.classList.add("hidden");
    }, 650);
  }, 2200);
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

// Short synthesized "wrong answer" buzz — generated with the Web Audio API
// so no audio file is needed. Reuses one AudioContext across calls.
let audioCtx = null;
function playBuzzer(onDone) {
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxClass) {
    if (onDone) onDone();
    return;
  }
  if (!audioCtx) audioCtx = new AudioCtxClass();
  // iOS Safari (and some other mobile browsers) create AudioContext in a
  // "suspended" state and need an explicit resume() inside a user-gesture
  // handler before any sound will actually play — unlike speechSynthesis,
  // which unlocks itself automatically, so this was silent on mobile.
  if (audioCtx.state === "suspended") audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  // Square wave reads as a duller, more "error tone" buzz than sawtooth's
  // raspier harmonics, and a low, near-steady pitch avoids the fast-slide
  // glide that made earlier versions sound like a raspberry.
  osc.type = "square";
  osc.frequency.setValueAtTime(100, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(85, audioCtx.currentTime + 0.4);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime + 0.28);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.42);
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (onDone) {
    let done = false;
    const finish = () => { if (!done) { done = true; onDone(); } };
    osc.onended = finish;
    setTimeout(finish, 650); // safety net in case onended doesn't fire
  }
  osc.start();
  osc.stop(audioCtx.currentTime + 0.42);
}

function renderTopNav() {
  const stage = stageForCompletedCount(state.completedDays.length);
  document.getElementById("home-shiba-emoji").src = stage.image;
  document.getElementById("home-shiba-name").textContent = state.shibaName || "";
  document.getElementById("streak-count").textContent = `${state.streak} day streak`;

  // No point offering a reset until there's actually progress to reset —
  // appears once Day 1's quiz has been completed.
  document.getElementById("btn-start-over").classList.toggle("hidden", state.completedDays.length === 0);
}

function renderNameSection() {
  const editRow = document.getElementById("name-edit-row");

  const shibaLabel = state.shibaName || "Shiba";
  const titleText = `${shibaLabel}'s 30 Day Japanese Lesson`;
  document.getElementById("page-title").textContent = titleText;
  document.title = titleText;
  document.getElementById("btn-to-dashboard").textContent = `Back to ${shibaLabel}`;

  if (state.shibaName) {
    editRow.classList.add("hidden");
  } else {
    // No name yet — prompt for one right away instead of leaving it blank.
    editRow.classList.remove("hidden");
  }
}

function renderDashboard() {
  const stage = stageForCompletedCount(state.completedDays.length);
  document.getElementById("shiba-stage").src = stage.image;
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
    // Listen on the whole card (clicking the speaker icon still works too,
    // since that click bubbles up to this same handler).
    card.addEventListener("click", () => {
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

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startQuiz(dayData) {
  // Reshuffle question order and each question's answer choices every time,
  // so first-time play and every repeat/practice session feel fresh.
  const shuffledQuiz = shuffleArray(dayData.quiz).map((q) => ({
    ...q,
    choices: shuffleArray(q.choices),
  }));
  quiz = { dayData: { ...dayData, quiz: shuffledQuiz }, index: 0, score: 0, results: [] };
  renderQuizQuestion();
  showView("view-quiz");
}

function renderQuizQuestion() {
  const q = quiz.dayData.quiz[quiz.index];
  document.getElementById("quiz-progress").textContent =
    `Question ${quiz.index + 1} of ${quiz.dayData.quiz.length}`;
  document.getElementById("quiz-question").innerHTML = boldQuoted(q.question);

  const choicesEl = document.getElementById("quiz-choices");
  choicesEl.innerHTML = "";
  q.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice;
    btn.addEventListener("click", () => selectAnswer(btn, choice, q.answer, q.question));
    choicesEl.appendChild(btn);
  });
}

const QUIZ_BEAT_MS = 400; // short pause after feedback (and any audio) before advancing

// "How do you say X?" questions have Japanese romaji as the choices, so the
// clicked choice itself maps to a word. "What does 'Y' mean?" questions have
// English choices instead — for those, the word being tested is quoted in
// the question text itself, so pull it from there.
function jpForAnswer(choice, questionText) {
  if (ROMAJI_TO_JP[choice]) return ROMAJI_TO_JP[choice];
  const match = questionText.match(/'([^']+)'/);
  if (match && ROMAJI_TO_JP[match[1]]) return ROMAJI_TO_JP[match[1]];
  return null;
}

function selectAnswer(btn, choice, answer, questionText) {
  const choicesEl = document.getElementById("quiz-choices");
  // Lock the question the instant an answer is picked, so a fast second click
  // can't register before the next question loads.
  choicesEl.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = true));

  const isCorrect = choice === answer;
  btn.classList.add(isCorrect ? "correct" : "incorrect");
  if (isCorrect) quiz.score++;
  quiz.results.push({ question: questionText, userAnswer: choice, correctAnswer: answer, isCorrect });

  const advance = () => {
    setTimeout(() => {
      quiz.index++;
      if (quiz.index < quiz.dayData.quiz.length) {
        fadeSwapContent(document.getElementById("quiz-content"), renderQuizQuestion);
      } else {
        finishQuiz();
      }
    }, QUIZ_BEAT_MS);
  };

  if (isCorrect) {
    const jp = jpForAnswer(choice, questionText);
    if (jp) {
      speak(jp, advance); // wait for the actual pronunciation to finish, then beat, then advance
    } else {
      advance();
    }
  } else {
    playBuzzer(advance); // wrong answer — buzz instead of pronouncing the word
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
  const leveledUp = stageAfter.label !== stageBefore.label;
  const shibaLabel = state.shibaName || "Shiba";
  document.getElementById("results-growth").innerHTML = leveledUp
    ? `${shibaLabel} grew into a ${stageAfter.label}! <img src="${stageAfter.image}" class="inline-shiba-icon" alt="${stageAfter.label}">`
    : `Keep going — ${shibaLabel} is getting closer to its next stage!`;

  if (leveledUp) {
    celebrateConfetti();
    showLevelUpReveal(stageAfter);
  }

  renderResultsReview(quiz.results);
  document.getElementById("btn-repeat-lesson").innerHTML =
    `<span class="btn-icon">↻</span> Repeat Day ${day}'s Lesson`;

  nextLessonDayData = CURRICULUM.find((d) => d.day === state.currentDay);
  const nextBtn = document.getElementById("btn-next-lesson");
  if (nextLessonDayData) {
    nextBtn.innerHTML =
      `Continue to Day ${nextLessonDayData.day}'s Lesson <span class="btn-icon">▶</span>`;
    nextBtn.classList.remove("hidden");
  } else {
    nextBtn.classList.add("hidden");
  }

  renderTopNav();
  showView("view-results");
}

// Bolds the key term in a review question — either the word in single-quotes
// ("How do you say 'hello'?") or a bare number ("How do you say the number 6?").
function boldQuoted(text) {
  // Greedy match spans to the LAST quote in the string, not the first —
  // otherwise a phrase with its own apostrophe (e.g. 'I'm sorry') would
  // close early at that internal apostrophe and only bold "I".
  return text
    .replace(/'(.+)'/, "'<strong>$1</strong>'")
    .replace(/\b(\d+)\b/, "<strong>$1</strong>");
}

function renderResultsReview(results) {
  const container = document.getElementById("results-review");
  container.innerHTML = "";

  const addAnswerRow = (item, label, text, cls, jp) => {
    const row = document.createElement("div");
    row.className = `review-answer-row ${cls}`;
    row.innerHTML = `
      <span class="review-answer-text">${label} ${text}</span>
      <button class="review-speak-btn" aria-label="Play pronunciation">🔊</button>
    `;
    if (jp) {
      row.addEventListener("click", () => {
        const speakBtn = row.querySelector(".review-speak-btn");
        speakBtn.classList.add("playing");
        speak(jp, () => speakBtn.classList.remove("playing"));
      });
    } else {
      row.querySelector(".review-speak-btn").classList.add("hidden");
      row.style.cursor = "default";
    }
    item.appendChild(row);
  };

  results.forEach((r) => {
    const item = document.createElement("div");
    item.className = "review-item";

    const questionEl = document.createElement("p");
    questionEl.className = "review-question";
    questionEl.innerHTML = boldQuoted(r.question);
    item.appendChild(questionEl);

    if (r.isCorrect) {
      addAnswerRow(item, "✓", r.correctAnswer, "correct", jpForAnswer(r.correctAnswer, r.question));
    } else {
      // The wrong row only gets a sound if it's genuinely its own distinct
      // Japanese word (a "How do you say X?" choice) — not a fallback to the
      // question's target word, which would make it play the same audio as
      // the correct answer (e.g. on "What does 'X' mean?" questions, where
      // wrong choices are just English meanings with no Japanese of their own).
      addAnswerRow(item, "✗ Your answer:", r.userAnswer, "incorrect", ROMAJI_TO_JP[r.userAnswer] || null);
      addAnswerRow(item, "✓", r.correctAnswer, "correct", jpForAnswer(r.correctAnswer, r.question));
    }

    container.appendChild(item);
  });
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
  celebrateConfetti();

  if (pendingRevealEls.length) {
    pendingRevealEls.forEach((el) => el.classList.remove("reveal-hidden"));
    pendingRevealEls = [];
  }
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

document.getElementById("btn-start-over").addEventListener("click", (e) => {
  e.preventDefault();
  const sure = confirm("This will erase all progress (streak, points, and your Shiba's name) and start over from the welcome screen. Are you sure?");
  if (!sure) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

renderDashboard();
renderTopNav();
showView("view-dashboard");

if (isNewUser) {
  runWelcomeSequence();
}
