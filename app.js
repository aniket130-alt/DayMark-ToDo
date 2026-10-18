import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const taskForm = document.querySelector("#task-form");
const taskInput = document.querySelector("#task-input");
const priorityInput = document.querySelector("#priority-input");
const categoryInput = document.querySelector("#category-input");
const dueDateInput = document.querySelector("#due-date-input");
const reminderTimeInput = document.querySelector("#reminder-time-input");
const taskList = document.querySelector("#task-list");
const taskCount = document.querySelector("#task-count");
const taskSummary = document.querySelector("#task-summary");
const remainingCount = document.querySelector("#remaining-count");
const emptyState = document.querySelector("#empty-state");
const emptyTitle = document.querySelector("#empty-title");
const emptyCopy = document.querySelector("#empty-copy");
const notice = document.querySelector("#notice");
const syncStatus = document.querySelector("#sync-status");
const syncStatusText = document.querySelector("#sync-status-text");
const todayLabel = document.querySelector("#today-label");
const searchInput = document.querySelector("#search-input");
const categoryFilter = document.querySelector("#category-filter");
const progressSummary = document.querySelector("#progress-summary");
const progressCount = document.querySelector("#progress-count");
const progressTrack = document.querySelector("#progress-track");
const progressFill = document.querySelector("#progress-fill");
const googleButton = document.querySelector("#google-button");
const googleButtonLabel = document.querySelector("#google-button-label");
const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const filterButtons = [...document.querySelectorAll(".filter-button")];

const state = {
  tasks: [],
  filter: "all",
  search: "",
  category: "all",
  database: null,
  auth: null,
  userId: null,
  unsubscribeTasks: null,
  reminderTimer: null,
};

const iconMarkup = {
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>',
  edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 4.2 3 3M4 16l3.4-.7 8.8-8.8a2.1 2.1 0 0 0-3-3l-8.8 8.8L4 16Z" /><path d="M11.5 5.5 14.5 8.5" /></svg>',
  delete: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4h4v2m2.5 0-.7 10h-7L6 6m2.5 3v4m3-4v4" /></svg>',
  up: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5" /></svg>',
  down: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>',
  drag: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="5" r="1" /><circle cx="13" cy="5" r="1" /><circle cx="7" cy="10" r="1" /><circle cx="13" cy="10" r="1" /><circle cx="7" cy="15" r="1" /><circle cx="13" cy="15" r="1" /></svg>',
};

function setStatus(message, kind = "connecting") {
  syncStatusText.textContent = message;
  syncStatus.classList.toggle("is-connected", kind === "connected");
  syncStatus.classList.toggle("is-error", kind === "error");
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function clearNotice() {
  notice.textContent = "";
  notice.hidden = true;
}

function syncThemeControl() {
  const isDark = document.documentElement.dataset.theme === "dark";
  themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  themeIcon.textContent = isDark ? "☀" : "☾";
  themeToggle.querySelector(".theme-label").textContent = isDark ? "Light mode" : "Dark mode";
}

function announce(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(announce.timeout);
  announce.timeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function showAuthenticationError(error) {
  console.error("Firebase authentication failed.", error);
  setStatus("Connection error", "error");
  if (error.code === "auth/admin-restricted-operation") {
    showNotice(
      `Enable Anonymous in Firebase Console for project "${firebaseConfig.projectId}": Authentication → Sign-in method → Anonymous.`,
    );
    return;
  }
  showNotice("Couldn’t connect to Firebase. Check your project config and authentication settings.");
}

function getTasksCollection(userId = state.userId) {
  if (!state.database || !userId) {
    throw new Error("Your tasks are not connected yet. Check your Firebase setup and try again.");
  }
  return collection(state.database, "users", userId, "tasks");
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function orderedTasks() {
  return [...state.tasks].sort((first, second) => {
    const firstOrder = Number.isFinite(first.sortOrder) ? first.sortOrder : Number.MAX_SAFE_INTEGER;
    const secondOrder = Number.isFinite(second.sortOrder) ? second.sortOrder : Number.MAX_SAFE_INTEGER;
    if (firstOrder !== secondOrder) {
      return firstOrder - secondOrder;
    }
    return (second.createdAt?.seconds ?? 0) - (first.createdAt?.seconds ?? 0);
  });
}

function getVisibleTasks() {
  const search = state.search.trim().toLocaleLowerCase();
  return orderedTasks().filter((task) => {
    const matchesFilter =
      state.filter === "all" ||
      (state.filter === "active" && !task.completed) ||
      (state.filter === "completed" && task.completed);
    const matchesCategory = state.category === "all" || (task.category ?? "Personal") === state.category;
    const matchesSearch = !search || task.title.toLocaleLowerCase().includes(search);
    return matchesFilter && matchesCategory && matchesSearch;
  });
}

function updateProgress() {
  const todayTasks = state.tasks.filter((task) => !task.completed && task.dueDate === localDateString());
  const completedToday = state.tasks.filter((task) => task.completed && task.dueDate === localDateString());
  const total = todayTasks.length + completedToday.length;
  const completed = completedToday.length;
  const percentage = total ? Math.round((completed / total) * 100) : 0;

  progressCount.textContent = `${completed} / ${total}`;
  progressSummary.textContent = total
    ? `${percentage === 100 ? "Everything planned for today is done!" : `${total - completed} ${total - completed === 1 ? "task" : "tasks"} to go today.`}`
    : "Set due dates to plan your day.";
  progressTrack.setAttribute("aria-valuemax", String(total));
  progressTrack.setAttribute("aria-valuenow", String(completed));
  progressFill.style.width = `${percentage}%`;
}

function dueLabel(task) {
  if (!task.dueDate) {
    return null;
  }
  const today = localDateString();
  if (!task.completed && task.dueDate < today) {
    return { text: `Overdue · ${formatDueDate(task.dueDate)}`, className: "due-overdue" };
  }
  if (task.dueDate === today) {
    return { text: "Due today", className: "due-today" };
  }
  return { text: `Due ${formatDueDate(task.dueDate)}`, className: "due-upcoming" };
}

function formatDueDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

function renderTasks() {
  const visibleTasks = getVisibleTasks();
  const completedCount = state.tasks.filter((task) => task.completed).length;
  const activeCount = state.tasks.length - completedCount;

  taskCount.textContent = String(state.tasks.length);
  remainingCount.textContent = `${activeCount} ${activeCount === 1 ? "task" : "tasks"} left`;
  taskSummary.textContent = state.tasks.length
    ? `${completedCount} of ${state.tasks.length} ${state.tasks.length === 1 ? "task" : "tasks"} completed.`
    : "A fresh start, one task at a time.";
  emptyState.hidden = visibleTasks.length > 0;
  taskList.replaceChildren();
  updateProgress();

  if (state.filter === "active" && state.tasks.length && !activeCount) {
    emptyTitle.textContent = "All caught up";
    emptyCopy.textContent = "You’ve completed everything on your list.";
  } else if (state.filter === "completed" && state.tasks.length && !completedCount) {
    emptyTitle.textContent = "Nothing completed yet";
    emptyCopy.textContent = "Tasks you check off will show up here.";
  } else if (state.search || state.category !== "all") {
    emptyTitle.textContent = "No matching tasks";
    emptyCopy.textContent = "Try another search or category.";
  } else {
    emptyTitle.textContent = "Nothing on the list yet";
    emptyCopy.textContent = "Add a task above and give your day a little direction.";
  }

  visibleTasks.forEach((task) => {
    taskList.append(createTaskRow(task));
  });
}

function createIconButton(label, icon, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${className}`;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  button.addEventListener("click", handler);
  return button;
}

function makeTaskSelect(task, field, options, className, label) {
  const select = document.createElement("select");
  select.className = `task-meta-select ${className}`;
  select.setAttribute("aria-label", `${label} for ${task.title}`);
  const currentValue = task[field] ?? options[0].value;
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    option.selected = optionData.value === currentValue;
    select.append(option);
  }
  select.addEventListener("change", () => updateTask(task.id, { [field]: select.value }));
  return select;
}

function createTaskRow(task) {
  const row = document.createElement("li");
  row.className = `task-row${task.completed ? " is-completed" : ""}`;
  row.draggable = false;
  row.dataset.taskId = task.id;
  row.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
  row.addEventListener("dragover", (event) => event.preventDefault());
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain");
    if (draggedId && draggedId !== task.id) {
      void moveTask(draggedId, task.id);
    }
  });

  const checkbox = document.createElement("button");
  checkbox.type = "button";
  checkbox.className = "task-check";
  checkbox.setAttribute("role", "checkbox");
  checkbox.setAttribute("aria-checked", String(task.completed));
  checkbox.setAttribute("aria-label", `${task.completed ? "Mark incomplete" : "Complete"}: ${task.title}`);
  checkbox.innerHTML = task.completed ? iconMarkup.check : "";
  checkbox.addEventListener("click", async () => {
    const completed = !task.completed;
    const saved = await updateTask(task.id, { completed });
    if (completed && saved) {
      row.classList.add("just-completed");
      announce("Nicely done. One more thing off your list!");
    }
  });

  const main = document.createElement("div");
  main.className = "task-main";
  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  const metadata = document.createElement("div");
  metadata.className = "task-metadata";

  const priority = makeTaskSelect(
    task,
    "priority",
    [
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
    `priority-${task.priority ?? "medium"}`,
    "Priority",
  );
  const category = makeTaskSelect(
    task,
    "category",
    [
      { value: "Personal", label: "Personal" },
      { value: "Work", label: "Work" },
      { value: "Study", label: "Study" },
    ],
    "category-badge",
    "Category",
  );
  metadata.append(priority, category);
  const due = dueLabel(task);
  if (due) {
    const dueBadge = document.createElement("span");
    dueBadge.className = `due-badge ${due.className}`;
    dueBadge.textContent = due.text;
    metadata.append(dueBadge);
  }
  if (task.reminderTime) {
    const reminder = document.createElement("span");
    reminder.className = "reminder-badge";
    reminder.textContent = `Reminder ${task.reminderTime}`;
    metadata.append(reminder);
  }
  main.append(title, metadata);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  actions.append(
    createIconButton("Drag to reorder", iconMarkup.drag, "drag-handle", () => {}),
    createIconButton("Move task up", iconMarkup.up, "move-up-button", () => moveTaskBy(task.id, -1)),
    createIconButton("Move task down", iconMarkup.down, "move-down-button", () => moveTaskBy(task.id, 1)),
    createIconButton(`Edit ${task.title}`, iconMarkup.edit, "edit-button", () => startEditing(row, task)),
    createIconButton(`Delete ${task.title}`, iconMarkup.delete, "delete-button", () => removeTask(task.id)),
  );
  const dragHandle = actions.querySelector(".drag-handle");
  dragHandle.draggable = true;
  row.append(checkbox, main, actions);
  return row;
}

function startEditing(row, task) {
  const input = document.createElement("input");
  let saving = false;
  input.className = "edit-input";
  input.type = "text";
  input.value = task.title;
  input.maxLength = 180;
  input.setAttribute("aria-label", `Edit task: ${task.title}`);

  const save = async () => {
    if (saving) {
      return;
    }
    const title = input.value.trim();
    if (!title) {
      showNotice("A task name can’t be empty.");
      input.focus();
      return;
    }
    saving = true;
    if (title !== task.title) {
      await updateTask(task.id, { title });
    }
    if (row.isConnected) {
      renderTasks();
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      renderTasks();
    }
  });
  input.addEventListener("blur", () => {
    if (input.isConnected) {
      void save();
    }
  });

  row.replaceChildren(input);
  input.focus();
  input.select();
}

async function updateTask(taskId, changes) {
  clearNotice();
  try {
    await updateDoc(doc(getTasksCollection(), taskId), changes);
    return true;
  } catch (error) {
    console.error("Could not update task.", error);
    showNotice("Couldn’t update that task. Check your connection and try again.");
    return false;
  }
}

async function moveTask(draggedId, targetId) {
  const items = orderedTasks();
  const fromIndex = items.findIndex((task) => task.id === draggedId);
  const toIndex = items.findIndex((task) => task.id === targetId);
  if (fromIndex < 0 || toIndex < 0) {
    return;
  }
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  await persistOrder(items);
}

async function moveTaskBy(taskId, offset) {
  const items = orderedTasks();
  const index = items.findIndex((task) => task.id === taskId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) {
    return;
  }
  const [moved] = items.splice(index, 1);
  items.splice(targetIndex, 0, moved);
  await persistOrder(items);
}

async function persistOrder(reorderedTasks) {
  try {
    for (let start = 0; start < reorderedTasks.length; start += 400) {
      const batch = writeBatch(state.database);
      const chunk = reorderedTasks.slice(start, start + 400);
      chunk.forEach((task, index) => {
        batch.update(doc(getTasksCollection(), task.id), { sortOrder: start + index });
      });
      await batch.commit();
    }
  } catch (error) {
    console.error("Could not reorder tasks.", error);
    showNotice("Couldn’t save the new task order. Check your connection and try again.");
  }
}

async function removeTask(taskId) {
  clearNotice();
  try {
    await deleteDoc(doc(getTasksCollection(), taskId));
  } catch (error) {
    console.error("Could not delete task.", error);
    showNotice("Couldn’t delete that task. Check your connection and try again.");
  }
}

function reminderKey(task) {
  return `daymark-reminded-${state.userId}-${task.id}-${task.dueDate}-${task.reminderTime}`;
}

function checkReminders() {
  if (!state.userId || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  const now = Date.now();
  for (const task of state.tasks) {
    if (!task.dueDate || !task.reminderTime || task.completed) {
      continue;
    }
    const dueAt = new Date(`${task.dueDate}T${task.reminderTime}:00`).getTime();
    const key = reminderKey(task);
    if (dueAt <= now && now - dueAt < 24 * 60 * 60 * 1000 && !localStorage.getItem(key)) {
      try {
        new Notification("Daymark reminder", {
          body: `${task.title} is due ${task.dueDate === localDateString() ? "today" : "now"}.`,
          tag: key,
        });
        localStorage.setItem(key, "sent");
      } catch (error) {
        console.error("Could not display a task reminder.", error);
        showNotice("Couldn’t display a reminder. Check your browser notification settings.");
      }
    }
  }
}

async function requestReminderPermission() {
  if (!reminderTimeInput.value || !("Notification" in window)) {
    return;
  }
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch (error) {
    console.error("Could not request browser notification permission.", error);
  }
  if (Notification.permission !== "granted") {
    showNotice("Task saved, but browser notifications are blocked. Allow notifications in your browser to receive reminders.");
  }
}

async function migrateAnonymousTasks(sourceTasks, targetUserId) {
  if (!sourceTasks?.size) {
    return;
  }
  const batchLimit = 400;
  for (let start = 0; start < sourceTasks.docs.length; start += batchLimit) {
    const batch = writeBatch(state.database);
    const documents = sourceTasks.docs.slice(start, start + batchLimit);
    for (const taskDocument of documents) {
      batch.set(doc(getTasksCollection(targetUserId), taskDocument.id), taskDocument.data(), { merge: true });
    }
    await batch.commit();
  }
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = taskInput.value.trim();
  if (!title) {
    taskInput.focus();
    return;
  }
  const dueDate = dueDateInput.value;
  const reminderTime = reminderTimeInput.value;
  if (reminderTime && !dueDate) {
    showNotice("Choose a due date before setting a reminder time.");
    dueDateInput.focus();
    return;
  }

  clearNotice();
  taskInput.value = "";
  taskInput.focus();
  await requestReminderPermission();
  const nextOrder = state.tasks.reduce(
    (maximum, task) => Math.max(maximum, Number.isFinite(task.sortOrder) ? task.sortOrder : -1),
    -1,
  ) + 1;
  try {
    await addDoc(getTasksCollection(), {
      title,
      priority: priorityInput.value,
      category: categoryInput.value,
      dueDate: dueDate || null,
      reminderTime: reminderTime || null,
      sortOrder: nextOrder,
      completed: false,
      createdAt: serverTimestamp(),
    });
    reminderTimeInput.value = "";
  } catch (error) {
    console.error("Could not add task.", error);
    showNotice("Couldn’t save that task. Check your Firebase setup and try again.");
    if (!taskInput.value.trim()) {
      taskInput.value = title;
      taskInput.focus();
    }
  }
});

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    for (const filterButton of filterButtons) {
      const isActive = filterButton === button;
      filterButton.classList.toggle("is-active", isActive);
      filterButton.setAttribute("aria-pressed", String(isActive));
    }
    renderTasks();
  });
}

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  renderTasks();
});

categoryFilter.addEventListener("change", () => {
  state.category = categoryFilter.value;
  renderTasks();
});

themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  localStorage.setItem("daymark-theme", isDark ? "dark" : "light");
  syncThemeControl();
});

syncThemeControl();

googleButton.addEventListener("click", async () => {
  if (!state.auth) {
    showNotice("Firebase is not ready yet. Check your project configuration.");
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const currentUser = state.auth.currentUser;
  const anonymousUserId = currentUser?.isAnonymous ? currentUser.uid : null;
  googleButton.disabled = true;
  clearNotice();

  try {
    if (currentUser?.isAnonymous) {
      const anonymousTasks = await getDocs(getTasksCollection(anonymousUserId));
      try {
        await linkWithPopup(currentUser, provider);
        announce("Your tasks are now linked to your Google account.");
      } catch (error) {
        if (error.code !== "auth/credential-already-in-use" && error.code !== "auth/account-exists-with-different-credential") {
          throw error;
        }
        const result = await signInWithPopup(state.auth, provider);
        await migrateAnonymousTasks(anonymousTasks, result.user.uid);
        announce("Your tasks are now available with your Google account.");
      }
    } else {
      await signInWithPopup(state.auth, provider);
    }
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user" && error.code !== "auth/cancelled-popup-request") {
      console.error("Could not sign in with Google.", error);
      showNotice(
        error.code === "auth/unauthorized-domain"
          ? "Add this site’s hostname to Firebase Authentication → Settings → Authorized domains."
          : "Couldn’t connect your Google account. Check Google sign-in settings and try again.",
      );
    }
  } finally {
    googleButton.disabled = !state.auth.currentUser?.isAnonymous;
  }
});

todayLabel.textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date()).toUpperCase();

const hasFirebaseConfig = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.trim().length > 0,
);

if (!hasFirebaseConfig) {
  setStatus("Firebase setup needed", "error");
  showNotice("Add your Firebase web app config to firebase-config.js to start saving tasks.");
} else {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    state.auth = getAuth(firebaseApp);
    state.database = getFirestore(firebaseApp);
    setStatus("Connecting to Firebase…");

    onAuthStateChanged(
      state.auth,
      (user) => {
        if (!user) {
          googleButton.disabled = true;
          void signInAnonymously(state.auth).catch((error) => {
            showAuthenticationError(error);
            googleButton.disabled = false;
          });
          return;
        }

        state.userId = user.uid;
        googleButton.disabled = !user.isAnonymous;
        if (user.isAnonymous) {
          googleButtonLabel.textContent = "Continue with Google";
          googleButton.hidden = false;
        } else {
          googleButtonLabel.textContent = user.displayName || user.email || "Google account connected";
          googleButton.hidden = false;
          googleButton.classList.add("is-signed-in");
          googleButton.disabled = true;
        }
        state.unsubscribeTasks?.();
        const tasksQuery = query(getTasksCollection(), orderBy("createdAt", "desc"));
        state.unsubscribeTasks = onSnapshot(
          tasksQuery,
          (snapshot) => {
            state.tasks = snapshot.docs.map((taskDocument) => ({
              id: taskDocument.id,
              ...taskDocument.data(),
            }));
            clearNotice();
            setStatus("Synced with Firebase", "connected");
            renderTasks();
            checkReminders();
            if (!state.reminderTimer) {
              state.reminderTimer = window.setInterval(checkReminders, 30_000);
            }
          },
          (error) => {
            console.error("Could not load tasks from Firebase.", error);
            setStatus("Sync error", "error");
            showNotice("Couldn’t load your tasks. Check your Firestore setup and security rules.");
          },
        );
      },
      (error) => {
        showAuthenticationError(error);
        googleButton.disabled = false;
      },
    );
  } catch (error) {
    console.error("Could not initialize Firebase.", error);
    setStatus("Setup error", "error");
    showNotice("Couldn’t initialize Firebase. Check the config values in firebase-config.js.");
  }
}
