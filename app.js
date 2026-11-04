
(function () {
  "use strict";

  // ==========================================
  // MY DIARY — APP.JS
  // ==========================================

  const DB_NAME = "MyDiaryDatabase";
  const DB_VERSION = 2;
  const ENTRY_STORE = "entries";
  const VOICE_STORE = "voiceRecordings";

  let db = null;
  let editingId = null;
  let selectedDate = null;
  let calendarDate = new Date();

  let mediaRecorder = null;
  let microphoneStream = null;
  let recordingChunks = [];
  let recordingTimer = null;
  let recordingStartedAt = 0;
  let recordingElapsed = 0;
  let pendingVoiceIds = [];

  const $ = id => document.getElementById(id);

  const dateInput = $("entryDate");
  const titleInput = $("entryTitle");
  const moodInput = $("entryMood");
  const textInput = $("entryText");

  const saveBtn = $("saveBtn");
  const cancelBtn = $("cancelBtn");
  const searchInput = $("searchInput");
  const entriesList = $("entriesList");
  const statusMessage = $("statusMessage");

  const calendarGrid = $("calendarGrid");
  const calendarMonth = $("calendarMonth");
  const selectedDateMessage = $("selectedDateMessage");

  const recordBtn = $("recordBtn");
  const pauseBtn = $("pauseBtn");
  const stopBtn = $("stopBtn");
  const recordingTime = $("recordingTime");
  const recordingStatus = $("recordingStatus");
  const attachVoice = $("attachVoice");
  const pendingVoiceMessage = $("pendingVoiceMessage");
  const voiceList = $("voiceList");

  // ==========================================
  // DATE HELPERS
  // ==========================================

  function localDate() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now - offset).toISOString().slice(0, 10);
  }

  function formatDate(dateString) {
    return new Date(dateString + "T00:00:00")
      .toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric"
      });
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return Date.now().toString(36) +
      Math.random().toString(36).slice(2);
  }

  $("todayDate").textContent =
    new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

  dateInput.value = localDate();

  // ==========================================
  // DATABASE
  // Existing entries store is NOT deleted.
  // ==========================================

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const database = event.target.result;

        if (!database.objectStoreNames.contains(ENTRY_STORE)) {
          database.createObjectStore(ENTRY_STORE, {
            keyPath: "id"
          });
        }

        if (!database.objectStoreNames.contains(VOICE_STORE)) {
          database.createObjectStore(VOICE_STORE, {
            keyPath: "id"
          });
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error);
      };

      request.onblocked = function () {
        console.warn(
          "Database upgrade blocked. Close other tabs using this diary."
        );
      };
    });
  }

  function saveEntry(entry) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ENTRY_STORE,
        "readwrite"
      );

      transaction.objectStore(ENTRY_STORE).put(entry);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function getEntries() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ENTRY_STORE,
        "readonly"
      );

      const request =
        transaction.objectStore(ENTRY_STORE).getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function deleteEntry(id) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ENTRY_STORE,
        "readwrite"
      );

      transaction.objectStore(ENTRY_STORE).delete(id);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ==========================================
  // VOICE DATABASE
  // ==========================================

  function saveVoice(recording) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        VOICE_STORE,
        "readwrite"
      );

      transaction.objectStore(VOICE_STORE).put(recording);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function getVoiceRecordings() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        VOICE_STORE,
        "readonly"
      );

      const request =
        transaction.objectStore(VOICE_STORE).getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function updateVoiceEntryId(id, entryId) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        VOICE_STORE,
        "readwrite"
      );

      const store = transaction.objectStore(VOICE_STORE);
      const request = store.get(id);

      request.onsuccess = function () {
        const recording = request.result;

        if (recording) {
          recording.entryId = entryId;
          store.put(recording);
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function deleteVoice(id) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        VOICE_STORE,
        "readwrite"
      );

      transaction.objectStore(VOICE_STORE).delete(id);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ==========================================
  // THEMES
  // ==========================================

  function setTheme(theme) {
    const allowed = [
      "rose",
      "sage",
      "lavender",
      "midnight"
    ];

    if (!allowed.includes(theme)) {
      theme = "rose";
    }

    document.body.dataset.theme = theme;

    try {
      localStorage.setItem("myDiaryTheme", theme);
    } catch (error) {
      console.warn("Could not save theme preference.");
    }

    document.querySelectorAll("[data-theme-choice]")
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.themeChoice === theme
        );
      });

    $("themeMessage").textContent =
      "Theme changed successfully ♡";
  }

  document.querySelectorAll("[data-theme-choice]")
    .forEach(button => {
      button.addEventListener("click", function () {
        setTheme(this.dataset.themeChoice);
      });
    });

  try {
    setTheme(localStorage.getItem("myDiaryTheme") || "rose");
  } catch (error) {
    setTheme("rose");
  }

  // ==========================================
  // DIARY FORM
  // ==========================================

  function resetForm() {
    editingId = null;
    pendingVoiceIds = [];

    dateInput.value = localDate();
    titleInput.value = "";
    moodInput.value = "Happy";
    textInput.value = "";

    saveBtn.textContent = "Save My Memories ♡";
    cancelBtn.classList.add("hidden");

    pendingVoiceMessage.textContent = "";
  }

  saveBtn.addEventListener("click", async function () {
    const content = textInput.value.trim();
    const title = titleInput.value.trim();

    if (!content) {
      statusMessage.textContent =
        "Please write something before saving ♡";
      return;
    }

    if (!dateInput.value) {
      statusMessage.textContent = "Please select a date.";
      return;
    }

    saveBtn.disabled = true;

    const entryId = editingId || makeId();

    const entry = {
      id: entryId,
      date: dateInput.value,
      title: title || "Untitled Memory",
      mood: moodInput.value,
      content: content,
      updatedAt: Date.now()
    };

    try {
      await saveEntry(entry);

      for (const voiceId of pendingVoiceIds) {
        await updateVoiceEntryId(voiceId, entryId);
      }

      statusMessage.textContent =
        editingId ? "Memory updated ♡" : "Memory saved ♡";

      resetForm();

      await renderEntries();
      await renderCalendar();
      await renderVoiceList();

    } catch (error) {
      console.error(error);
      statusMessage.textContent =
        "Unable to save. Please try again.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener("click", function () {
    if (mediaRecorder &&
        mediaRecorder.state !== "inactive") {
      recordingStatus.textContent =
        "Stop recording before cancelling.";
      return;
    }

    resetForm();
    statusMessage.textContent = "";
  });

  // ==========================================
  // VOICE RECORDER
  // ==========================================

  function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;

    return String(minutes).padStart(2, "0") +
      ":" + String(remaining).padStart(2, "0");
  }

  function currentElapsed() {
    if (mediaRecorder &&
        mediaRecorder.state === "recording") {
      return recordingElapsed +
        (Date.now() - recordingStartedAt);
    }

    return recordingElapsed;
  }

  function updateClock() {
    recordingTime.textContent =
      formatDuration(currentElapsed());
  }

  function stopMicrophone() {
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => track.stop());
      microphoneStream = null;
    }
  }

  function resetRecorderControls() {
    recordBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;

    pauseBtn.textContent = "Pause";
    mediaRecorder = null;
    recordingChunks = [];
  }

  recordBtn.addEventListener("click", async function () {
    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia ||
        !window.MediaRecorder) {
      recordingStatus.textContent =
        "Recording is unavailable here. Try Chrome using HTTPS.";
      return;
    }

    recordBtn.disabled = true;

    try {
      microphoneStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true
        });

      recordingChunks = [];
      recordingElapsed = 0;
      recordingTime.textContent = "00:00";

      let options = {};

      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        options.mimeType = "audio/mp4";
      }

      mediaRecorder = new MediaRecorder(
        microphoneStream,
        options
      );

      mediaRecorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) {
          recordingChunks.push(event.data);
        }
      };

      mediaRecorder.onerror = function (event) {
        console.error(event.error);
        recordingStatus.textContent =
          "Recording failed. Please try again.";
        stopMicrophone();
        clearInterval(recordingTimer);
        recordingTimer = null;
        resetRecorderControls();
      };

      mediaRecorder.onstop = async function () {
        clearInterval(recordingTimer);
        recordingTimer = null;

        stopMicrophone();

        const duration = recordingElapsed;
        const blob = new Blob(recordingChunks, {
          type: mediaRecorder.mimeType || "audio/webm"
        });

        if (!blob.size) {
          recordingStatus.textContent =
            "No audio captured. Please try again.";
          resetRecorderControls();
          return;
        }

        const recording = {
          id: makeId(),
          blob: blob,
          mimeType: blob.type,
          createdAt: Date.now(),
          date: dateInput.value || localDate(),
          entryId: null,
          duration: duration
        };

        try {
          await saveVoice(recording);

          if (attachVoice.checked) {
            if (editingId) {
              await updateVoiceEntryId(
                recording.id,
                editingId
              );
            } else {
              pendingVoiceIds.push(recording.id);
            }
          }

          recordingStatus.textContent =
            "Voice memory saved successfully ♡";

          pendingVoiceMessage.textContent =
            pendingVoiceIds.length
              ? pendingVoiceIds.length +
                " recording(s) will attach when you save this entry."
              : "";

          await renderVoiceList();

        } catch (error) {
          console.error(error);
          recordingStatus.textContent =
            "Could not save recording.";
        }

        resetRecorderControls();
      };

      mediaRecorder.start();
      recordingStartedAt = Date.now();

      recordingTimer = setInterval(updateClock, 500);

      pauseBtn.disabled = false;
      stopBtn.disabled = false;

      recordingStatus.textContent =
        "Recording in progress...";

    } catch (error) {
      console.error(error);
      stopMicrophone();

      recordingStatus.textContent =
        "Microphone permission denied or unavailable. Allow microphone access and try again.";

      resetRecorderControls();
    }
  });

  pauseBtn.addEventListener("click", function () {
    if (!mediaRecorder) return;

    if (mediaRecorder.state === "recording") {
      recordingElapsed += Date.now() - recordingStartedAt;

      mediaRecorder.pause();

      clearInterval(recordingTimer);
      recordingTimer = null;

      updateClock();

      pauseBtn.textContent = "Resume";
      recordingStatus.textContent = "Recording paused.";

    } else if (mediaRecorder.state === "paused") {
      mediaRecorder.resume();

      recordingStartedAt = Date.now();

      recordingTimer = setInterval(updateClock, 500);

      pauseBtn.textContent = "Pause";
      recordingStatus.textContent = "Recording resumed...";
    }
  });

  stopBtn.addEventListener("click", function () {
    if (!mediaRecorder ||
        mediaRecorder.state === "inactive") return;

    if (mediaRecorder.state === "recording") {
      recordingElapsed += Date.now() - recordingStartedAt;
    }

    clearInterval(recordingTimer);
    recordingTimer = null;

    updateClock();

    stopBtn.disabled = true;
    pauseBtn.disabled = true;

    recordingStatus.textContent =
      "Saving your voice memory...";

    mediaRecorder.stop();
  });

  // ==========================================
  // VOICE MEMORIES DISPLAY
  // ==========================================

  async function renderVoiceList() {
    const recordings = await getVoiceRecordings();

    recordings.sort((a, b) => b.createdAt - a.createdAt);

    voiceList.replaceChildren();

    if (!recordings.length) {
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent =
        "Your voice memories will appear here ♡";
      voiceList.appendChild(empty);
      return;
    }

    recordings.forEach(recording => {
      const item = document.createElement("article");
      item.className = "voice-item";

      const heading = document.createElement("h3");
      heading.textContent = "Voice Memory ♡";

      const meta = document.createElement("small");
      meta.textContent =
        formatDate(recording.date) +
        " · " +
        formatDuration(recording.duration || 0);

      const attachment = document.createElement("p");
      attachment.className = "small-message";
      attachment.textContent = recording.entryId
        ? "Attached to a diary entry"
        : "Separate voice memory";

      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "none";

      const audioURL = URL.createObjectURL(recording.blob);
      audio.src = audioURL;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-btn";
      remove.textContent = "Delete Recording";

      remove.addEventListener("click", async function () {
        if (!confirm("Delete this recording permanently?")) return;

        try {
          await deleteVoice(recording.id);

          pendingVoiceIds =
            pendingVoiceIds.filter(id => id !== recording.id);

          URL.revokeObjectURL(audioURL);

          await renderVoiceList();

          pendingVoiceMessage.textContent =
            pendingVoiceIds.length
              ? pendingVoiceIds.length +
                " recording(s) waiting to be attached."
              : "";

          recordingStatus.textContent =
            "Recording deleted.";

        } catch (error) {
          console.error(error);
          recordingStatus.textContent =
            "Could not delete recording.";
        }
      });

      item.append(
        heading,
        meta,
        attachment,
        audio,
        remove
      );

      voiceList.appendChild(item);
    });
  }

  // ==========================================
  // CALENDAR
  // ==========================================

  async function renderCalendar() {
    const entries = await getEntries();

    const dates = new Set(
      entries.map(entry => entry.date)
    );

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    calendarMonth.textContent =
      calendarDate.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric"
      });

    calendarGrid.replaceChildren();

    const weekdays = [
      "SUN", "MON", "TUE", "WED",
      "THU", "FRI", "SAT"
    ];

    weekdays.forEach(day => {
      const heading = document.createElement("div");
      heading.className = "calendar-day weekday";
      heading.textContent = day;
      calendarGrid.appendChild(heading);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      calendarGrid.appendChild(document.createElement("div"));
    }

    for (let day = 1; day <= totalDays; day++) {
      const date =
        year + "-" +
        String(month + 1).padStart(2, "0") + "-" +
        String(day).padStart(2, "0");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";

      const number = document.createElement("span");
      number.textContent = day;
      button.appendChild(number);

      if (dates.has(date)) {
        button.classList.add("has-entry");

        const heart = document.createElement("span");
        heart.className = "calendar-heart";
        heart.textContent = "♥";
        button.appendChild(heart);
      }

      if (date === localDate()) {
        button.classList.add("today");
      }

      if (date === selectedDate) {
        button.classList.add("selected");
      }

      button.addEventListener("click", function () {
        selectedDate =
          selectedDate === date ? null : date;

        selectedDateMessage.textContent = selectedDate
          ? "Showing memories from " + formatDate(selectedDate)
          : "Showing all memories";

        renderCalendar();
        renderEntries();
      });

      calendarGrid.appendChild(button);
    }

    if (!selectedDate) {
      selectedDateMessage.textContent = "Showing all memories";
    }
  }

  $("prevMonth").addEventListener("click", function () {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });

  $("nextMonth").addEventListener("click", function () {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });

  $("clearDateFilter").addEventListener("click", function () {
    selectedDate = null;
    selectedDateMessage.textContent = "Showing all memories";

    renderCalendar();
    renderEntries();
  });

  // ==========================================
  // WRITTEN MEMORIES
  // ==========================================

  async function renderEntries() {
    const entries = await getEntries();

    const search = searchInput.value.toLowerCase().trim();

    const filtered = entries
      .filter(entry => {
        const values = [
          entry.title,
          entry.content,
          entry.mood,
          entry.date
        ];

        const matchesSearch = values.some(value =>
          String(value || "").toLowerCase().includes(search)
        );

        const matchesDate =
          !selectedDate || entry.date === selectedDate;

        return matchesSearch && matchesDate;
      })
      .sort((a, b) =>
        b.date.localeCompare(a.date) ||
        (b.updatedAt || 0) - (a.updatedAt || 0)
      );

    entriesList.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "empty-message";

      empty.textContent = selectedDate
        ? "No memories on this date ♡"
        : search
          ? "No matching memories found ♡"
          : "Your memories will appear here ♡";

      entriesList.appendChild(empty);
      return;
    }

    filtered.forEach(entry => {
      const card = document.createElement("article");
      card.className = "entry";

      const heading = document.createElement("h3");
      heading.textContent = entry.title || "Untitled Memory";

      const meta = document.createElement("small");
      meta.textContent =
        entry.date + " · " + (entry.mood || "No mood");

      const content = document.createElement("p");
      content.textContent = entry.content || "";

      const actions = document.createElement("div");
      actions.className = "entry-actions";

      const edit = document.createElement("button");
      edit.className = "edit-btn";
      edit.textContent = "Edit";

      edit.addEventListener("click", function () {
        if (mediaRecorder &&
            mediaRecorder.state !== "inactive") {
          recordingStatus.textContent =
            "Stop the current recording before editing.";
          return;
        }

        editingId = entry.id;
        pendingVoiceIds = [];

        dateInput.value = entry.date;
        titleInput.value = entry.title || "";
        moodInput.value = entry.mood || "Happy";
        textInput.value = entry.content || "";

        saveBtn.textContent = "Update Memory ♡";
        cancelBtn.classList.remove("hidden");

        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      });

      const remove = document.createElement("button");
      remove.className = "delete-btn";
      remove.textContent = "Delete";

      remove.addEventListener("click", async function () {
        if (!confirm("Delete this diary entry permanently?")) return;

        try {
          await deleteEntry(entry.id);

          const recordings = await getVoiceRecordings();

          for (const recording of recordings) {
            if (recording.entryId === entry.id) {
              await updateVoiceEntryId(recording.id, null);
            }
          }

          await renderEntries();
          await renderCalendar();
          await renderVoiceList();

          statusMessage.textContent =
            "Entry deleted. Its voice recordings remain saved separately.";

        } catch (error) {
          console.error(error);
          statusMessage.textContent =
            "Could not delete this entry.";
        }
      });

      actions.append(edit, remove);
      card.append(heading, meta, content, actions);

      entriesList.appendChild(card);
    });
  }

  searchInput.addEventListener("input", renderEntries);

  // ==========================================
  // START APPLICATION
  // ==========================================

  async function startApp() {
    try {
      db = await openDatabase();

      await renderEntries();
      await renderCalendar();
      await renderVoiceList();

      console.log("My Diary started successfully.");

    } catch (error) {
      console.error("My Diary startup error:", error);

      statusMessage.textContent =
        "Database error. Please send me a screenshot of the console error.";
    }
  }

  startApp();

})();
