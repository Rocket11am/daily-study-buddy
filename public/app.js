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

const LAST_EMAIL_KEY = "daily-study-buddy:last-email";

let currentState = null;
let selectedHistoryId = null;

Object.entries(refs.navButtons).forEach(([view, button]) => {
  button.addEventListener("click", () => {
    if (view !== "settings" && !ensureEmail()) return;
    switchView(view);
  });
});

refs.choiceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.target);
    if (!target) return;
    target.value = button.dataset.value;
    syncChoiceButtons();
  });
});

refs.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    currentState = await fetchJson("/api/profile", {
      method: "POST",
      body: JSON.stringify(getProfilePayload())
    });
    rememberEmail(refs.email.value.trim());
    selectedHistoryId = currentState.history?.[0]?.id || null;
    render();
    switchView("dashboard");
    showFlash("设置已保存。");
  } catch (error) {
    console.error(error);
  }
});

refs.sendMorning.addEventListener("click", async () => {
  if (!ensureEmail()) return;
  refs.sendMorning.disabled = true;
  try {
    const response = await fetchJson("/api/send/morning", {
      method: "POST",
      body: JSON.stringify({ email: refs.email.value.trim() })
    });
    rememberEmail(refs.email.value.trim());
    currentState = response.state;
    selectedHistoryId = currentState.history?.[0]?.id || null;
    render();
    showFlash(response.message || "早晨学习已发送。");
    switchView("dashboard");
  } catch (error) {
    console.error(error);
  } finally {
    refs.sendMorning.disabled = false;
  }
});

refs.sendEvening.addEventListener("click", async () => {
  if (!ensureEmail()) return;
  refs.sendEvening.disabled = true;
  try {
    const response = await fetchJson("/api/send/evening", {
      method: "POST",
      body: JSON.stringify({ email: refs.email.value.trim() })
    });
    rememberEmail(refs.email.value.trim());
    currentState = response.state;
    selectedHistoryId = currentState.history?.[0]?.id || null;
    render();
    showFlash(response.message || "晚间测验已发送。");
    switchView("quiz");
  } catch (error) {
    console.error(error);
  } finally {
    refs.sendEvening.disabled = false;
  }
});

refs.quizForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentState?.activeSession?.quiz) {
    showFlash("当前没有可提交的测验。");
    return;
  }

  const answers = currentState.activeSession.quiz.questions.map((_, index) => {
    const checked = refs.quizForm.querySelector(`input[name="question-${index}"]:checked`);
    return checked ? checked.value : "";
  });

  try {
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
    showFlash(response.message || "测验已提交。");
  } catch (error) {
    console.error(error);
  }
});

refs.email.addEventListener("change", () => {
  const email = refs.email.value.trim();
  if (!email) return;
  loadState(email);
});

initialize();

async function initialize() {
  syncChoiceButtons();
  const emailFromQuery = new URLSearchParams(window.location.search).get("email");
  const rememberedEmail = loadRememberedEmail();
  const email = emailFromQuery || rememberedEmail;

  if (email) {
    refs.email.value = email;
    await loadState(email);
    return;
  }

  render();
  switchView("settings");
}

function switchView(view) {
  Object.entries(refs.views).forEach(([key, element]) => {
    element.classList.toggle("view-active", key === view);
  });
  Object.entries(refs.navButtons).forEach(([key, button]) => {
    button.classList.toggle("nav-btn-active", key === view);
  });
}

function ensureEmail() {
  const email = refs.email.value.trim();
  if (email) return true;
  showFlash("请先输入邮箱并保存设置。");
  switchView("settings");
  refs.email.focus();
  return false;
}

function getProfilePayload() {
  return {
    email: refs.email.value.trim(),
    lessonCount: Number(refs.lessonCount.value || 2),
    contentType: refs.contentType.value || "spoken",
    morningTime: refs.morningTime.value || "09:00",
    eveningTime: refs.eveningTime.value || "18:00"
  };
}

async function loadState(email) {
  try {
    currentState = await fetchJson(`/api/state?email=${encodeURIComponent(email)}`);
    rememberEmail(email);
    selectedHistoryId = currentState.history?.[0]?.id || null;
    render();
    switchView(currentState.profile ? "dashboard" : "settings");
  } catch (error) {
    console.error(error);
    currentState = null;
    render();
    switchView("settings");
  }
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
  refs.email.value = currentState.profile.email || "";
  refs.lessonCount.value = String(currentState.profile.lessonCount || 2);
  refs.contentType.value = currentState.profile.contentType || "spoken";
  refs.morningTime.value = currentState.profile.morningTime || "09:00";
  refs.eveningTime.value = currentState.profile.eveningTime || "18:00";
}

function syncChoiceButtons() {
  refs.choiceButtons.forEach((button) => {
    const target = document.getElementById(button.dataset.target);
    if (!target) return;
    button.classList.toggle("choice-btn-active", target.value === button.dataset.value);
  });
}

function renderAccountSummary() {
  if (!currentState?.profile) {
    refs.accountSummary.innerHTML = '<div class="card muted">先在设置里填写邮箱和学习偏好，保存后再开始体验。</div>';
    return;
  }

  refs.accountSummary.innerHTML = `
    <div class="card compact-card">
      <strong>${escapeHtml(currentState.profile.email)}</strong>
      <p class="muted">每日学习：${currentState.profile.lessonCount} 条</p>
      <p class="muted">学习方向：${labelForType(currentState.profile.contentType)}</p>
      <p class="muted">自动发送：${escapeHtml(currentState.profile.morningTime)} / ${escapeHtml(currentState.profile.eveningTime)}</p>
    </div>
  `;
}

function renderLatestSummary() {
  const session = currentState?.activeSession;
  if (!session) {
    refs.latestSummary.innerHTML = '<div class="card muted">发送一组学习内容后，这里会显示最近一次学习摘要。</div>';
    return;
  }

  refs.latestSummary.innerHTML = `
    <div class="card compact-card">
      <strong>${session.mode === "auto" ? "自动发送" : "手动发送"} · ${labelForType(session.contentType)}</strong>
      <p class="muted">时间：${formatDateTime(session.createdAt)}</p>
      <p class="muted">内容数：${session.items?.length || 0} 条</p>
      <p class="muted">测验状态：${quizStatusText(session)}</p>
    </div>
  `;
}

function renderQuiz() {
  refs.quizForm.innerHTML = "";
  const session = currentState?.activeSession;

  if (!session?.quiz?.questions?.length) {
    refs.quizForm.innerHTML = '<div class="card muted">发送晚间测验后，这里会显示当前题目。</div>';
    return;
  }

  session.quiz.questions.forEach((question, index) => {
    const reviewed = session.quizResult?.answers?.[index];
    const card = document.createElement("div");
    card.className = "quiz-card";

    const options = question.options.map((option, optionIndex) => {
      const checked = reviewed?.answer === option ? "checked" : "";
      return `
        <label class="option-item">
          <input type="radio" name="question-${index}" value="${escapeHtml(option)}" ${checked}>
          <span>${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</span>
        </label>
      `;
    }).join("");

    card.innerHTML = `
      <strong>${index + 1}. ${escapeHtml(question.prompt)}</strong>
      <div class="option-list">${options}</div>
      ${reviewed ? `<p class="meta-line">${reviewed.isCorrect ? "回答正确" : `正确答案：${escapeHtml(reviewed.correctAnswer)}`}</p>` : ""}
    `;

    refs.quizForm.appendChild(card);
  });

  const action = document.createElement("div");
  action.className = "submit-row";
  action.innerHTML = `<button class="primary-btn" type="submit">${session.quizResult ? "重新提交答案" : "提交当前测验"}</button>`;
  refs.quizForm.appendChild(action);

  if (session.quizResult) {
    const summary = document.createElement("div");
    summary.className = "card compact-card";
    summary.innerHTML = `
      <strong>本次成绩：${session.quizResult.score}/${session.quizResult.total}</strong>
      <p class="muted">正确率：${session.quizResult.accuracy}%</p>
      <p class="muted">提交时间：${formatDateTime(session.quizResult.submittedAt)}</p>
    `;
    refs.quizForm.appendChild(summary);
  }
}

function renderHistory() {
  refs.historyList.innerHTML = "";
  const history = currentState?.history || [];

  if (!history.length) {
    refs.historyList.innerHTML = '<div class="card muted">这里先展示记录摘要，点击某一条后，右侧再查看详细内容。</div>';
    return;
  }

  history.forEach((session) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `history-item ${session.id === selectedHistoryId ? "history-item-active" : ""}`;
    item.innerHTML = `
      <strong>${session.mode === "auto" ? "自动" : "手动"} · ${labelForType(session.contentType)}</strong>
      <span>${formatDateTime(session.createdAt)}</span>
      <span>${quizStatusText(session)}</span>
    `;
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
    refs.historyDetail.innerHTML = '<div class="card muted">还没有历史记录可查看。</div>';
    return;
  }

  const items = (session.items || []).map((item, index) => `
    <div class="detail-line">
      <strong>${index + 1}. ${escapeHtml(item.english)}</strong>
      <span>${escapeHtml(item.chinese)}</span>
      <span>${escapeHtml(item.scene)}</span>
    </div>
  `).join("");

  refs.historyDetail.innerHTML = `
    <div class="card detail-card">
      <div class="tag-row">
        <span class="tag">${escapeHtml(session.date || "")}</span>
        <span class="tag success">${session.mode === "auto" ? "自动发送" : "手动发送"}</span>
        <span class="tag">${labelForType(session.contentType)}</span>
      </div>
      <p class="meta-line">${formatDateTime(session.createdAt)}</p>
      <div class="detail-stack">${items}</div>
      <p class="meta-line">测验状态：${quizStatusText(session)}</p>
    </div>
  `;
}

function quizStatusText(session) {
  if (session?.quizResult) return `测验正确率 ${session.quizResult.accuracy}%`;
  if (session?.quizSentAt) return "测验已发送，待作答";
  return "尚未发送测验";
}

function showFlash(message) {
  refs.flashMessage.textContent = message;
  refs.flashMessage.classList.remove("hidden");
  clearTimeout(showFlash.timer);
  showFlash.timer = setTimeout(() => refs.flashMessage.classList.add("hidden"), 2800);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const message = data.message || data.error || `请求失败：${response.status}`;
    showFlash(message);
    throw new Error(message);
  }

  return data;
}

function rememberEmail(email) {
  if (!email) return;
  window.localStorage.setItem(LAST_EMAIL_KEY, email);
}

function loadRememberedEmail() {
  return window.localStorage.getItem(LAST_EMAIL_KEY) || "";
}

function formatDateTime(value) {
  if (!value) return "未发送";
  return new Date(value).toLocaleString("zh-CN");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
