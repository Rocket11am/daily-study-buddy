const STORAGE_KEY = "goal-glow-demo-state";

const defaultState = {
  streak: 6,
  goals: [
    {
      id: crypto.randomUUID(),
      title: "90 天提升英语表达",
      why: "让我在工作和学习上都更有表达底气，也能更从容地面对面试和交流。",
      category: "学习",
      deadline: offsetDate(60),
      milestone: "本阶段先完成 21 次口语练习",
      task: "今天跟读 20 分钟并录音 1 次",
      progress: 68,
      completedToday: false,
      archived: false
    },
    {
      id: crypto.randomUUID(),
      title: "6 个月减重 8kg",
      why: "恢复体能和精神状态，让自己更轻盈，也提升日常自信。",
      category: "健康",
      deadline: offsetDate(120),
      milestone: "本阶段稳定每周运动 4 次",
      task: "今晚快走 40 分钟并记录饮食",
      progress: 42,
      completedToday: true,
      archived: false
    }
  ],
  achievements: [
    {
      id: crypto.randomUUID(),
      type: "连续推进",
      title: "连续 6 天没有放弃",
      note: "稳定比爆发更难得，你正在建立自己的节奏。"
    },
    {
      id: crypto.randomUUID(),
      type: "阶段达成",
      title: "第一次累计完成 10 次行动",
      note: "你已经从想法走进了行动。"
    }
  ],
  records: [
    {
      id: crypto.randomUUID(),
      goalId: "",
      goalTitle: "6 个月减重 8kg",
      action: "完成晚间快走 40 分钟",
      feeling: "很踏实",
      time: recentTime(2)
    },
    {
      id: crypto.randomUUID(),
      goalId: "",
      goalTitle: "90 天提升英语表达",
      action: "完成跟读 20 分钟",
      feeling: "比昨天更顺",
      time: recentTime(28)
    }
  ],
  archive: [
    {
      id: crypto.randomUUID(),
      title: "完成 30 天早睡计划",
      note: "累计坚持 30 天，晚睡焦虑显著减少。",
      completedAt: recentDate(14)
    }
  ],
  weekActivity: [1, 2, 1, 3, 2, 0, 2]
};

const state = loadState();

const refs = {
  form: document.getElementById("goal-form"),
  goalsList: document.getElementById("goals-list"),
  recordsList: document.getElementById("records-list"),
  achievementList: document.getElementById("achievement-list"),
  archiveList: document.getElementById("archive-list"),
  spotlightCard: document.getElementById("spotlight-card"),
  weeklyGrid: document.getElementById("weekly-grid"),
  celebration: document.getElementById("celebration"),
  activeGoalsCount: document.getElementById("active-goals-count"),
  completedTasksCount: document.getElementById("completed-tasks-count"),
  streakCount: document.getElementById("streak-count"),
  heroGreeting: document.getElementById("hero-greeting"),
  heroSummary: document.getElementById("hero-summary"),
  goalTemplate: document.getElementById("goal-card-template")
};

refs.form.deadline.value = offsetDate(30);

refs.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(refs.form);
  const title = String(formData.get("title")).trim();
  const milestone = String(formData.get("milestone")).trim();
  const task = String(formData.get("task")).trim();

  if (!title || !task) {
    return;
  }

  state.goals.unshift({
    id: crypto.randomUUID(),
    title,
    why: String(formData.get("why")).trim() || "这是一个值得被认真完成的目标。",
    category: String(formData.get("category")).trim(),
    deadline: String(formData.get("deadline")),
    milestone: milestone || "先完成第一阶段推进",
    task,
    progress: 8,
    completedToday: false,
    archived: false
  });

  state.achievements.unshift({
    id: crypto.randomUUID(),
    type: "新目标启动",
    title: `已点亮目标：${title}`,
    note: "当一个目标被写下来并拆成今天的行动，它就开始真正发生了。"
  });

  state.weekActivity[6] = Math.min(3, state.weekActivity[6] + 1);
  persistAndRender();
  refs.form.reset();
  refs.form.deadline.value = offsetDate(30);
  celebrate(`新目标已创建：${title}`);
});

refs.goalsList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  const card = event.target.closest(".goal-card");
  const goalId = card?.dataset.goalId;
  const goal = state.goals.find((item) => item.id === goalId);

  if (!goal) {
    return;
  }

  const action = button.dataset.action;
  if (action === "complete") {
    completeTask(goal);
  }
  if (action === "archive") {
    archiveGoal(goal);
  }
});

refs.spotlightCard.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  const goalId = button.dataset.goalId;
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) {
    return;
  }

  if (button.dataset.action === "complete") {
    completeTask(goal);
  }
  if (button.dataset.action === "archive") {
    archiveGoal(goal);
  }
});

render();

function completeTask(goal) {
  const previousProgress = goal.progress;
  goal.progress = Math.min(100, goal.progress + 12);
  goal.completedToday = true;
  state.streak += 1;
  rotateWeekActivity();
  state.weekActivity[6] = Math.min(3, state.weekActivity[6] + 1);

  state.records.unshift({
    id: crypto.randomUUID(),
    goalId: goal.id,
    goalTitle: goal.title,
    action: goal.task,
    feeling: getFeeling(goal.progress),
    time: new Date().toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  });

  if (previousProgress < 50 && goal.progress >= 50) {
    unlockAchievement("半程突破", `${goal.title} 已推进过半`, "你已经不是在尝试，而是在稳定前进。");
  }

  if (goal.progress === 100) {
    unlockAchievement("长期达成", `${goal.title} 已完成`, "阶段终点已经点亮，记得把这个目标收入你的成就档案。");
  }

  persistAndRender();
  celebrate(`${goal.title} 已推进，进度来到 ${goal.progress}%`);
}

function archiveGoal(goal) {
  goal.archived = true;
  goal.progress = 100;
  state.archive.unshift({
    id: crypto.randomUUID(),
    title: goal.title,
    note: `${goal.milestone}。你把一个抽象愿望，做成了可回顾的成果。`,
    completedAt: new Date().toLocaleDateString("zh-CN")
  });
  unlockAchievement("目标归档", `${goal.title} 收入成就档案`, "完成不只是结束，也是你下一次出发时的底气。");
  persistAndRender();
  celebrate(`目标达成：${goal.title}`);
}

function unlockAchievement(type, title, note) {
  const exists = state.achievements.some((item) => item.title === title);
  if (exists) {
    return;
  }
  state.achievements.unshift({
    id: crypto.randomUUID(),
    type,
    title,
    note
  });
}

function render() {
  renderHeader();
  renderGoals();
  renderSpotlight();
  renderRecords();
  renderAchievements();
  renderArchive();
  renderWeekActivity();
}

function renderHeader() {
  const activeGoals = state.goals.filter((goal) => !goal.archived);
  refs.activeGoalsCount.textContent = String(activeGoals.length);
  refs.completedTasksCount.textContent = String(state.records.length);
  refs.streakCount.textContent = String(state.streak);

  if (activeGoals.length === 0) {
    refs.heroGreeting.textContent = "先点亮一个目标，今天就有新的起点";
    refs.heroSummary.textContent = "把想完成的事写下来，再拆成最小行动，成就感会从第一步开始。";
    return;
  }

  const topGoal = activeGoals.sort((a, b) => b.progress - a.progress)[0];
  refs.heroGreeting.textContent = `你最接近达成的是「${topGoal.title}」`;
  refs.heroSummary.textContent = `当前进度 ${topGoal.progress}% ，继续保持今天这一下，就会更接近阶段节点。`;
}

function renderGoals() {
  const activeGoals = state.goals.filter((goal) => !goal.archived);
  refs.goalsList.innerHTML = "";

  if (activeGoals.length === 0) {
    refs.goalsList.innerHTML = `<div class="empty-state">还没有进行中的目标。左侧创建一个目标后，系统会自动帮你把它放进今天的推进节奏里。</div>`;
    return;
  }

  activeGoals.forEach((goal) => {
    const node = refs.goalTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.goalId = goal.id;
    node.querySelector(".goal-category").textContent = goal.category;
    node.querySelector(".goal-title").textContent = goal.title;
    node.querySelector(".goal-why").textContent = goal.why;
    node.querySelector(".goal-deadline").textContent = `截止：${formatDate(goal.deadline)}`;
    node.querySelector(".goal-milestone").textContent = `阶段：${goal.milestone}`;
    node.querySelector(".progress-fill").style.width = `${goal.progress}%`;
    node.querySelector(".goal-progress-text").textContent = goal.completedToday
      ? `今天已推进，当前 ${goal.progress}%`
      : `今天还可以再向前一步，当前 ${goal.progress}%`;
    refs.goalsList.appendChild(node);
  });
}

function renderSpotlight() {
  const activeGoals = state.goals.filter((goal) => !goal.archived);

  if (activeGoals.length === 0) {
    refs.spotlightCard.innerHTML = `
      <div class="empty-state">
        你还没有激活今日推进卡。创建一个目标后，这里会自动显示今天最值得完成的一步。
      </div>
    `;
    return;
  }

  const spotlight = [...activeGoals].sort((a, b) => {
    if (a.completedToday !== b.completedToday) {
      return Number(a.completedToday) - Number(b.completedToday);
    }
    return b.progress - a.progress;
  })[0];

  refs.spotlightCard.innerHTML = `
    <div class="spotlight-main">
      <p class="eyebrow">Today's Focus</p>
      <h3>${spotlight.title}</h3>
      <p class="muted">${spotlight.why}</p>
      <div class="spotlight-chip-row">
        <span class="chip">阶段：${spotlight.milestone}</span>
        <span class="chip">今日行动：${spotlight.task}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${spotlight.progress}%"></div>
      </div>
      <p class="muted">${spotlight.completedToday ? "今天这一步已经完成，继续保持这个节奏。" : "完成这个最小行动，你今天的目标感就会被点亮。"}</p>
    </div>
    <div class="spotlight-actions">
      <button class="secondary-btn" data-action="complete" data-goal-id="${spotlight.id}">完成这一步</button>
      <button class="ghost-btn" data-action="archive" data-goal-id="${spotlight.id}">标记长期达成</button>
    </div>
  `;
}

function renderRecords() {
  refs.recordsList.innerHTML = "";
  if (state.records.length === 0) {
    refs.recordsList.innerHTML = `<div class="empty-state">完成记录会沉淀在这里。哪怕只是很小的一步，也会成为你未来回看时的底气。</div>`;
    return;
  }

  state.records.slice(0, 6).forEach((record) => {
    const card = document.createElement("article");
    card.className = "record-card";
    card.innerHTML = `
      <div class="record-top">
        <span class="record-tag">${record.goalTitle}</span>
        <time>${record.time}</time>
      </div>
      <p>${record.action}</p>
      <p class="record-note">当时感受：${record.feeling}</p>
    `;
    refs.recordsList.appendChild(card);
  });
}

function renderAchievements() {
  refs.achievementList.innerHTML = "";
  state.achievements.slice(0, 5).forEach((achievement) => {
    const card = document.createElement("article");
    card.className = "achievement-card";
    card.innerHTML = `
      <span class="achievement-badge">${achievement.type}</span>
      <h3>${achievement.title}</h3>
      <p class="muted">${achievement.note}</p>
    `;
    refs.achievementList.appendChild(card);
  });
}

function renderArchive() {
  refs.archiveList.innerHTML = "";
  if (state.archive.length === 0) {
    refs.archiveList.innerHTML = `<div class="empty-state">当你完成第一个长期目标，这里会留下你的成就档案。</div>`;
    return;
  }

  state.archive.slice(0, 4).forEach((entry) => {
    const card = document.createElement("article");
    card.className = "archive-card";
    card.innerHTML = `
      <div class="archive-top">
        <h3>${entry.title}</h3>
        <time>${entry.completedAt}</time>
      </div>
      <p class="archive-note">${entry.note}</p>
    `;
    refs.archiveList.appendChild(card);
  });
}

function renderWeekActivity() {
  refs.weeklyGrid.innerHTML = "";
  state.weekActivity.forEach((value, index) => {
    const tile = document.createElement("div");
    tile.className = `heat heat-${value}`;
    tile.title = `本周第 ${index + 1} 天：活跃度 ${value}`;
    refs.weeklyGrid.appendChild(tile);
  });
}

function celebrate(message) {
  refs.celebration.textContent = message;
  refs.celebration.classList.add("show");
  clearTimeout(celebrate.timer);
  celebrate.timer = setTimeout(() => {
    refs.celebration.classList.remove("show");
  }, 2600);
}

function persistAndRender() {
  saveState(state);
  render();
}

function rotateWeekActivity() {
  if (state.weekActivity.length < 7) {
    return;
  }
  state.weekActivity = [...state.weekActivity.slice(1), state.weekActivity[6]];
}

function getFeeling(progress) {
  if (progress >= 100) {
    return "真的有完成感";
  }
  if (progress >= 70) {
    return "越来越稳了";
  }
  if (progress >= 40) {
    return "开始看到变化";
  }
  return "先动起来就很好";
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState(nextState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function formatDate(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleDateString("zh-CN");
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function recentDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString("zh-CN");
}

function recentTime(hoursAgo) {
  const date = new Date();
  date.setHours(date.getHours() - hoursAgo);
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
