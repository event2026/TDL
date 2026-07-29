import { STATUS_BOARD_CONFIG as CONFIG } from "./config.js?v=6.1.0";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const STATUS = ["대기", "진행중", "이슈", "완료"];
const ROLE_LABEL = { viewer: "열람 전용", editor: "편집자", admin: "관리자" };

const state = {
  user: null,
  role: "viewer",
  categories: [],
  tasks: [],
  members: [],
  filter: "전체",
  search: "",
  selectedCategoryId: "all",
  unsubs: [],
  accessDenied: false,
  categoriesLoaded: false,
  tasksLoaded: false,
  accessUnsub: null,
  expandedCategoryIds: new Set(),
  expansionInitialized: false
};

let app;
let auth;
let db;
let provider;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isOwnerEmail(email) {
  return normalizeEmail(email) === normalizeEmail(CONFIG.ownerEmail);
}

function isAdmin() {
  return state.role === "admin" || state.role === "editor";
}

function canEditStatus() {
  return isAdmin();
}

function scopedTasks() {
  if (state.selectedCategoryId === "all") return state.tasks;
  return state.tasks.filter((task) => task.categoryId === state.selectedCategoryId);
}

function currentCategory() {
  return state.categories.find((category) => category.id === state.selectedCategoryId) || null;
}

function profileInitial() {
  const source = state.user?.displayName || state.user?.email || "U";
  return String(source).trim().charAt(0).toLocaleUpperCase("ko") || "U";
}

function closeProfileMenu() {
  const menu = $("profileMenu");
  const button = $("profileButton");
  if (!menu || !button) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

function toggleProfileMenu() {
  const menu = $("profileMenu");
  const button = $("profileButton");
  if (!menu || !button) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function selectCategory(categoryId) {
  const valid = categoryId === "all" || state.categories.some((category) => category.id === categoryId);
  state.selectedCategoryId = valid ? categoryId : "all";
  state.filter = "전체";
  hideTaskComposer();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSidebar() {
  if (state.selectedCategoryId !== "all" && !state.categories.some((category) => category.id === state.selectedCategoryId)) {
    state.selectedCategoryId = "all";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  })[character]);
}

function sortByOrder(a, b) {
  return (Number(a.order) || 0) - (Number(b.order) || 0)
    || String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""), "ko");
}

function normalizeDueDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function dueDateInfo(value, status = "대기") {
  const dueDate = normalizeDueDate(value);
  if (!dueDate) return { text: "마감 미정", className: "none" };

  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return { text: "마감 미정", className: "none" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(due);

  if (status === "완료") return { text: `마감 ${formatted}`, className: "done" };
  if (diffDays < 0) return { text: `기한 지남 · ${formatted}`, className: "overdue" };
  if (diffDays === 0) return { text: `오늘 마감 · ${formatted}`, className: "soon" };
  if (diffDays <= 3) return { text: `D-${diffDays} · ${formatted}`, className: "soon" };
  return { text: `마감 ${formatted}`, className: "normal" };
}

function notify(message, error = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => {
    toast.className = "toast";
  }, 2800);
}

function setSync() {
  // Realtime sync stays active internally; the toolbar indicator was removed.
}

function showLoginError(message) {
  $("loginError").hidden = false;
  $("loginError").textContent = message;
  $("loginStatus").textContent = "연결을 확인해 주세요.";
}

function clearLoginError() {
  $("loginError").hidden = true;
  $("loginError").textContent = "";
}

function closeDataSubscriptions() {
  for (const unsubscribe of state.unsubs) {
    try { unsubscribe(); } catch { /* noop */ }
  }
  state.unsubs = [];
}

function closeAccessSubscription() {
  if (!state.accessUnsub) return;
  try { state.accessUnsub(); } catch { /* noop */ }
  state.accessUnsub = null;
}

function closeSubscriptions() {
  closeDataSubscriptions();
  closeAccessSubscription();
}

function openDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = $(id);
  if (dialog.open) dialog.close();
}

async function beginGoogleLogin() {
  clearLoginError();
  $("loginStatus").textContent = "Google 로그인 창을 여는 중입니다.";
  $("loginBtn").disabled = true;

  try {
    if (state.accessDenied && auth.currentUser) {
      await signOut(auth);
    }
    await signInWithPopup(auth, provider);
  } catch (error) {
    const code = error?.code || "";
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
      showLoginError(authErrorMessage(error));
    } else {
      $("loginStatus").textContent = "로그인이 취소되었습니다.";
    }
  } finally {
    $("loginBtn").disabled = false;
  }
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code === "auth/unauthorized-domain") {
    return "Firebase Authentication의 Authorized domains에 event2026.github.io를 추가해 주세요.";
  }
  if (code === "auth/popup-blocked") {
    return "브라우저가 로그인 팝업을 차단했습니다. 팝업을 허용한 뒤 다시 시도해 주세요.";
  }
  if (code === "auth/network-request-failed") {
    return "네트워크 연결에 실패했습니다. 인터넷 연결과 Firebase 설정을 확인해 주세요.";
  }
  return error?.message || "Google 로그인에 실패했습니다.";
}

function firestoreErrorMessage(error) {
  if (error?.code === "permission-denied") {
    return "Firestore 권한이 거부되었습니다. ZIP에 포함된 firestore.rules가 게시되었는지 확인해 주세요.";
  }
  if (error?.code === "unavailable") {
    return "Firestore에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.";
  }
  return error?.message || "Firestore 연결 중 오류가 발생했습니다.";
}

function memberDocumentId(user) {
  return String(user?.email || "").trim();
}

function roleFromMember(member) {
  if (member?.canRead !== true) return "pending";
  return member.canWrite === true ? "editor" : "viewer";
}

async function ensurePendingMember(user) {
  const email = memberDocumentId(user);
  if (!email || isOwnerEmail(email)) return;
  const reference = doc(db, "members", email);
  const snapshot = await getDoc(reference);
  if (snapshot.exists()) return;

  await setDoc(reference, {
    email,
    uid: user.uid,
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    canRead: false,
    canWrite: false,
    status: "pending",
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function showPendingAccess(user) {
  state.accessDenied = true;
  state.role = "viewer";
  closeDataSubscriptions();
  hideTaskComposer();
  $("appShell").hidden = true;
  $("loginGate").hidden = false;
  $("loginBtn").innerHTML = '<span class="google-mark" aria-hidden="true">G</span>다른 계정으로 로그인';
  $("loginStatus").textContent = "권한 요청이 관리자 목록에 등록되었습니다.";
  $("loginError").className = "notice notice-pending";
  $("loginError").hidden = false;
  $("loginError").textContent = `${user.email} 계정은 현재 비활성 상태입니다. 관리자가 권한을 허용하면 이 화면에서 자동으로 현황판이 열립니다.`;
}

function activateAuthorizedUser(user, member) {
  const nextRole = roleFromMember(member);
  if (nextRole === "pending") {
    showPendingAccess(user);
    return;
  }

  const wasHidden = $("appShell").hidden;
  const roleChanged = state.role !== nextRole;
  state.accessDenied = false;
  state.role = nextRole;
  $("loginGate").hidden = true;
  $("appShell").hidden = false;
  $("accessNotice").hidden = true;
  clearLoginError();
  renderAccess();
  if (wasHidden) subscribeToData();
  else if (roleChanged) render();
}

function watchOwnAccess(user) {
  closeAccessSubscription();
  const reference = doc(db, "members", memberDocumentId(user));
  state.accessUnsub = onSnapshot(reference, async (snapshot) => {
    if (!snapshot.exists()) {
      try {
        await ensurePendingMember(user);
      } catch (error) {
        showLoginError(firestoreErrorMessage(error));
      }
      return;
    }
    activateAuthorizedUser(user, snapshot.data());
  }, (error) => {
    console.error(error);
    showLoginError(firestoreErrorMessage(error));
  });
}

function subscribeToData() {
  closeDataSubscriptions();
  state.categoriesLoaded = false;
  state.tasksLoaded = false;
  setSync("실시간 연결 중", "saving");

  state.unsubs.push(onSnapshot(
    collection(db, "categories"),
    (snapshot) => {
      state.categories = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort(sortByOrder);
      if (!state.expansionInitialized && state.categories.length) {
        state.expandedCategoryIds.add(state.categories[0].id);
        state.expansionInitialized = true;
      }
      state.categoriesLoaded = true;
      updateConnectedState();
      render();
    },
    handleListenerError
  ));

  state.unsubs.push(onSnapshot(
    collection(db, "tasks"),
    (snapshot) => {
      state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort(sortByOrder);
      state.tasksLoaded = true;
      updateConnectedState();
      render();
    },
    handleListenerError
  ));

  if (isAdmin()) {
    state.unsubs.push(onSnapshot(
      collection(db, "members"),
      (snapshot) => {
        state.members = snapshot.docs
          .map((item) => ({ email: item.id, ...item.data() }))
          .sort((a, b) => a.email.localeCompare(b.email));
        renderPermissions();
      },
      handleListenerError
    ));
  }
}

function updateConnectedState() {
  if (state.categoriesLoaded && state.tasksLoaded) setSync("실시간 연결", "ok");
}

function handleListenerError(error) {
  console.error(error);
  setSync("연결 오류", "error");
  $("accessNotice").hidden = false;
  $("accessNotice").className = "notice notice-error";
  $("accessNotice").textContent = firestoreErrorMessage(error);
  notify(firestoreErrorMessage(error), true);
}

function getStats(tasks = state.tasks) {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "완료").length;
  const doing = tasks.filter((task) => task.status === "진행중").length;
  const issue = tasks.filter((task) => task.status === "이슈").length;
  const waiting = total - done - doing - issue;
  return { total, done, doing, issue, waiting, percent: total ? Math.round((done / total) * 100) : 0 };
}

function renderHeader() {
  const category = currentCategory();
  const tasks = scopedTasks();
  const stats = getStats(tasks);
  document.title = CONFIG.title;
  $("viewTitle").textContent = category?.name || "전체 진행";
  $("viewSubtitle").textContent = `${stats.total}개 중 ${stats.done}개 완료`;
  $("completionRate").textContent = stats.percent;
  $("completionFill").style.width = `${stats.percent}%`;
}

function renderFilters() {
  const stats = getStats(scopedTasks());
  const cards = [
    ["완료", stats.done, "done"],
    ["진행중", stats.doing, "doing"],
    ["이슈", stats.issue, "issue"],
    ["대기", stats.waiting, "waiting"]
  ];
  $("statusCards").innerHTML = cards.map(([name, count, className]) => (
    `<button class="stat-card ${state.filter === name ? "active" : ""}" type="button" data-filter="${name}" aria-pressed="${state.filter === name}"><i class="stat-dot ${className}"></i><span class="stat-label">${name}</span><strong>${count}</strong></button>`
  )).join("");
  $("statusCards").querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = state.filter === button.dataset.filter ? "전체" : button.dataset.filter;
      renderFilters();
      renderBoard();
    });
  });
}

function filteredTasks(categoryId) {
  const search = state.search.trim().toLocaleLowerCase("ko");
  return state.tasks
    .filter((task) => task.categoryId === categoryId)
    .filter((task) => state.filter === "전체" || task.status === state.filter)
    .filter((task) => {
      if (!search) return true;
      return [task.title, task.assignee, task.memo, task.dueDate]
        .some((value) => String(value || "").toLocaleLowerCase("ko").includes(search));
    })
    .sort(sortByOrder);
}

function taskRow(task, orderedTasks) {
  const status = STATUS.includes(task.status) ? task.status : "대기";
  const statusControl = canEditStatus()
    ? `<select class="status-control" data-task-status="${task.id}" data-status="${escapeHtml(status)}" aria-label="${escapeHtml(task.title)} 상태">${STATUS.map((item) => `<option value="${item}" ${item === status ? "selected" : ""}>${item}</option>`).join("")}</select>`
    : `<span class="status-pill" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  const deadline = dueDateInfo(task.dueDate, status);
  const memo = String(task.memo || "").trim();
  const assignee = String(task.assignee || "").trim() || "미지정";
  const orderIndex = orderedTasks.findIndex((item) => item.id === task.id);
  const check = isAdmin()
    ? `<button class="task-check" type="button" data-task-complete="${task.id}" aria-label="${escapeHtml(task.title)} ${status === "완료" ? "완료 취소" : "완료 처리"}">${status === "완료" ? "✓" : ""}</button>`
    : `<span class="task-check" aria-hidden="true">${status === "완료" ? "✓" : ""}</span>`;
  return `<div class="task-row ${status === "완료" ? "is-complete" : ""}" data-task-row="${task.id}" ${isAdmin() ? 'draggable="true"' : ""}>
    <div class="task-main">
      ${check}
      <div class="task-copy">
        <strong class="task-title">${escapeHtml(task.title)}</strong>
        <p class="task-meta"><span class="task-assignee">${escapeHtml(assignee)}</span><span class="deadline deadline-${deadline.className}">${escapeHtml(deadline.text)}</span>${memo ? `<span class="task-memo">${escapeHtml(memo)}</span>` : ""}</p>
      </div>
    </div>
    <div class="task-state">${statusControl}</div>
    ${isAdmin() ? `<span class="task-actions"><span class="task-order-actions"><button class="button button-small button-icon" type="button" data-task-up="${task.id}" title="위로 이동" ${orderIndex <= 0 ? "disabled" : ""}>↑</button><button class="button button-small button-icon" type="button" data-task-down="${task.id}" title="아래로 이동" ${orderIndex >= orderedTasks.length - 1 ? "disabled" : ""}>↓</button></span><button class="button button-small" type="button" data-inline-edit="${task.id}">편집</button><button class="button button-small button-danger" type="button" data-inline-delete="${task.id}">삭제</button></span>` : ""}
  </div>`;
}

function renderBoard() {
  const allCategories = state.categories.slice().sort(sortByOrder);
  const categories = state.selectedCategoryId === "all"
    ? allCategories
    : allCategories.filter((category) => category.id === state.selectedCategoryId);
  let visibleCategories = 0;
  const html = categories.map((category) => {
    const globalIndex = allCategories.findIndex((item) => item.id === category.id);
    const allTasks = state.tasks.filter((task) => task.categoryId === category.id).sort(sortByOrder);
    const visibleTasks = filteredTasks(category.id);
    const shouldHide = state.selectedCategoryId === "all" && !visibleTasks.length && (state.search || state.filter !== "전체");
    if (shouldHide) return "";
    visibleCategories += 1;
    const completed = allTasks.filter((task) => task.status === "완료").length;
    const autoExpand = Boolean(state.search || state.filter !== "전체");
    const expanded = autoExpand || state.expandedCategoryIds.has(category.id) || state.selectedCategoryId !== "all";
    const percent = allTasks.length ? Math.round((completed / allTasks.length) * 100) : 0;
    return `<section class="category ${expanded ? "is-expanded" : ""}" id="category-${category.id}">
      <div class="category-header">
        <button class="category-toggle" type="button" data-category-toggle="${category.id}" aria-expanded="${expanded}">
          <span class="category-chevron" aria-hidden="true">⌄</span>
          <span class="category-number">${String(globalIndex + 1).padStart(2, "0")}</span>
          <strong class="category-title">${escapeHtml(category.name)}</strong>
          <span class="category-progress"><span>${completed}/${allTasks.length}</span><i><b style="width:${percent}%"></b></i></span>
        </button>
        ${isAdmin() ? `<button class="button button-small category-add" type="button" data-quick-add="${category.id}">+ 추가</button>` : ""}
      </div>
      <div class="category-content" ${expanded ? "" : "hidden"}>
        <div class="task-list">${visibleTasks.length ? visibleTasks.map((task) => taskRow(task, allTasks)).join("") : '<div class="empty-state"><strong>표시할 항목이 없습니다</strong>항목을 추가하거나 필터를 변경해 보세요.</div>'}</div>
      </div>
    </section>`;
  }).join("");

  if (!allCategories.length) {
    $("board").innerHTML = `<div class="empty-state"><strong>아직 등록된 카테고리가 없습니다</strong>${isAdmin() ? "목록 관리에서 카테고리를 추가하거나 기본 목록을 만들어 주세요." : "편집 권한이 있는 사용자가 현황판을 준비 중입니다."}</div>`;
  } else if (!visibleCategories) {
    $("board").innerHTML = '<div class="empty-state"><strong>조건에 맞는 항목이 없습니다</strong>검색어나 상태 필터를 변경해 보세요.</div>';
  } else {
    $("board").innerHTML = html;
  }

  $("board").querySelectorAll("[data-task-status]").forEach((select) => select.addEventListener("change", () => changeTaskStatus(select)));
  $("board").querySelectorAll("[data-category-toggle]").forEach((button) => button.addEventListener("click", () => {
    const categoryId = button.dataset.categoryToggle;
    if (state.expandedCategoryIds.has(categoryId)) state.expandedCategoryIds.delete(categoryId);
    else state.expandedCategoryIds.add(categoryId);
    renderBoard();
  }));
  $("board").querySelectorAll("[data-task-complete]").forEach((button) => button.addEventListener("click", () => toggleTaskCompletion(button.dataset.taskComplete)));
  $("board").querySelectorAll("[data-quick-add]").forEach((button) => button.addEventListener("click", () => {
    state.expandedCategoryIds.add(button.dataset.quickAdd);
    showTaskComposer(null, button.dataset.quickAdd);
  }));
  $("board").querySelectorAll("[data-task-up]").forEach((button) => button.addEventListener("click", () => moveTask(button.dataset.taskUp, -1)));
  $("board").querySelectorAll("[data-task-down]").forEach((button) => button.addEventListener("click", () => moveTask(button.dataset.taskDown, 1)));
  $("board").querySelectorAll("[data-inline-edit]").forEach((button) => button.addEventListener("click", () => showTaskComposer(state.tasks.find((task) => task.id === button.dataset.inlineEdit))));
  $("board").querySelectorAll("[data-inline-delete]").forEach((button) => button.addEventListener("click", () => deleteTask(button.dataset.inlineDelete)));
  bindTaskDragAndDrop();
}

function renderAccess() {
  $("manageBtn").hidden = !isAdmin();
  $("permissionBtn").hidden = !isAdmin();
  $("profileInitial").textContent = profileInitial();
  $("profileEmail").textContent = state.user?.email || "";
  $("profileRole").textContent = ROLE_LABEL[state.role] || ROLE_LABEL.viewer;
  if (!isAdmin()) hideTaskComposer();
}

function render() {
  renderSidebar();
  renderHeader();
  renderFilters();
  renderBoard();
  renderAccess();
  const manageDialog = $("manageDialog");
  const permissionDialog = $("permissionDialog");
  if (manageDialog?.open) renderManagement();
  if (permissionDialog?.open) renderPermissions();
}

async function changeTaskStatus(select) {
  if (!canEditStatus()) return;
  const task = state.tasks.find((item) => item.id === select.dataset.taskStatus);
  if (!task || !STATUS.includes(select.value)) return;

  const previousStatus = task.status;
  select.disabled = true;
  select.dataset.status = select.value;
  setSync("저장 중", "saving");

  try {
    await updateDoc(doc(db, "tasks", task.id), {
      status: select.value,
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    });
    notify("상태를 변경했습니다.");
  } catch (error) {
    select.value = previousStatus;
    select.dataset.status = previousStatus;
    notify(firestoreErrorMessage(error), true);
  } finally {
    select.disabled = false;
    setSync("실시간 연결", "ok");
  }
}

async function toggleTaskCompletion(taskId) {
  if (!canEditStatus()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const nextStatus = task.status === "완료" ? "대기" : "완료";
  setSync("저장 중", "saving");
  try {
    await updateDoc(doc(db, "tasks", task.id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    });
    notify(nextStatus === "완료" ? "완료로 표시했습니다." : "완료 표시를 해제했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  } finally {
    setSync("실시간 연결", "ok");
  }
}

function showTaskComposer(task = null, categoryId = null) {
  if (!isAdmin()) return;
  if (!state.categories.length) {
    notify("카테고리를 먼저 추가해 주세요.", true);
    return;
  }

  const categories = state.categories.slice().sort(sortByOrder);
  $("taskComposerTitle").textContent = task ? "항목 편집" : "새 항목";
  $("taskId").value = task?.id || "";
  $("taskCategory").innerHTML = categories.map((category) => (
    `<option value="${category.id}" ${category.id === (task?.categoryId || categoryId) ? "selected" : ""}>${escapeHtml(category.name)}</option>`
  )).join("");
  if (!task && !categoryId) $("taskCategory").value = categories[0].id;
  $("taskTitle").value = task?.title || "";
  $("taskStatus").value = STATUS.includes(task?.status) ? task.status : "대기";
  $("taskDueDate").value = normalizeDueDate(task?.dueDate);
  $("taskAssignee").value = task?.assignee || "";
  $("taskMemo").value = task?.memo || "";
  $("taskComposer").hidden = false;
  $("taskComposer").scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => $("taskTitle").focus(), 250);
}

function hideTaskComposer() {
  $("taskComposer").hidden = true;
  $("taskForm").reset();
  $("taskId").value = "";
}

async function saveTask(event) {
  event.preventDefault();
  if (!isAdmin()) return;

  const id = $("taskId").value;
  const categoryId = $("taskCategory").value;
  const title = $("taskTitle").value.trim();
  const status = $("taskStatus").value;
  const dueDate = normalizeDueDate($("taskDueDate").value);
  const assignee = $("taskAssignee").value.trim();
  const memo = $("taskMemo").value.trim();
  if (!title || !categoryId || !STATUS.includes(status)) return;

  const existing = state.tasks.find((task) => task.id === id);
  const maxOrder = Math.max(0, ...state.tasks.filter((task) => task.categoryId === categoryId && task.id !== id).map((task) => Number(task.order) || 0));
  setSync("저장 중", "saving");

  try {
    if (existing) {
      const payload = {
        categoryId,
        title,
        status,
        dueDate,
        assignee,
        memo,
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      };
      if (existing.categoryId !== categoryId) payload.order = maxOrder + 100;
      await updateDoc(doc(db, "tasks", id), payload);
    } else {
      await addDoc(collection(db, "tasks"), {
        categoryId,
        title,
        status,
        dueDate,
        assignee,
        memo,
        order: maxOrder + 100,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      });
    }
    hideTaskComposer();
    notify("항목을 저장했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  } finally {
    setSync("실시간 연결", "ok");
  }
}

async function deleteTask(taskId) {
  if (!isAdmin()) return;
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || !window.confirm(`“${task.title}” 항목을 삭제할까요?`)) return;
  try {
    await deleteDoc(doc(db, "tasks", taskId));
    notify("항목을 삭제했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function addCategory(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const name = $("newCategoryName").value.trim();
  if (!name) return;
  const maxOrder = Math.max(0, ...state.categories.map((category) => Number(category.order) || 0));
  try {
    await addDoc(collection(db, "categories"), {
      name,
      order: maxOrder + 100,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    });
    $("newCategoryName").value = "";
    notify("카테고리를 추가했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function renameCategory(categoryId) {
  if (!isAdmin()) return;
  const category = state.categories.find((item) => item.id === categoryId);
  const input = $("categoryManageList").querySelector(`[data-category-name="${CSS.escape(categoryId)}"]`);
  if (!category || !input) return;
  const name = input.value.trim();
  if (!name) {
    input.focus();
    return;
  }
  if (name === category.name) {
    notify("변경된 이름이 없습니다.");
    return;
  }
  try {
    await updateDoc(doc(db, "categories", categoryId), {
      name,
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    });
    notify("카테고리 이름을 변경했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function deleteCategory(categoryId) {
  if (!isAdmin()) return;
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  const categoryTasks = state.tasks.filter((task) => task.categoryId === categoryId);
  if (!window.confirm(`“${category.name}” 카테고리와 포함된 ${categoryTasks.length}개 항목을 모두 삭제할까요?`)) return;

  try {
    const refs = categoryTasks.map((task) => doc(db, "tasks", task.id));
    refs.push(doc(db, "categories", categoryId));
    await deleteRefsInChunks(refs);
    if (state.selectedCategoryId === categoryId) state.selectedCategoryId = "all";
    notify("카테고리를 삭제했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function deleteRefsInChunks(refs) {
  const chunkSize = 450;
  for (let start = 0; start < refs.length; start += chunkSize) {
    const batch = writeBatch(db);
    refs.slice(start, start + chunkSize).forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}

async function rewriteOrders(items, collectionName, message) {
  if (!isAdmin()) return;
  try {
    const batch = writeBatch(db);
    items.forEach((item, index) => {
      batch.update(doc(db, collectionName, item.id), {
        order: (index + 1) * 100,
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      });
    });
    await batch.commit();
    notify(message);
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function moveCategory(categoryId, direction) {
  const list = state.categories.slice().sort(sortByOrder);
  const index = list.findIndex((category) => category.id === categoryId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  await rewriteOrders(list, "categories", "카테고리 순서를 변경했습니다.");
}

async function moveTask(taskId, direction) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const list = state.tasks.filter((item) => item.categoryId === task.categoryId).sort(sortByOrder);
  const index = list.findIndex((item) => item.id === taskId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  await rewriteOrders(list, "tasks", "항목 순서를 변경했습니다.");
}

async function moveTaskByDrop(sourceId, targetId) {
  if (!isAdmin() || sourceId === targetId) return;
  const source = state.tasks.find((task) => task.id === sourceId);
  const target = state.tasks.find((task) => task.id === targetId);
  if (!source || !target || source.categoryId !== target.categoryId) {
    notify("같은 목록 안에서만 순서를 변경할 수 있습니다.", true);
    return;
  }
  const list = state.tasks.filter((task) => task.categoryId === source.categoryId).sort(sortByOrder);
  const sourceIndex = list.findIndex((task) => task.id === sourceId);
  const targetIndex = list.findIndex((task) => task.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = list.splice(sourceIndex, 1);
  list.splice(targetIndex, 0, moved);
  await rewriteOrders(list, "tasks", "항목 순서를 변경했습니다.");
}

function bindTaskDragAndDrop() {
  if (!isAdmin()) return;
  let draggingId = "";
  const rows = [...$("board").querySelectorAll("[data-task-row]")];
  rows.forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      draggingId = row.dataset.taskRow;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggingId);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      rows.forEach((item) => item.classList.remove("drag-over"));
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (draggingId && draggingId !== row.dataset.taskRow) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.classList.remove("drag-over");
      const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
      await moveTaskByDrop(sourceId, row.dataset.taskRow);
    });
  });
}

function renderManagement() {
  if (!isAdmin()) return;
  const categories = state.categories.slice().sort(sortByOrder);

  $("categoryManageList").innerHTML = categories.length
    ? categories.map((category, index) => `<div class="manage-row">
        <div class="manage-main manage-main-editable">
          <input class="category-name-input" data-category-name="${category.id}" value="${escapeHtml(category.name)}" maxlength="80" aria-label="카테고리 이름">
          <small>${state.tasks.filter((task) => task.categoryId === category.id).length}개 항목</small>
        </div>
        <div class="manage-actions">
          <button class="button button-icon" type="button" data-category-up="${category.id}" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="button button-icon" type="button" data-category-down="${category.id}" ${index === categories.length - 1 ? "disabled" : ""}>↓</button>
          <button class="button" type="button" data-category-rename="${category.id}">저장</button>
          <button class="button button-danger" type="button" data-category-delete="${category.id}">삭제</button>
        </div>
      </div>`).join("")
    : '<div class="empty-state">카테고리가 없습니다.</div>';

  $("emptyDataSection").hidden = state.categories.length > 0 || state.tasks.length > 0;
  bindManagementActions();
}

function renderPermissions() {
  if (!isAdmin()) return;
  const members = state.members.slice().sort((a, b) => {
    const pendingA = a.canRead === true ? 1 : 0;
    const pendingB = b.canRead === true ? 1 : 0;
    return pendingA - pendingB || String(a.email).localeCompare(String(b.email));
  });

  $("memberManageList").innerHTML = members.length
    ? members.map((member) => {
        const pending = member.canRead !== true;
        const name = String(member.displayName || "").trim();
        return `<div class="manage-row" data-member-row="${escapeHtml(member.email)}">
          <div class="manage-main">
            <div class="member-title-line"><strong>${escapeHtml(name || member.email)}</strong><span class="permission-state ${pending ? "pending" : "active"}">${pending ? "승인 대기" : "활성"}</span></div>
            <small>${name ? `${escapeHtml(member.email)} · ` : ""}${pending ? "로그인 후 자동 등록된 계정" : "권한이 허용된 계정"}</small>
          </div>
          <div class="manage-actions">
            <span class="member-permissions">
              <label><input type="checkbox" data-member-read ${member.canRead === true ? "checked" : ""}> 열람</label>
              <label><input type="checkbox" data-member-write ${member.canWrite === true ? "checked" : ""}> 편집</label>
            </span>
            <button class="button" type="button" data-member-save="${escapeHtml(member.email)}">저장</button>
            <button class="button button-danger" type="button" data-member-delete="${escapeHtml(member.email)}">삭제</button>
          </div>
        </div>`;
      }).join("")
    : '<div class="empty-state">아직 로그인한 사용자가 없습니다.</div>';

  $("memberManageList").querySelectorAll("[data-member-save]").forEach((button) => {
    button.addEventListener("click", () => saveExistingMember(button.dataset.memberSave));
  });
  $("memberManageList").querySelectorAll("[data-member-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteMember(button.dataset.memberDelete));
  });
}

function bindManagementActions() {
  $("categoryManageList").querySelectorAll("[data-category-up]").forEach((button) => button.addEventListener("click", () => moveCategory(button.dataset.categoryUp, -1)));
  $("categoryManageList").querySelectorAll("[data-category-down]").forEach((button) => button.addEventListener("click", () => moveCategory(button.dataset.categoryDown, 1)));
  $("categoryManageList").querySelectorAll("[data-category-rename]").forEach((button) => button.addEventListener("click", () => renameCategory(button.dataset.categoryRename)));
  $("categoryManageList").querySelectorAll("[data-category-delete]").forEach((button) => button.addEventListener("click", () => deleteCategory(button.dataset.categoryDelete)));
}

async function saveNewMember(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const email = normalizeEmail($("memberEmail").value);
  let canRead = $("memberCanRead").checked;
  const canWrite = $("memberCanWrite").checked;
  if (canWrite) canRead = true;
  if (!email || isOwnerEmail(email)) {
    notify("관리자 계정은 별도로 등록하지 않아도 됩니다.", true);
    return;
  }

  try {
    await setDoc(doc(db, "members", email), {
      canRead,
      canWrite,
      status: canRead ? "active" : "pending",
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    }, { merge: true });
    $("memberEmail").value = "";
    $("memberCanRead").checked = true;
    $("memberCanWrite").checked = false;
    notify("사용자 권한을 저장했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function saveExistingMember(email) {
  if (!isAdmin()) return;
  const row = [...$("memberManageList").querySelectorAll("[data-member-row]")]
    .find((item) => item.dataset.memberRow === email);
  if (!row) return;
  const writeCheckbox = row.querySelector("[data-member-write]");
  const readCheckbox = row.querySelector("[data-member-read]");
  const canWrite = writeCheckbox.checked;
  const canRead = canWrite ? true : readCheckbox.checked;
  if (canWrite) readCheckbox.checked = true;

  try {
    await setDoc(doc(db, "members", email), {
      canRead,
      canWrite,
      status: canRead ? "active" : "pending",
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    }, { merge: true });
    notify("사용자 권한을 변경했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function deleteMember(email) {
  if (!isAdmin() || !window.confirm(`${email} 사용자의 권한을 삭제할까요?`)) return;
  try {
    await deleteDoc(doc(db, "members", email));
    notify("사용자 권한을 삭제했습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

async function seedData() {
  if (!isAdmin() || state.categories.length || state.tasks.length) return;
  if (!window.confirm("행사 준비용 기본 카테고리와 항목을 만들까요?")) return;

  const samples = [
    { name: "행사 기획", tasks: ["행사 목적 및 핵심 목표 확정", "행사명 및 콘셉트 확정", "행사 대상 정의", "예상 참석 인원 산정", "행사 일정 확정", "전체 운영 방향 수립", "성과지표 설정", "내부 승인 및 보고"] },
    { name: "예산 및 계약", tasks: ["전체 예산안 작성", "항목별 예산 배정", "업체 견적 요청", "견적 비교 및 업체 선정", "계약 조건 협의", "계약서 작성 및 검토", "계약금 지급", "최종 정산 계획 수립"] },
    { name: "장소 및 시설", tasks: ["장소 후보 조사", "현장 답사", "행사장 계약", "좌석 배치 계획", "무대 및 접수대 위치 확정", "참가자 동선 설계", "주차 및 교통편 확인", "전력 및 인터넷 환경 확인", "접근성 및 편의시설 확인"] },
    { name: "프로그램 및 진행", tasks: ["전체 프로그램 구성", "세부 시간표 작성", "발표자 및 출연자 섭외", "발표 주제 확정", "사회자 섭외", "사회자 대본 작성", "행사 진행 큐시트 작성", "리허설 일정 확정", "질의응답 방식 결정"] },
    { name: "참가자 및 초청", tasks: ["초청 대상 명단 작성", "초청장 문구 및 디자인 확정", "초청장 발송", "참가 신청 페이지 제작", "개인정보 수집 동의 준비", "신청 현황 관리", "참석 여부 확인", "리마인드 메시지 발송", "명찰 제작"] },
    { name: "홍보 및 콘텐츠", tasks: ["행사 소개 문구 작성", "메인 이미지 제작", "포스터 및 배너 제작", "안내 페이지 제작", "SNS 홍보 일정 수립", "홍보 게시물 제작", "보도자료 작성", "행사장 안내 사인 제작"] },
    { name: "무대·음향·영상", tasks: ["무대 구조 확정", "음향 장비 목록 확인", "마이크 수량 확인", "조명 장비 확인", "LED 화면 또는 빔프로젝터 확인", "발표 자료 통합", "영상 재생 테스트", "예비 케이블 및 어댑터 준비", "녹화 및 중계 여부 확정"] },
    { name: "운영 인력", tasks: ["전체 운영 조직 구성", "담당자별 역할 배정", "현장 책임자 지정", "접수 담당 배정", "무대 진행 담당 배정", "발표자 및 VIP 안내 담당 배정", "안전 담당자 지정", "스태프 연락망 작성", "스태프 사전교육"] },
    { name: "제작물 및 물품", tasks: ["참가자 및 스태프 명찰", "행사 안내 책자", "프로그램 일정표", "좌석표 및 안내 표지판", "경품 및 기념품", "문구류 및 운영 비품", "멀티탭 및 연장선", "구급함 및 비상 물품"] },
    { name: "식음료", tasks: ["식사 제공 여부 결정", "메뉴 선정", "케이터링 업체 선정", "제공 인원 확정", "채식 및 알레르기 수요 확인", "다과 및 음료 수량 산정", "배식 동선 확인", "음식물 쓰레기 처리 계획"] },
    { name: "안전 및 비상 대응", tasks: ["행사장 안전 점검", "비상구 및 소방시설 확인", "최대 수용인원 확인", "안전관리 담당자 지정", "응급환자 대응 절차 마련", "인근 병원 및 응급실 확인", "우천 및 기상 악화 대응", "정전 및 장비 고장 대응", "비상 연락망 작성"] },
    { name: "행사 당일 운영", tasks: ["스태프 출석 확인", "장비 최종 점검", "발표 자료 최종 확인", "안내 표지 및 접수대 세팅", "참가자 접수", "발표자 및 VIP 안내", "프로그램 시간 관리", "현장 사진 및 영상 촬영", "철수 및 물품 회수"] },
    { name: "행사 종료 후", tasks: ["참가자 감사 메시지 발송", "만족도 설문 발송", "설문 결과 취합", "사진 및 영상 정리", "행사 결과 보고서 작성", "업체 대금 지급", "최종 비용 정산", "개선사항 회의", "자료 보관 및 인수인계"] }
  ];

  try {
    const batch = writeBatch(db);
    samples.forEach((sample, categoryIndex) => {
      const categoryRef = doc(collection(db, "categories"));
      batch.set(categoryRef, {
        name: sample.name,
        order: (categoryIndex + 1) * 100,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      });
      sample.tasks.forEach((title, taskIndex) => {
        const taskRef = doc(collection(db, "tasks"));
        batch.set(taskRef, {
          categoryId: categoryRef.id,
          title,
          status: "대기",
          dueDate: "",
          memo: "",
          order: (taskIndex + 1) * 100,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: state.user.uid
        });
      });
    });
    await batch.commit();
    notify("행사 준비 기본 목록을 만들었습니다.");
  } catch (error) {
    notify(firestoreErrorMessage(error), true);
  }
}

function exportExcel() {
  const categories = new Map(state.categories.map((category) => [category.id, category.name]));
  const rows = state.tasks.slice().sort((a, b) => {
    const categoryA = state.categories.findIndex((category) => category.id === a.categoryId);
    const categoryB = state.categories.findIndex((category) => category.id === b.categoryId);
    return categoryA - categoryB || sortByOrder(a, b);
  });

  const xmlRows = [
    ["카테고리", "항목", "담당자", "상태", "마감일", "메모"],
    ...rows.map((task) => [
      categories.get(task.categoryId) || "",
      task.title || "",
      task.assignee || "",
      task.status || "",
      normalizeDueDate(task.dueDate),
      task.memo || ""
    ])
  ].map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="진행현황"><Table>${xmlRows}</Table></Worksheet>
</Workbook>`;

  const blob = new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `프로젝트_진행현황_${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function bindEvent(id, eventName, handler) {
  const element = $(id);
  if (!element) {
    console.warn(`[STATUS BOARD] #${id} 요소가 없습니다. index.html과 app.js가 서로 다른 버전일 수 있습니다.`);
    return false;
  }
  element.addEventListener(eventName, handler);
  return true;
}

function bindStaticEvents() {
  bindEvent("loginBtn", "click", beginGoogleLogin);
  bindEvent("profileLogoutBtn", "click", () => signOut(auth));
  bindEvent("profileButton", "click", (event) => { event.stopPropagation(); toggleProfileMenu(); });
  bindEvent("searchInput", "input", (event) => { state.search = event.target.value; renderBoard(); });
  bindEvent("exportBtn", "click", exportExcel);
  bindEvent("cancelTaskBtn", "click", hideTaskComposer);
  bindEvent("manageBtn", "click", () => { renderManagement(); openDialog("manageDialog"); closeProfileMenu(); });
  bindEvent("permissionBtn", "click", () => { renderPermissions(); openDialog("permissionDialog"); closeProfileMenu(); });
  bindEvent("categoryForm", "submit", addCategory);
  bindEvent("taskForm", "submit", saveTask);
  bindEvent("memberForm", "submit", saveNewMember);
  bindEvent("seedDataBtn", "click", seedData);
  document.querySelectorAll("[data-category-link]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); selectCategory(link.dataset.categoryLink); }));
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));
  document.addEventListener("click", (event) => {
    const wrap = event.target.closest?.(".profile-wrap");
    if (!wrap) closeProfileMenu();
  });
}

async function handleAuthState(user) {
  closeSubscriptions();
  state.user = user;
  state.categories = [];
  state.tasks = [];
  state.members = [];
  state.accessDenied = false;
  state.expandedCategoryIds.clear();
  state.expansionInitialized = false;

  if (!user) {
    state.role = "viewer";
    state.selectedCategoryId = "all";
    closeProfileMenu();
    hideTaskComposer();
    $("appShell").hidden = true;
    $("loginGate").hidden = false;
    $("loginBtn").innerHTML = '<span class="google-mark" aria-hidden="true">G</span>Google로 로그인';
    $("loginStatus").textContent = "로그인할 Google 계정을 선택해 주세요.";
    $("loginError").className = "notice notice-error";
    clearLoginError();
    return;
  }

  $("loginStatus").textContent = "계정 권한을 확인하고 있습니다.";
  try {
    if (isOwnerEmail(user.email)) {
      state.role = "admin";
      $("loginGate").hidden = true;
      $("appShell").hidden = false;
      $("accessNotice").hidden = true;
      clearLoginError();
      renderAccess();
      subscribeToData();
      return;
    }

    await ensurePendingMember(user);
    watchOwnAccess(user);
  } catch (error) {
    state.accessDenied = true;
    $("appShell").hidden = true;
    $("loginGate").hidden = false;
    $("loginBtn").innerHTML = '<span class="google-mark" aria-hidden="true">G</span>다른 계정으로 로그인';
    showLoginError(error.message || firestoreErrorMessage(error));
  }
}

async function boot() {
  document.documentElement.dataset.appReady = "true";
  $("loginStatus").textContent = "Firebase에 연결하고 있습니다.";

  try {
    app = initializeApp(CONFIG.firebase);
    auth = getAuth(app);
    db = getFirestore(app);
    provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await setPersistence(auth, browserLocalPersistence);
    bindStaticEvents();
    await getRedirectResult(auth).catch((error) => {
      if (error) showLoginError(authErrorMessage(error));
    });
    onAuthStateChanged(auth, handleAuthState);
  } catch (error) {
    console.error(error);
    showLoginError(authErrorMessage(error));
  }
}

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
});

boot();
