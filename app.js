import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const taskForm = document.querySelector("#task-form");
const taskInput = document.querySelector("#task-input");
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
const filterButtons = [...document.querySelectorAll(".filter-button")];

const state = {
  tasks: [],
  filter: "all",
  database: null,
  userId: null,
  unsubscribeTasks: null,
};

const iconMarkup = {
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>',
  edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 4.2 3 3M4 16l3.4-.7 8.8-8.8a2.1 2.1 0 0 0-3-3l-8.8 8.8L4 16Z" /><path d="M11.5 5.5 14.5 8.5" /></svg>',
  delete: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4h4v2m2.5 0-.7 10h-7L6 6m2.5 3v4m3-4v4" /></svg>',
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

function showAuthenticationError(error) {
  console.error("Firebase anonymous authentication failed.", error);
  setStatus("Connection error", "error");
  if (error.code === "auth/admin-restricted-operation") {
    showNotice(
      `Enable Anonymous in Firebase Console for project "${firebaseConfig.projectId}": Authentication → Sign-in method → Anonymous. Then reload this page.`,
    );
    return;
  }
  showNotice("Couldn’t connect to Firebase. Check your project config and authentication settings.");
}

function getTasksCollection() {
  if (!state.database || !state.userId) {
    throw new Error("Your tasks are not connected yet. Check your Firebase setup and try again.");
  }

  return collection(state.database, "users", state.userId, "tasks");
}

function getVisibleTasks() {
  if (state.filter === "active") {
    return state.tasks.filter((task) => !task.completed);
  }
  if (state.filter === "completed") {
    return state.tasks.filter((task) => task.completed);
  }
  return state.tasks;
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

  if (state.filter === "active" && state.tasks.length && !activeCount) {
    emptyTitle.textContent = "All caught up";
    emptyCopy.textContent = "You’ve completed everything on your list.";
  } else if (state.filter === "completed" && state.tasks.length && !completedCount) {
    emptyTitle.textContent = "Nothing completed yet";
    emptyCopy.textContent = "Tasks you check off will show up here.";
  } else {
    emptyTitle.textContent = "Nothing on the list yet";
    emptyCopy.textContent = "Add a task above and give your day a little direction.";
  }

  for (const task of visibleTasks) {
    taskList.append(createTaskRow(task));
  }
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

function createTaskRow(task) {
  const row = document.createElement("li");
  row.className = `task-row${task.completed ? " is-completed" : ""}`;

  const checkbox = document.createElement("button");
  checkbox.type = "button";
  checkbox.className = "task-check";
  checkbox.setAttribute("role", "checkbox");
  checkbox.setAttribute("aria-checked", String(task.completed));
  checkbox.setAttribute("aria-label", `${task.completed ? "Mark incomplete" : "Complete"}: ${task.title}`);
  checkbox.innerHTML = task.completed ? iconMarkup.check : "";
  checkbox.addEventListener("click", () => updateTask(task.id, { completed: !task.completed }));

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;

  const actions = document.createElement("div");
  actions.className = "task-actions";
  actions.append(
    createIconButton(`Edit ${task.title}`, iconMarkup.edit, "edit-button", () => startEditing(row, task)),
    createIconButton(`Delete ${task.title}`, iconMarkup.delete, "delete-button", () => removeTask(task.id)),
  );

  row.append(checkbox, title, actions);
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
  } catch (error) {
    console.error("Could not update task.", error);
    showNotice("Couldn’t update that task. Check your connection and try again.");
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

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = taskInput.value.trim();
  if (!title) {
    taskInput.focus();
    return;
  }

  clearNotice();
  taskInput.value = "";
  taskInput.focus();
  try {
    await addDoc(getTasksCollection(), {
      title,
      completed: false,
      createdAt: serverTimestamp(),
    });
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
    const auth = getAuth(firebaseApp);
    state.database = getFirestore(firebaseApp);
    setStatus("Connecting to Firebase…");

    onAuthStateChanged(
      auth,
      (user) => {
        if (!user) {
          void signInAnonymously(auth).catch(showAuthenticationError);
          return;
        }

        state.userId = user.uid;
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
          },
          (error) => {
            console.error("Could not load tasks from Firebase.", error);
            setStatus("Sync error", "error");
            showNotice("Couldn’t load your tasks. Check your Firestore setup and security rules.");
          },
        );
      },
      showAuthenticationError,
    );
  } catch (error) {
    console.error("Could not initialize Firebase.", error);
    setStatus("Setup error", "error");
    showNotice("Couldn’t initialize Firebase. Check the config values in firebase-config.js.");
  }
}
