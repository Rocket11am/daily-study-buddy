const http = require("http");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const net = require("net");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const CONTENT_PATH = path.join(DATA_DIR, "content.json");

ensureDir(DATA_DIR);
ensureFile(CONTENT_PATH, JSON.stringify(seedContent(), null, 2));
ensureFile(STORE_PATH, JSON.stringify(seedStore(), null, 2));

let store = loadJson(STORE_PATH, seedStore());
const contentPool = loadJson(CONTENT_PATH, seedContent());
let schedulerMinuteKey = "";

store.logs = Array.isArray(store.logs) ? store.logs : [];
store.users = store.users || {};
store.progress = store.progress || { nextContentIndex: 0 };
if (typeof store.progress.nextContentIndex !== "number") {
  store.progress.nextContentIndex = 0;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/answer") {
      handleEmailAnswer(res, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    respondJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Daily Study Buddy is running at http://localhost:${PORT}`);
  runSchedulerCheck();
  setInterval(runSchedulerCheck, 30 * 1000);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    respondJson(res, 200, buildClientState(url.searchParams.get("email")));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/profile") {
    const body = await readBody(req);
    const user = upsertUser(body);
    appendLog(`已更新 ${user.email} 的学习设置。`);
    saveStore();
    respondJson(res, 200, buildClientState(user.email));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/send/morning") {
    const body = await readBody(req);
    respondJson(res, 200, await sendMorningLesson(body.email, "manual"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/send/evening") {
    const body = await readBody(req);
    respondJson(res, 200, await sendEveningQuiz(body.email, "manual"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/quiz-submit") {
    const body = await readBody(req);
    respondJson(res, 200, submitQuiz(body));
    return;
  }

  respondJson(res, 404, { error: "Not found" });
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    respondText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function handleEmailAnswer(res, url) {
  const email = normalizeEmail(url.searchParams.get("email"));
  const sessionId = String(url.searchParams.get("sessionId") || "");
  const questionId = String(url.searchParams.get("questionId") || "");
  const option = String(url.searchParams.get("option") || "");

  const user = getUser(email);
  if (!user) {
    respondHtml(res, 404, renderResultPage("未找到该邮箱的学习记录。", false, null, email));
    return;
  }

  const session = user.sessions.find((item) => item.id === sessionId);
  if (!session) {
    respondHtml(res, 404, renderResultPage("未找到对应的学习记录。", false, null, email));
    return;
  }

  const question = session.quiz.questions.find((item) => item.id === questionId);
  if (!question) {
    respondHtml(res, 404, renderResultPage("未找到对应的题目。", false, session, email));
    return;
  }

  if (!session.quizResult) {
    session.quizResult = {
      submittedAt: new Date().toISOString(),
      score: 0,
      total: session.quiz.questions.length,
      accuracy: 0,
      answers: session.quiz.questions.map((item) => ({
        questionId: item.id,
        prompt: item.prompt,
        answer: "",
        correctAnswer: item.answer,
        isCorrect: false
      }))
    };
  }

  const answerRecord = session.quizResult.answers.find((item) => item.questionId === questionId);
  if (answerRecord.answer) {
    respondHtml(res, 200, renderResultPage("这道题已经作答过了。", answerRecord.isCorrect, session, email));
    return;
  }

  answerRecord.answer = option;
  answerRecord.isCorrect = option === question.answer;
  if (answerRecord.isCorrect) {
    session.quizResult.score += 1;
  }
  session.quizResult.submittedAt = new Date().toISOString();
  session.quizResult.accuracy = Math.round((session.quizResult.score / session.quizResult.total) * 100);

  appendLog(`${user.email} 通过邮件作答了一道题，当前正确率 ${session.quizResult.accuracy}%。`);
  saveStore();
  respondHtml(res, 200, renderResultPage(answerRecord.isCorrect ? "回答正确" : "回答错误", answerRecord.isCorrect, session, email));
}

function buildClientState(email) {
  const cleanEmail = normalizeEmail(email);
  const user = cleanEmail ? getUser(cleanEmail) : null;
  const sessions = user ? [...user.sessions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) : [];
  const finished = sessions.filter((session) => session.quizResult && session.quizResult.answers.some((item) => item.answer));
  const accuracy = finished.length
    ? Math.round(finished.reduce((sum, session) => sum + session.quizResult.accuracy, 0) / finished.length)
    : 0;
  const activeSession = sessions[0] || null;

  return {
    email: cleanEmail,
    profile: user
      ? {
          email: user.email,
          lessonCount: user.preferences.lessonCount,
          contentType: user.preferences.contentType,
          morningTime: user.preferences.morningTime,
          eveningTime: user.preferences.eveningTime
        }
      : null,
    stats: {
      totalSessions: sessions.length,
      quizzesCompleted: finished.length,
      streak: computeStreak(sessions),
      accuracy
    },
    activeSession,
    history: sessions.slice(0, 20),
    timeline: buildTimeline(sessions.slice(0, 12)),
    logs: [...store.logs].reverse().slice(0, 10)
  };
}

function computeStreak(sessions) {
  const sentDays = new Set(sessions.map((session) => session.date));
  let streak = 0;
  const cursor = new Date();
  while (true) {
    const key = formatDateKey(cursor);
    if (!sentDays.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function buildTimeline(sessions) {
  return sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    label: `${session.mode === "auto" ? "自动发送" : "手动发送"} · ${labelForType(session.contentType)} · ${session.items.length} 条`,
    quizStatus: session.quizResult && session.quizResult.answers.some((item) => item.answer)
      ? `${session.quizResult.accuracy}%`
      : session.quizSentAt ? "待作答" : "未发送测验"
  }));
}

function upsertUser(input) {
  const email = normalizeEmail(input?.email);
  if (!email) {
    throw new Error("请输入有效邮箱。");
  }
  const key = email.toLowerCase();
  const existing = store.users[key];
  const preferences = {
    lessonCount: normalizeLessonCount(input?.lessonCount ?? existing?.preferences?.lessonCount),
    contentType: normalizeContentType(input?.contentType ?? existing?.preferences?.contentType),
    morningTime: validTime(String(input?.morningTime || input?.schedule?.morningTime || existing?.preferences?.morningTime || "")) || "09:00",
    eveningTime: validTime(String(input?.eveningTime || input?.schedule?.eveningTime || existing?.preferences?.eveningTime || "")) || "18:00"
  };

  store.users[key] = existing || { email, preferences, sessions: [] };
  store.users[key].email = email;
  store.users[key].preferences = preferences;
  return store.users[key];
}

function getUser(email) {
  return store.users[normalizeEmail(email).toLowerCase()] || null;
}

async function sendMorningLesson(email, mode) {
  const user = upsertUser({ email });
  const session = createSession(user, mode);

  try {
    session.delivery.morning = await deliverEmail(user.email, {
      subject: `每日学习小助手｜${session.date} 早间学习`,
      html: renderMorningEmail(session),
      text: renderMorningText(session)
    });
  } catch (error) {
    appendLog(`${user.email} 的早晨邮件发送失败：${error.message}`);
    return { ok: false, message: `早晨邮件发送失败：${error.message}`, state: buildClientState(user.email) };
  }

  user.sessions.push(session);
  appendLog(`${user.email} 已${mode === "auto" ? "自动" : "手动"}发送早晨学习。`);
  saveStore();
  return { ok: true, message: "早晨学习邮件已发送。", state: buildClientState(user.email) };
}

async function sendEveningQuiz(email, mode) {
  const user = upsertUser({ email });
  const pending = [...user.sessions].reverse().find((session) => !session.quizSentAt);
  if (!pending) {
    return { ok: false, message: "请先发送一组早晨学习内容，再发送晚间测验。", state: buildClientState(user.email) };
  }

  try {
    pending.delivery.evening = await deliverEmail(user.email, {
      subject: `每日学习小助手｜${pending.date} 晚间测验`,
      html: renderEveningEmail(pending, user.email),
      text: renderEveningText(pending)
    });
  } catch (error) {
    appendLog(`${user.email} 的晚间测验发送失败：${error.message}`);
    return { ok: false, message: `晚间测验发送失败：${error.message}`, state: buildClientState(user.email) };
  }

  pending.quizSentAt = new Date().toISOString();
  pending.quizMode = mode;
  appendLog(`${user.email} 已${mode === "auto" ? "自动" : "手动"}发送晚间测验。`);
  saveStore();
  return { ok: true, message: "晚间测验邮件已发送。", state: buildClientState(user.email) };
}

function submitQuiz(payload) {
  const email = normalizeEmail(payload?.email);
  const sessionId = String(payload?.sessionId || "");
  const user = getUser(email);
  if (!user) {
    return { ok: false, message: "未找到该邮箱的学习记录。", state: buildClientState(email) };
  }
  const session = user.sessions.find((item) => item.id === sessionId);
  if (!session) {
    return { ok: false, message: "未找到对应的测验记录。", state: buildClientState(email) };
  }

  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  let score = 0;
  const reviewed = session.quiz.questions.map((question, index) => {
    const answer = String(answers[index] || "").trim();
    const isCorrect = answer === question.answer;
    if (isCorrect) score += 1;
    return { questionId: question.id, prompt: question.prompt, answer, correctAnswer: question.answer, isCorrect };
  });

  session.quizResult = {
    submittedAt: new Date().toISOString(),
    score,
    total: session.quiz.questions.length,
    accuracy: session.quiz.questions.length ? Math.round((score / session.quiz.questions.length) * 100) : 0,
    answers: reviewed
  };

  appendLog(`${user.email} 提交了测验，正确率 ${session.quizResult.accuracy}%。`);
  saveStore();
  return { ok: true, message: `提交成功，正确率 ${session.quizResult.accuracy}%。`, state: buildClientState(user.email) };
}

function createSession(user, mode) {
  const items = pickNextItems(user.preferences.lessonCount, user.preferences.contentType);
  const now = new Date();
  const session = {
    id: createId(),
    email: user.email,
    date: formatDateKey(now),
    createdAt: now.toISOString(),
    mode,
    contentType: user.preferences.contentType,
    items,
    quiz: null,
    quizSentAt: null,
    quizMode: null,
    quizResult: null,
    delivery: { morning: null, evening: null }
  };
  session.quiz = buildQuizForSession(session);
  return session;
}

function pickNextItems(count, contentType) {
  const filtered = contentType === "all" ? contentPool : contentPool.filter((item) => item.type === contentType);
  const source = filtered.length ? filtered : contentPool;
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const index = store.progress.nextContentIndex % source.length;
    items.push(source[index]);
    store.progress.nextContentIndex = (store.progress.nextContentIndex + 1) % source.length;
  }
  return items;
}

function buildQuizForSession(session) {
  return {
    questions: session.items.map((item, index) => buildChoiceQuestion(session.id, item, index))
  };
}

function buildChoiceQuestion(sessionId, item, index) {
  const distractors = shuffle(contentPool.filter((entry) => entry.chinese !== item.chinese).map((entry) => entry.chinese)).slice(0, 3);
  return {
    id: `${sessionId}-${index + 1}`,
    prompt: `这句内容的正确中文意思是哪个？ ${item.english}`,
    answer: item.chinese,
    options: shuffle([item.chinese, ...distractors])
  };
}

function runSchedulerCheck() {
  const now = new Date();
  const minuteKey = `${formatDateKey(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (schedulerMinuteKey === minuteKey) return;
  schedulerMinuteKey = minuteKey;
  const currentTime = minuteKey.slice(-5);

  Object.values(store.users).forEach((user) => {
    if (user.preferences.morningTime === currentTime) {
      sendMorningLesson(user.email, "auto").catch((error) => appendLog(`${user.email} 的早晨邮件发送失败：${error.message}`));
    }
    if (user.preferences.eveningTime === currentTime) {
      sendEveningQuiz(user.email, "auto").catch((error) => appendLog(`${user.email} 的晚间测验发送失败：${error.message}`));
    }
  });
}

async function deliverEmail(to, mail) {
  const smtp = getSmtpConfig();
  if (!smtp.enabled || !smtp.host || !smtp.user || !smtp.pass || !smtp.from || !to) {
    throw new Error("邮件服务未配置完成。");
  }

  await smtpSend({
    host: smtp.host,
    port: Number(smtp.port || 465),
    secure: smtp.secure !== false,
    user: smtp.user,
    pass: smtp.pass,
    from: smtp.from,
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text
  });

  return { id: createId(), createdAt: new Date().toISOString(), subject: mail.subject, mode: "smtp" };
}

function getSmtpConfig() {
  return {
    enabled: process.env.SMTP_ENABLED ? process.env.SMTP_ENABLED === "true" : Boolean(store.smtp.enabled),
    host: process.env.SMTP_HOST || store.smtp.host,
    port: Number(process.env.SMTP_PORT || store.smtp.port || 465),
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : store.smtp.secure !== false,
    user: process.env.SMTP_USER || store.smtp.user,
    pass: process.env.SMTP_PASS || store.smtp.pass,
    from: process.env.SMTP_FROM || store.smtp.from
  };
}

function smtpSend(options) {
  return new Promise((resolve, reject) => {
    const socket = options.secure
      ? tls.connect(options.port, options.host, { servername: options.host, rejectUnauthorized: false }, onConnected)
      : net.connect(options.port, options.host, onConnected);

    socket.setEncoding("utf8");
    socket.on("error", reject);

    let buffer = "";
    let waiting = null;
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\r\n")) return;
      const lines = buffer.split("\r\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        if (waiting && /^[0-9]{3} /.test(line)) {
          const done = waiting;
          waiting = null;
          done(line);
        }
      }
    });

    function onConnected() {
      run().catch(reject);
    }

    function send(command) {
      socket.write(`${command}\r\n`);
    }

    function waitCode(prefix) {
      return new Promise((resolveLine, rejectLine) => {
        waiting = (line) => {
          if (!line.startsWith(prefix)) {
            rejectLine(new Error(`SMTP unexpected response: ${line}`));
            socket.end();
            return;
          }
          resolveLine(line);
        };
      });
    }

    async function run() {
      await waitCode("220");
      send("EHLO localhost");
      await waitCode("250");
      send("AUTH LOGIN");
      await waitCode("334");
      send(Buffer.from(options.user).toString("base64"));
      await waitCode("334");
      send(Buffer.from(options.pass).toString("base64"));
      await waitCode("235");
      send(`MAIL FROM:<${options.from}>`);
      await waitCode("250");
      send(`RCPT TO:<${options.to}>`);
      await waitCode("250");
      send("DATA");
      await waitCode("354");
      socket.write(`${buildMimeMessage(options)}\r\n.\r\n`);
      await waitCode("250");
      send("QUIT");
      socket.end();
      resolve();
    }
  });
}

function buildMimeMessage(options) {
  const boundary = `BOUNDARY_${Date.now()}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(options.subject).toString("base64")}?=`;
  return [
    `From: ${options.from}`,
    `To: ${options.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(options.text).toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(options.html).toString("base64"),
    `--${boundary}--`
  ].join("\r\n");
}

function renderMorningEmail(session) {
  const itemsHtml = session.items.map((item, index) => `
    <li style="margin-bottom:16px;">
      <strong>${index + 1}. ${item.english}</strong><br>
      类型：${labelForType(item.type)}<br>
      中文：${item.chinese}<br>
      场景：${item.scene}<br>
      例句：${item.example}
    </li>
  `).join("");
  return `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#1f2937;"><h2>早安，今天的英语学习来了</h2><p>今天共学习 ${session.items.length} 条内容：</p><ol>${itemsHtml}</ol><p>今晚可以继续完成对应的选择题测验。</p></div>`;
}

function renderMorningText(session) {
  return [`早安，今天共学习 ${session.items.length} 条内容：`, ...session.items.map((item, index) => `${index + 1}. [${labelForType(item.type)}] ${item.english} | ${item.chinese} | 场景：${item.scene} | 例句：${item.example}`), "今晚可以继续完成对应的选择题测验。"].join("\n");
}

function renderEveningEmail(session, email) {
  const baseUrl = getBaseUrl();
  const quizHtml = session.quiz.questions.map((question, index) => {
    const options = question.options.map((option, optionIndex) => {
      const href = `${baseUrl}/answer?email=${encodeURIComponent(email)}&sessionId=${encodeURIComponent(session.id)}&questionId=${encodeURIComponent(question.id)}&option=${encodeURIComponent(option)}`;
      return `<a href="${href}" style="display:block;margin:8px 0;padding:10px 12px;border-radius:12px;background:#fff3ea;color:#a14b27;text-decoration:none;">${String.fromCharCode(65 + optionIndex)}. ${option}</a>`;
    }).join("");
    return `<li style="margin-bottom:16px;">${index + 1}. ${question.prompt}${options}</li>`;
  }).join("");

  return `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#1f2937;"><h2>晚上好，直接在邮件里点选答案吧</h2><p>点击下方选项即可立即作答，系统会自动记录到你的学习中心。</p><ol>${quizHtml}</ol></div>`;
}

function renderEveningText(session) {
  return ["晚上好，点击邮件中的选项即可作答：", ...session.quiz.questions.map((question, index) => `${index + 1}. ${question.prompt} ${question.options.join(" / ")}`)].join("\n");
}

function renderResultPage(title, isCorrect, session, email) {
  const baseUrl = getBaseUrl();
  const detail = session?.quizResult ? `当前正确率：${session.quizResult.accuracy}%` : "可以回到产品页面继续查看学习记录。";
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>答题结果</title><style>body{font-family:Arial,sans-serif;margin:0;background:linear-gradient(135deg,#fbf6ef,#f0e4d4);display:flex;align-items:center;justify-content:center;min-height:100vh;color:#2f261f} .card{max-width:520px;width:calc(100vw - 32px);background:rgba(255,252,247,.92);padding:28px;border-radius:24px;box-shadow:0 18px 50px rgba(86,55,33,.12)} h1{margin:0 0 12px 0} .badge{display:inline-block;padding:8px 12px;border-radius:999px;background:${isCorrect ? "rgba(19,139,114,.14);color:#138b72" : "rgba(225,102,58,.14);color:#e1663a"};font-weight:700;margin-bottom:12px} a{display:inline-block;margin-top:18px;padding:12px 16px;border-radius:999px;background:#e1663a;color:#fff;text-decoration:none;font-weight:700}</style></head><body><div class="card"><div class="badge">${isCorrect ? "回答正确" : "回答完成"}</div><h1>${title}</h1><p>${detail}</p><p>邮箱：${email || "未识别"}</p><a href="${baseUrl}/?email=${encodeURIComponent(email || "")}">返回学习中心</a></div></body></html>`;
}

function getBaseUrl() {
  return process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
}

function seedStore() {
  return {
    smtp: {
      enabled: true,
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      user: "2630896019@qq.com",
      pass: "pheswnsjmjjveaii",
      from: "2630896019@qq.com"
    },
    logs: [],
    progress: { nextContentIndex: 0 },
    users: {}
  };
}

function seedContent() {
  return [
    { type: "spoken", english: "That makes sense.", chinese: "这就说得通了。", scene: "对别人解释表示认同", example: "Oh, you took a taxi because it was raining. That makes sense." },
    { type: "spoken", english: "I'm still figuring it out.", chinese: "我还在摸索当中。", scene: "谈计划时表达尚未确定", example: "I haven't decided on the final plan yet. I'm still figuring it out." },
    { type: "spoken", english: "Let's play it by ear.", chinese: "我们到时候随机应变吧。", scene: "计划不确定时", example: "If the weather changes, let's play it by ear." },
    { type: "vocabulary", english: "Sustainable", chinese: "可持续的", scene: "环保和商业语境", example: "We need a more sustainable solution." },
    { type: "vocabulary", english: "Accurate", chinese: "准确的", scene: "描述信息是否精确", example: "The summary is short but accurate." },
    { type: "business", english: "Let's align on the priorities.", chinese: "我们先对齐一下优先级。", scene: "会议沟通", example: "Before we start, let's align on the priorities." },
    { type: "business", english: "I'll circle back tomorrow.", chinese: "我明天再回复你。", scene: "工作跟进", example: "I need to confirm the details, so I'll circle back tomorrow." },
    { type: "travel", english: "Is this seat taken?", chinese: "这个座位有人吗？", scene: "公共场合", example: "Excuse me, is this seat taken?" },
    { type: "travel", english: "I'd like to check in.", chinese: "我想办理入住。", scene: "酒店机场", example: "Hi, I'd like to check in. I have a reservation." },
    { type: "writing", english: "I appreciate your patience.", chinese: "感谢你的耐心。", scene: "邮件写作", example: "I appreciate your patience while we work on this issue." },
    { type: "writing", english: "Please find the attachment below.", chinese: "请查收下面的附件。", scene: "正式邮件", example: "Please find the attachment below for your review." }
  ];
}

function normalizeEmail(value) {
  return String(value || "").trim();
}

function normalizeLessonCount(value) {
  const count = Number(value || 2);
  if (Number.isNaN(count)) return 2;
  return Math.min(5, Math.max(1, count));
}

function normalizeContentType(value) {
  const allowed = ["all", "spoken", "vocabulary", "business", "travel", "writing"];
  return allowed.includes(value) ? value : "spoken";
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(value) ? value : "";
}

function labelForType(type) {
  return {
    spoken: "英语口语",
    vocabulary: "词汇积累",
    business: "商务英语",
    travel: "旅行英语",
    writing: "邮件写作"
  }[type] || "综合学习";
}

function appendLog(message) {
  store.logs.push({ id: createId(), time: new Date().toISOString(), message });
  store.logs = store.logs.slice(-100);
  saveStore();
}

function saveStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureFile(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
  }
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function shuffle(items) {
  const cloned = items.slice();
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = cloned[i];
    cloned[i] = cloned[j];
    cloned[j] = temp;
  }
  return cloned;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function respondText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function respondHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}
