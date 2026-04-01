const refs = {
  profileForm: document.getElementById("profile-form"),
  email: document.getElementById("email"),
  lessonCount: document.getElementById("lesson-count"),
  contentType: document.getElementById("content-type"),
  morningTime: document.getElementById("morning-time"),
  eveningTime: document.getElementById("evening-time"),
  sendMorning: document.getElementById("send-morning"),
  sendEvening: document.getElementById("send-evening"),
  quizForm: document.getElementById("quiz-form"),
  flashMessage: document.getElementById("flash-message"),
  statSessions: document.getElementById("stat-sessions"),
  statQuizzes: document.getElementById("stat-quizzes"),
  statStreak: document.getElementById("stat-streak"),
  statAccuracy: document.getElementById("stat-accuracy"),
  accountSummary: document.getElementById("account-summary"),
  latestSummary: document.getElementById("latest-summary"),
  historyList: document.getElementById("history-list"),
  historyDetail: document.getElementById("history-detail"),
  navButtons: {
    dashboard: document.getElementById("nav-dashboard"),
    send: document.getElementById("nav-send"),
    quiz: document.getElementById("nav-quiz"),
    history: document.getElementById("nav-history"),
    settings: document.getElementById("nav-settings")
  },
  views: {
    dashboard: document.getElementById("view-dashboard"),
    send: document.getElementById("view-send"),
    quiz: document.getElementById("view-quiz"),
    history: document.getElementById("view-history"),
    settings: document.getElementById("view-settings")
  },
  choiceButtons: Array.from(document.querySelectorAll(".choice-btn"))
};

let currentState = null;
let currentView = "settings";
let selectedHistoryId = null;

Object.entries(refs.navButtons).forEach(([view, button]) => {
  button.addEventListener("click", () => {
    if (view !== "settings" && !ensureEmail()) return;
    switchView(view);
  });
});

refs.choiceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.target;
    const value = button.dataset.value;
    document.getElementById(target).value = value;
    syncChoiceButtons();
  });
});

refs.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  currentState = await fetchJson("/api/profile", {
    method: "POST",
    body: JSON.stringify(getProfilePayload())
  });
  selectedHistoryId = currentState.history[0]?.id || null;
  render();
  switchView("dashboard");
  showFlash("设置已保存。");
});

refs.sendMorning.addEventListener("click", async () => {
  if (!ensureEmail()) return;
  const response = await fetchJson("/api/send/morning", {
    method: "POST",
    body: JSON.stringify({ email: refs.email.value.trim() })
  });
  currentState = response.state;
  selectedHistoryId = currentState.history[0]?.id || null;
  render();
  showFlash(response.message);
  switchView("dashboard");
});

refs.sendEvening.addEventListener("click", async () => {
  if (!ensureEmail()) return;
  const response = await fetchJson("/api/send/evening", {
    method: "POST",
    body: JSON.stringify({ email: refs.email.value.trim() })
  });
  currentState = response.state;
  selectedHistoryId = currentState.history[0]?.id || null;
  render();
  showFlash(response.message);
  switchView("quiz");
});

refs.quizForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentState?.activeSession?.quiz) return;
  const answers = currentState.activeSession.quiz.questions.map((_, index) => {
    const checked = refs.quizForm.querySelector(`input[name="question-${index}"]:checked`);
    return checked ? checked.value : "";
  });
  const response = await fetchJson("/api/quiz-submit", {
    method: "POST",
    body: JSON.stringify({
      email: refs.email.value.trim(),
      sessionId: currentState.activeSession.id,
      answers
    })
  });
  currentState = response.state;
  selectedHistoryId = currentState.activeSession?.id || selectedHistoryId;
  render();
  showFlash(response.message);
});

refs.email.addEventListener("change", () => loadState(refs.email.value.trim()));

const emailFromQuery = new URLSearchParams(window.location.search).get("email");
if (emailFromQuery) {
  refs.email.value = emailFromQuery;
  loadState(emailFromQuery);
}

function switchView(view) {
  currentView = view;
  Object.entries(refs.views).forEach(([key, element]) => {
    element.classList.toggle("view-active", key === view);
  });
  Object.entries(refs.navButtons).forEach(([key, button]) => {
    button.classList.toggle("nav-btn-active", key === view);
  });
}

function ensureEmail() {
  if (refs.email.value.trim()) return true;
  showFlash("请先输入邮箱。");
  switchView("settings");
  refs.email.focus();
  return false;
}

function getProfilePayload() {
  return {
    email: refs.email.value.trim(),
    lessonCount: Number(refs.lessonCount.value),
    contentType: refs.contentType.value,
    morningTime: refs.morningTime.value,
    eveningTime: refs.eveningTime.value
  };
}

async function loadState(email) {
  if (!email) {
    currentState = null;
    render();
    return;
  }
  currentState = await fetchJson(`/api/state?email=${encodeURIComponent(email)}`);
  selectedHistoryId = currentState.history[0]?.id || null;
  render();
  switchView(currentState.profile ? "dashboard" : "settings");
}

function render() {
  fillProfile();
  syncChoiceButtons();
  refs.statSessions.textContent = currentState?.stats?.totalSessions || 0;
  refs.statQuizzes.textContent = currentState?.stats?.quizzesCompleted || 0;
  refs.statStreak.textContent = currentState?.stats?.streak || 0;
  refs.statAccuracy.textContent = `${currentState?.stats?.accuracy || 0}%`;
  renderAccountSummary();
  renderLatestSummary();
  renderQuiz();
  renderHistory();
  renderHistoryDetail();
}

function fillProfile() {
  if (!currentState?.profile) return;
  refs.email.value = currentState.profile.email;
  refs.lessonCount.value = String(currentState.profile.lessonCount);
  refs.contentType.value = currentState.profile.contentType;
  refs.morningTime.value = currentState.profile.morningTime;
  refs.eveningTime.value = currentState.profile.eveningTime;
}

function syncChoiceButtons() {
  refs.choiceButtons.forEach((button) => {
    const target = button.dataset.target;
    button.classList.toggle("choice-btn-active", document.getElementById(target).value === button.dataset.value);
  });
}

function renderAccountSummary() {
  if (!currentState?.profile) {
    refs.accountSummary.innerHTML = `<div class="card muted">先在设置里填写邮箱和学习偏好，保存后再开始体验。</div>`;
    return;
  }
  refs.accountSummary.innerHTML = `<div class="card compact-card"><strong>${currentState.profile.email}</strong><p class="muted">学习频率：每天 ${currentState.profile.lessonCount} 条</p><p class="muted">内容方向：${labelForType(currentState.profile.contentType)}</p><p class="muted">自动发送：${currentState.profile.morningTime} / ${currentState.profile.eveningTime}</p></div>`;
}

function renderLatestSummary() {
  const session = currentState?.activeSession;
  if (!session) {
    refs.latestSummary.innerHTML = `<div class="card muted">发送一组学习内容后，这里会展示最近一次学习摘要。</div>`;
    return;
  }
  refs.latestSummary.innerHTML = `<div class="card compact-card"><strong>${session.mode === "auto" ? "自动发送" : "手动发送"} · ${labelForType(session.contentType)}</strong><p class="muted">时间：${formatDateTime(session.createdAt)}</p><p class="muted">内容数：${session.items.length} 条</p><p class="muted">测验状态：${session.quizResult ? `${session.quizResult.accuracy}%` : session.quizSentAt ? "待作答" : "未发送"}</p></div>`;
}

function renderQuiz() {
  refs.quizForm.innerHTML = "";
  const session = currentState?.activeSession;
  if (!session?.quiz) {
    refs.quizForm.innerHTML = `<div class="card muted">发送一组早晨学习内容后，再进入这里完成当前测验。</div>`;
    return;
  }
  session.quiz.questions.forEach((question, index) => {
    const reviewed = session.quizResult?.answers?.[index];
    const options = question.options.map((option, optionIndex) => {
      const checked = reviewed?.answer === option ? "checked" : "";
      return `<label class="option-item"><input type="radio" name="question-${index}" value="${escapeHtml(option)}" ${checked}><span>${String.fromCharCode(65 + optionIndex)}. ${option}</span></label>`;
    }).join("");
    const card = document.createElement("div");
    card.className = "quiz-card";
    card.innerHTML = `<strong>${index + 1}. ${question.prompt}</strong><div class="option-list">${options}</div>${reviewed ? `<p class="meta-line">${reviewed.isCorrect ? "答对了" : `正确答案：${reviewed.correctAnswer}`}</p>` : ""}`;
    refs.quizForm.appendChild(card);
  });
  const action = document.createElement("div");
  action.className = "submit-row";
  action.innerHTML = `<button class="primary-btn" type="submit">${session.quizResult ? "重新提交答案" : "提交当前测验"}</button>`;
  refs.quizForm.appendChild(action);
  if (session.quizResult) {
    const summary = document.createElement("div");
    summary.className = "card compact-card";
    summary.innerHTML = `<strong>本次成绩：${session.quizResult.score}/${session.quizResult.total}</strong><p class="muted">正确率：${session.quizResult.accuracy}%</p><p class="muted">提交时间：${formatDateTime(session.quizResult.submittedAt)}</p>`;
    refs.quizForm.appendChild(summary);
  }
}

function renderHistory() {
  refs.historyList.innerHTML = "";
  const history = currentState?.history || [];
  if (!history.length) {
    refs.historyList.innerHTML = `<div class="card muted">这里先展示记录摘要，点击某一条后，右侧再查看详细内容。</div>`;
    return;
  }
  history.forEach((session) => {
    const selected = session.id === selectedHistoryId ? "history-item-active" : "";
    const item = document.createElement("button");
    item.type = "button";
    item.className = `history-item ${selected}`;
    item.innerHTML = `<strong>${session.mode === "auto" ? "自动" : "手动"} · ${labelForType(session.contentType)}</strong><span>${formatDateTime(session.createdAt)}</span><span>测验：${session.quizResult ? `${session.quizResult.accuracy}%` : session.quizSentAt ? "待作答" : "未发送"}</span>`;
    item.addEventListener("click", () => {
      selectedHistoryId = session.id;
      renderHistory();
      renderHistoryDetail();
    });
    refs.historyList.appendChild(item);
  });
}

function renderHistoryDetail() {
  const history = currentState?.history || [];
  const session = history.find((item) => item.id === selectedHistoryId) || history[0];
  if (!session) {
    refs.historyDetail.innerHTML = `<div class="card muted">还没有历史记录可查看。</div>`;
    return;
  }
  const items = session.items.map((item, index) => `<div class="detail-line"><strong>${index + 1}. ${item.english}</strong><span>${item.chinese}</span><span>${item.scene}</span></div>`).join("");
  refs.historyDetail.innerHTML = `<div class="card detail-card"><div class="tag-row"><span class="tag">${session.date}</span><span class="tag success">${session.mode === "auto" ? "自动发送" : "手动发送"}</span><span class="tag">${labelForType(session.contentType)}</span></div><p class="meta-line">${formatDateTime(session.createdAt)}</p><div class="detail-stack">${items}</div><p class="meta-line">测验状态：${session.quizResult ? `${session.quizResult.accuracy}%` : session.quizSentAt ? "待作答" : "未发送"}</p></div>`;
}

function showFlash(message) {
  refs.flashMessage.textContent = message;
  refs.flashMessage.classList.remove("hidden");
  clearTimeout(showFlash.timer);
  showFlash.timer = setTimeout(() => refs.flashMessage.classList.add("hidden"), 2600);
}

async function fetchJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || data.error || `Request failed: ${response.status}`);
    }
    return data;
  } catch (error) {
    showFlash(error.message || "请求失败");
    throw error;
  }
}

function formatDateTime(value) {
  if (!value) return "未发送";
  return new Date(value).toLocaleString("zh-CN");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelForType(type) {
  return {
    spoken: "英语口语",
    vocabulary: "词汇积累",
    business: "商务英语",
    travel: "旅行英语",
    writing: "邮件写作",
    all: "混合模式"
  }[type] || "综合学习";
}
