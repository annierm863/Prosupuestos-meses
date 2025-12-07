// ============= CONFIGURACIÓN DE FIREBASE =============
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDeXU4-D6zFaZ0fVjHWg3jSr05sSwuXbWE",
  authDomain: "presupuesto-personal-f734e.firebaseapp.com",
  projectId: "presupuesto-personal-f734e",
  storageBucket: "presupuesto-personal-f734e.firebasestorage.app",
  messagingSenderId: "954801265396",
  appId: "1:954801265396:web:63fbdca8cee8c920585ca1",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.auth = auth;
window.db = db;
window.firestore = {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
};

// ============= ESTADO GLOBAL =============
let currentUser = null;
let currentWeek = null;
let selectedMonth = null;
let editingItem = null;
let editingType = null;

// ============= CACHÉ LOCAL =============
const cache = {
  weeks: null,
  incomes: {},
  expenses: {},
  workExpenses: {},
  goals: null,
  monthlyData: {},
  cacheTimestamp: {},
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutos

  get(key, subKey = null) {
    const cacheKey = subKey ? `${key}_${subKey}` : key;
    const cached = this[cacheKey];
    const timestamp = this.cacheTimestamp[cacheKey];

    if (cached && timestamp && Date.now() - timestamp < this.CACHE_DURATION) {
      return cached;
    }
    return null;
  },

  set(key, value, subKey = null) {
    const cacheKey = subKey ? `${key}_${subKey}` : key;
    this[cacheKey] = value;
    this.cacheTimestamp[cacheKey] = Date.now();
  },

  clear(key = null) {
    if (key) {
      this[key] = null;
      this.cacheTimestamp[key] = null;
    } else {
      // Limpiar todo el caché
      Object.keys(this).forEach((k) => {
        if (k !== "CACHE_DURATION" && k !== "cacheTimestamp") {
          this[k] = k.includes("cache") ? {} : null;
        }
      });
      this.cacheTimestamp = {};
    }
  },
};

// ============= FUNCIONES DE LOADING =============
function showLoading(message = "Cargando datos...") {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    const messageEl = overlay.querySelector("p");
    if (messageEl) messageEl.textContent = message;
    overlay.style.display = "flex";
  }
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    overlay.style.display = "none";
  }
}

// ============= FUNCIONES DE MENSAJES =============
function showMessage(message, type = "info") {
  // Crear elemento de mensaje si no existe
  let messageContainer = document.getElementById("globalMessage");
  if (!messageContainer) {
    messageContainer = document.createElement("div");
    messageContainer.id = "globalMessage";
    messageContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      max-width: 400px;
      animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(messageContainer);
  }

  const colors = {
    success: { bg: "#d4edda", color: "#155724", border: "#28a745" },
    warning: { bg: "#fff3cd", color: "#856404", border: "#ffc107" },
    error: { bg: "#f8d7da", color: "#721c24", border: "#dc3545" },
    info: { bg: "#d1ecf1", color: "#0c5460", border: "#17a2b8" },
  };

  const style = colors[type] || colors.info;
  messageContainer.style.cssText += `
    background: ${style.bg};
    color: ${style.color};
    border-left: 4px solid ${style.border};
  `;
  messageContainer.textContent = message;
  messageContainer.style.display = "block";

  setTimeout(() => {
    messageContainer.style.display = "none";
  }, 5000);
}

// ============= VALIDACIÓN DE FECHAS =============
function validateDateInWeekRange(dateString, week) {
  if (!week) {
    return { valid: false, error: "No hay semana activa" };
  }

  const errors = validateDateRange(dateString, week.startDate, week.endDate, "La fecha");
  return {
    valid: errors.length === 0,
    error: errors.length > 0 ? errors.join(", ") : null,
  };
}

function validateDateRange(dateString, startDate, endDate, fieldName = "Fecha") {
  const errors = [];

  if (!dateString) {
    errors.push(`${fieldName} es requerida`);
    return errors;
  }

  const date = new Date(dateString);
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Validar formato de fecha
  if (isNaN(date.getTime())) {
    errors.push(`${fieldName} no es una fecha válida`);
    return errors;
  }

  // Validar rango
  date.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (date < start) {
    errors.push(`${fieldName} no puede ser anterior a ${formatDate(startDate)}`);
  }

  if (date > end) {
    errors.push(`${fieldName} no puede ser posterior a ${formatDate(endDate)}`);
  }

  return errors;
}

function validateForm(formData, validations) {
  const errors = [];

  for (const [field, rules] of Object.entries(validations)) {
    const value = formData[field];

    if (rules.required && (!value || value.toString().trim() === "")) {
      errors.push(`${rules.label || field} es requerido`);
    }

    if (value && rules.min && parseFloat(value) < rules.min) {
      errors.push(`${rules.label || field} debe ser mayor a ${rules.min}`);
    }

    if (value && rules.max && parseFloat(value) > rules.max) {
      errors.push(`${rules.label || field} debe ser menor a ${rules.max}`);
    }

    if (value && rules.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push(`${rules.label || field} debe ser un email válido`);
    }

    if (value && rules.type === "date") {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        errors.push(`${rules.label || field} debe ser una fecha válida`);
      }
    }
  }

  return errors;
}

// ============= OBSERVADOR DE AUTENTICACIÓN =============
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("authScreen").style.display = "none";
    document.getElementById("mainApp").style.display = "block";
    document.getElementById("userEmail").textContent = user.email;
    initApp();
  } else {
    currentUser = null;
    cache.clear(); // Limpiar caché al cerrar sesión
    document.getElementById("authScreen").style.display = "flex";
    document.getElementById("mainApp").style.display = "none";
  }
});

// ============= FUNCIONES DE AUTENTICACIÓN =============
window.register = async function () {
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;

  const errors = validateForm(
    { email, password },
    {
      email: { required: true, type: "email", label: "Email" },
      password: { required: true, min: 6, label: "Contraseña" },
    }
  );

  if (errors.length > 0) {
    showAuthMessage(errors.join(", "), "warning");
    return;
  }

  try {
    showLoading("Creando cuenta...");
    await createUserWithEmailAndPassword(auth, email, password);
    showAuthMessage("¡Cuenta creada exitosamente!", "success");
  } catch (error) {
    showAuthMessage("Error: " + getSpanishError(error.code), "warning");
  } finally {
    hideLoading();
  }
};

window.login = async function () {
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;

  const errors = validateForm(
    { email, password },
    {
      email: { required: true, type: "email", label: "Email" },
      password: { required: true, label: "Contraseña" },
    }
  );

  if (errors.length > 0) {
    showAuthMessage(errors.join(", "), "warning");
    return;
  }

  try {
    showLoading("Iniciando sesión...");
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showAuthMessage("Error: " + getSpanishError(error.code), "warning");
  } finally {
    hideLoading();
  }
};

window.logout = async function () {
  if (confirm("¿Estás seguro que deseas cerrar sesión?")) {
    try {
      showLoading("Cerrando sesión...");
      await signOut(auth);
      cache.clear();
    } finally {
      hideLoading();
    }
  }
};

function showAuthMessage(message, type) {
  const messageDiv = document.getElementById("authMessage");
  messageDiv.className = `alert alert-${type}`;
  messageDiv.textContent = message;
  messageDiv.style.display = "block";
  setTimeout(() => {
    messageDiv.style.display = "none";
  }, 5000);
}

function getSpanishError(errorCode) {
  const errors = {
    "auth/email-already-in-use": "Este email ya está registrado",
    "auth/invalid-email": "Email inválido",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres",
    "auth/user-not-found": "Usuario no encontrado",
    "auth/wrong-password": "Contraseña incorrecta",
    "auth/too-many-requests": "Demasiados intentos. Intenta más tarde",
    "auth/network-request-failed": "Error de conexión. Verifica tu internet",
    "auth/internal-error": "Error interno del servidor. Intenta más tarde",
  };
  return errors[errorCode] || "Error desconocido: " + errorCode;
}

// ============= INICIALIZACIÓN =============
async function initApp() {
  try {
    showLoading("Cargando aplicación...");
    await loadWeeks();
    generateMonthGrid();
    setDefaultDates();
    await updateDashboard();
    await loadGoals();
  } catch (error) {
    showMessage("Error al inicializar la aplicación: " + error.message, "error");
    console.error("Error en initApp:", error);
  } finally {
    hideLoading();
  }
}

function setDefaultDates() {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("incomeDate").value = today;
  document.getElementById("programmedDate").value = today;
  document.getElementById("unprogrammedDate").value = today;
  document.getElementById("workDate").value = today;
  document.getElementById("weekStartDate").value = today;
  document.getElementById("weekEndDate").value = today;
}

// ============= GESTIÓN DE SEMANAS =============
window.createWeek = async function () {
  const name = document.getElementById("weekName").value;
  const startDate = document.getElementById("weekStartDate").value;
  const endDate = document.getElementById("weekEndDate").value;

  const errors = validateForm(
    { name, startDate, endDate },
    {
      name: { required: true, label: "Nombre de la semana" },
      startDate: { required: true, type: "date", label: "Fecha de inicio" },
      endDate: { required: true, type: "date", label: "Fecha de fin" },
    }
  );

  if (errors.length > 0) {
    showMessage(errors.join(", "), "warning");
    return;
  }

  if (new Date(endDate) < new Date(startDate)) {
    showMessage("La fecha de fin debe ser posterior a la fecha de inicio", "warning");
    return;
  }

  try {
    showLoading("Creando semana...");
    const weekData = {
      userId: currentUser.uid,
      name: name.trim(),
      startDate: startDate,
      endDate: endDate,
      createdAt: Timestamp.now(),
    };

    await addDoc(collection(db, "weeks"), weekData);
    cache.clear("weeks");
    document.getElementById("weekName").value = "";
    await loadWeeks();
    updateDashboard();
    showMessage("✅ Semana creada exitosamente", "success");
  } catch (error) {
    showMessage("Error al crear semana: " + error.message, "error");
    console.error("Error en createWeek:", error);
  } finally {
    hideLoading();
  }
};

async function loadWeeks() {
  // Verificar caché
  const cached = cache.get("weeks");
  if (cached) {
    displayWeeks(cached);
    if (cached.length > 0 && !currentWeek) {
      currentWeek = cached[0];
    }
    return;
  }

  try {
    const q = query(
      collection(db, "weeks"),
      where("userId", "==", currentUser.uid),
      orderBy("startDate", "desc")
    );
    const snapshot = await getDocs(q);
    const weeks = [];

    snapshot.forEach((doc) => {
      weeks.push({ id: doc.id, ...doc.data() });
    });

    cache.set("weeks", weeks);
    displayWeeks(weeks);

    // Seleccionar la semana más reciente como activa
    if (weeks.length > 0 && !currentWeek) {
      currentWeek = weeks[0];
    }
  } catch (error) {
    showMessage("Error al cargar semanas: " + error.message, "error");
    console.error("Error en loadWeeks:", error);
  }
}

function displayWeeks(weeks) {
  const container = document.getElementById("weeksList");

  if (weeks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <p>No hay semanas creadas aún</p>
      </div>
    `;
    return;
  }

  container.innerHTML = weeks
    .map(
      (week) => `
      <div class="list-item" style="--item-color: #667eea;" onclick="selectWeek('${week.id}')">
        <div class="list-item-info">
          <div class="list-item-title">${week.name}</div>
          <div class="list-item-details">
            ${formatDate(week.startDate)} - ${formatDate(week.endDate)}
          </div>
        </div>
        <div class="list-item-actions">
          ${
            currentWeek && currentWeek.id === week.id
              ? '<span style="color: #667eea; font-weight: bold;">✓ Activa</span>'
              : '<button class="btn-small btn-success" onclick="event.stopPropagation(); selectWeek(\'' +
                week.id +
                "')\">Activar</button>"
          }
          <button class="btn-small btn-danger" onclick="event.stopPropagation(); deleteWeek('${week.id}')">🗑️</button>
        </div>
      </div>
    `
    )
    .join("");
}

window.selectWeek = async function (weekId) {
  try {
    showLoading("Cargando semana...");
    const q = query(
      collection(db, "weeks"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);

    snapshot.forEach((doc) => {
      if (doc.id === weekId) {
        currentWeek = { id: doc.id, ...doc.data() };
        cache.clear("incomes");
        cache.clear("expenses");
        cache.clear("workExpenses");
      }
    });

    await loadWeeks();
    await updateDashboard();
    showMessage("✅ Semana activada: " + currentWeek.name, "success");
  } catch (error) {
    showMessage("Error al seleccionar semana: " + error.message, "error");
    console.error("Error en selectWeek:", error);
  } finally {
    hideLoading();
  }
};

window.deleteWeek = async function (weekId) {
  if (!confirm("¿Estás seguro de eliminar esta semana?")) return;

  try {
    showLoading("Eliminando semana...");
    await deleteDoc(doc(db, "weeks", weekId));

    if (currentWeek && currentWeek.id === weekId) {
      currentWeek = null;
    }

    cache.clear("weeks");
    await loadWeeks();
    await updateDashboard();
    showMessage("✅ Semana eliminada", "success");
  } catch (error) {
    showMessage("Error al eliminar semana: " + error.message, "error");
    console.error("Error en deleteWeek:", error);
  } finally {
    hideLoading();
  }
};

// ============= GESTIÓN DE INGRESOS =============
window.toggleIncomeCategory = function () {
  const type = document.getElementById("incomeType").value;
  const categoryGroup = document.getElementById("incomeCategoryGroup");

  if (type === "Salario") {
    categoryGroup.style.display = "none";
  } else {
    categoryGroup.style.display = "block";
  }
};

window.addIncome = async function () {
  if (!currentWeek) {
    showMessage("⚠️ Primero debes crear y activar una semana", "warning");
    return;
  }

  const type = document.getElementById("incomeType").value;
  const description =
    type === "Salario"
      ? "Salario"
      : document.getElementById("incomeDescription").value;
  const amount = parseFloat(document.getElementById("incomeAmount").value);
  const date = document.getElementById("incomeDate").value;

  const errors = validateForm(
    { amount, date },
    {
      amount: { required: true, min: 0.01, label: "Monto" },
      date: { required: true, type: "date", label: "Fecha" },
    }
  );

  if (type !== "Salario" && !description?.trim()) {
    errors.push("La descripción es requerida para este tipo de ingreso");
  }

  const dateValidation = validateDateInWeekRange(date, currentWeek);
  if (!dateValidation.valid) {
    errors.push(dateValidation.error);
  }

  if (errors.length > 0) {
    showMessage(errors.join(", "), "warning");
    return;
  }

  try {
    showLoading("Guardando ingreso...");
    const incomeData = {
      userId: currentUser.uid,
      weekId: currentWeek.id,
      type: type,
      description: description?.trim() || "Salario",
      amount: amount,
      date: date,
      createdAt: Timestamp.now(),
    };

    if (editingItem && editingType === "income") {
      await updateDoc(doc(db, "incomes", editingItem), incomeData);
      showMessage("✅ Ingreso actualizado", "success");
      cancelEditIncome();
    } else {
      await addDoc(collection(db, "incomes"), incomeData);
      showMessage("✅ Ingreso registrado", "success");
    }

    cache.clear("incomes", currentWeek.id);
    document.getElementById("incomeType").value = "Salario";
    document.getElementById("incomeDescription").value = "";
    document.getElementById("incomeAmount").value = "";

    await loadIncomes();
    await updateDashboard();
  } catch (error) {
    showMessage("Error al guardar ingreso: " + error.message, "error");
    console.error("Error en addIncome:", error);
  } finally {
    hideLoading();
  }
};

async function loadIncomes() {
  if (!currentWeek) return;

  // Verificar caché
  const cached = cache.get("incomes", currentWeek.id);
  if (cached) {
    displayIncomes(cached);
    return;
  }

  try {
    const q = query(
      collection(db, "incomes"),
      where("userId", "==", currentUser.uid),
      where("weekId", "==", currentWeek.id)
    );
    const snapshot = await getDocs(q);
    const incomes = [];

    snapshot.forEach((doc) => {
      incomes.push({ id: doc.id, ...doc.data() });
    });

    incomes.sort((a, b) => new Date(b.date) - new Date(a.date));
    cache.set("incomes", incomes, currentWeek.id);
    displayIncomes(incomes);
  } catch (error) {
    showMessage("Error al cargar ingresos: " + error.message, "error");
    console.error("Error en loadIncomes:", error);
  }
}

function displayIncomes(incomes) {
  const container = document.getElementById("incomeList");

  if (incomes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💵</div>
        <p>No hay ingresos registrados aún</p>
      </div>
    `;
    return;
  }

  container.innerHTML = incomes
    .map(
      (income) => `
      <div class="list-item" style="--item-color: #4ade80;">
        <div class="list-item-info">
          <div class="list-item-title">${income.type}${
        income.description && income.type !== "Salario"
          ? " - " + income.description
          : ""
      }</div>
          <div class="list-item-details">📅 ${formatDate(income.date)}</div>
        </div>
        <div class="list-item-amount">$${income.amount.toFixed(2)}</div>
        <div class="list-item-actions">
          <button class="btn-small btn-success" onclick="editIncome('${income.id}', ${JSON.stringify(income).replace(/"/g, "&quot;")})">✏️</button>
          <button class="btn-small btn-danger" onclick="deleteIncome('${income.id}')">🗑️</button>
        </div>
      </div>
    `
    )
    .join("");
}

window.editIncome = function (id, income) {
  editingItem = id;
  editingType = "income";

  document.getElementById("incomeType").value = income.type;
  document.getElementById("incomeDescription").value = income.description || "";
  document.getElementById("incomeAmount").value = income.amount;
  document.getElementById("incomeDate").value = income.date;

  document.getElementById("cancelEditIncome").style.display = "block";
  toggleIncomeCategory();

  document
    .getElementById("income")
    .scrollIntoView({ behavior: "smooth", block: "start" });
};

window.cancelEditIncome = function () {
  editingItem = null;
  editingType = null;
  document.getElementById("incomeType").value = "Salario";
  document.getElementById("incomeDescription").value = "";
  document.getElementById("incomeAmount").value = "";
  document.getElementById("cancelEditIncome").style.display = "none";
};

window.deleteIncome = async function (id) {
  if (!confirm("¿Estás seguro de eliminar este ingreso?")) return;

  try {
    showLoading("Eliminando ingreso...");
    await deleteDoc(doc(db, "incomes", id));
    cache.clear("incomes", currentWeek.id);
    await loadIncomes();
    await updateDashboard();
    showMessage("✅ Ingreso eliminado", "success");
  } catch (error) {
    showMessage("Error al eliminar ingreso: " + error.message, "error");
    console.error("Error en deleteIncome:", error);
  } finally {
    hideLoading();
  }
};

// ============= GESTIÓN DE GASTOS PROGRAMADOS =============
window.addProgrammedExpense = async function () {
  if (!currentWeek) {
    showMessage("⚠️ Primero debes crear y activar una semana", "warning");
    return;
  }

  const description = document.getElementById("programmedDescription").value;
  const amount = parseFloat(document.getElementById("programmedAmount").value);
  const category = document.getElementById("programmedCategory").value;
  const date = document.getElementById("programmedDate").value;

  const errors = validateForm(
    { description, amount, date },
    {
      description: { required: true, label: "Descripción" },
      amount: { required: true, min: 0.01, label: "Monto" },
      date: { required: true, type: "date", label: "Fecha" },
    }
  );

  const dateValidation = validateDateInWeekRange(date, currentWeek);
  if (!dateValidation.valid) {
    errors.push(dateValidation.error);
  }

  if (errors.length > 0) {
    showMessage(errors.join(", "), "warning");
    return;
  }

  try {
    showLoading("Guardando gasto programado...");
    const expenseData = {
      userId: currentUser.uid,
      weekId: currentWeek.id,
      type: "programmed",
      description: description.trim(),
      amount: amount,
      category: category,
      date: date,
      createdAt: Timestamp.now(),
    };

    if (editingItem && editingType === "programmed") {
      await updateDoc(doc(db, "expenses", editingItem), expenseData);
      showMessage("✅ Gasto actualizado", "success");
      cancelEditProgrammed();
    } else {
      await addDoc(collection(db, "expenses"), expenseData);
      showMessage("✅ Gasto programado registrado", "success");
    }

    cache.clear("expenses", currentWeek.id);
    document.getElementById("programmedDescription").value = "";
    document.getElementById("programmedAmount").value = "";

    await loadExpenses();
    await updateDashboard();
  } catch (error) {
    showMessage("Error al guardar gasto: " + error.message, "error");
    console.error("Error en addProgrammedExpense:", error);
  } finally {
    hideLoading();
  }
};

window.editProgrammed = function (id, expense) {
  editingItem = id;
  editingType = "programmed";

  document.getElementById("programmedDescription").value = expense.description;
  document.getElementById("programmedAmount").value = expense.amount;
  document.getElementById("programmedCategory").value = expense.category;
  document.getElementById("programmedDate").value = expense.date;

  document.getElementById("cancelEditProgrammed").style.display = "block";
  showSubTab("programmed");
  showTab("expenses");
};

window.cancelEditProgrammed = function () {
  editingItem = null;
  editingType = null;
  document.getElementById("programmedDescription").value = "";
  document.getElementById("programmedAmount").value = "";
  document.getElementById("cancelEditProgrammed").style.display = "none";
};

// ============= GESTIÓN DE GASTOS NO PROGRAMADOS =============
window.addUnprogrammedExpense = async function () {
  if (!currentWeek) {
    showMessage("⚠️ Primero debes crear y activar una semana", "warning");
    return;
  }

  const description = document.getElementById("unprogrammedDescription").value;
  const amount = parseFloat(document.getElementById("unprogrammedAmount").value);
  const category = document.getElementById("unprogrammedCategory").value;
  const comment = document.getElementById("unprogrammedComment").value;
  const date = document.getElementById("unprogrammedDate").value;

  const errors = validateForm(
    { description, amount, date },
    {
      description: { required: true, label: "Descripción" },
      amount: { required: true, min: 0.01, label: "Monto" },
      date: { required: true, type: "date", label: "Fecha" },
    }
  );

  const dateValidation = validateDateInWeekRange(date, currentWeek);
  if (!dateValidation.valid) {
    errors.push(dateValidation.error);
  }

  if (errors.length > 0) {
    showMessage(errors.join(", "), "warning");
    return;
  }

  try {
    showLoading("Guardando gasto no programado...");
    const expenseData = {
      userId: currentUser.uid,
      weekId: currentWeek.id,
      type: "unprogrammed",
      description: description.trim(),
      amount: amount,
      category: category,
      comment: comment?.trim() || "",
      date: date,
      createdAt: Timestamp.now(),
    };

    if (editingItem && editingType === "unprogrammed") {
      await updateDoc(doc(db, "expenses", editingItem), expenseData);
      showMessage("✅ Gasto actualizado", "success");
      cancelEditUnprogrammed();
    } else {
      await addDoc(collection(db, "expenses"), expenseData);
      showMessage("✅ Gasto no programado registrado", "success");
    }

    cache.clear("expenses", currentWeek.id);
    document.getElementById("unprogrammedDescription").value = "";
    document.getElementById("unprogrammedAmount").value = "";
    document.getElementById("unprogrammedComment").value = "";

    await loadExpenses();
    await updateDashboard();
  } catch (error) {
    showMessage("Error al guardar gasto: " + error.message, "error");
    console.error("Error en addUnprogrammedExpense:", error);
  } finally {
    hideLoading();
  }
};

window.editUnprogrammed = function (id, expense) {
  editingItem = id;
  editingType = "unprogrammed";

  document.getElementById("unprogrammedDescription").value = expense.description;
  document.getElementById("unprogrammedAmount").value = expense.amount;
  document.getElementById("unprogrammedCategory").value = expense.category;
  document.getElementById("unprogrammedComment").value = expense.comment || "";
  document.getElementById("unprogrammedDate").value = expense.date;

  document.getElementById("cancelEditUnprogrammed").style.display = "block";
  showSubTab("unprogrammed");
  showTab("expenses");
};

window.cancelEditUnprogrammed = function () {
  editingItem = null;
  editingType = null;
  document.getElementById("unprogrammedDescription").value = "";
  document.getElementById("unprogrammedAmount").value = "";
  document.getElementById("unprogrammedComment").value = "";
  document.getElementById("cancelEditUnprogrammed").style.display = "none";
};

async function loadExpenses() {
  if (!currentWeek) return;

  // Verificar caché
  const cached = cache.get("expenses", currentWeek.id);
  if (cached) {
    const programmed = cached.filter((e) => e.type === "programmed").sort((a, b) => new Date(b.date) - new Date(a.date));
    const unprogrammed = cached.filter((e) => e.type === "unprogrammed").sort((a, b) => new Date(b.date) - new Date(a.date));
    displayProgrammedExpenses(programmed);
    displayUnprogrammedExpenses(unprogrammed);
    return;
  }

  try {
    const q = query(
      collection(db, "expenses"),
      where("userId", "==", currentUser.uid),
      where("weekId", "==", currentWeek.id)
    );
    const snapshot = await getDocs(q);
    const expenses = [];

    snapshot.forEach((doc) => {
      expenses.push({ id: doc.id, ...doc.data() });
    });

    cache.set("expenses", expenses, currentWeek.id);
    const programmed = expenses.filter((e) => e.type === "programmed").sort((a, b) => new Date(b.date) - new Date(a.date));
    const unprogrammed = expenses.filter((e) => e.type === "unprogrammed").sort((a, b) => new Date(b.date) - new Date(a.date));

    displayProgrammedExpenses(programmed);
    displayUnprogrammedExpenses(unprogrammed);
  } catch (error) {
    showMessage("Error al cargar gastos: " + error.message, "error");
    console.error("Error en loadExpenses:", error);
  }
}

function displayProgrammedExpenses(expenses) {
  const container = document.getElementById("programmedList");

  if (expenses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p>No hay gastos programados registrados</p>
      </div>
    `;
    return;
  }

  container.innerHTML = expenses
    .map(
      (expense) => `
      <div class="list-item" style="--item-color: #f59e0b;">
        <div class="list-item-info">
          <div class="list-item-title">${expense.description}</div>
          <div class="list-item-details">
            ${getCategoryEmoji(expense.category)} ${expense.category} • 📅 ${formatDate(expense.date)}
          </div>
        </div>
        <div class="list-item-amount">$${expense.amount.toFixed(2)}</div>
        <div class="list-item-actions">
          <button class="btn-small btn-success" onclick="editProgrammed('${expense.id}', ${JSON.stringify(expense).replace(/"/g, "&quot;")})">✏️</button>
          <button class="btn-small btn-danger" onclick="deleteExpense('${expense.id}')">🗑️</button>
        </div>
      </div>
    `
    )
    .join("");
}

function displayUnprogrammedExpenses(expenses) {
  const container = document.getElementById("unprogrammedList");

  if (expenses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚡</div>
        <p>No hay gastos no programados registrados</p>
      </div>
    `;
    return;
  }

  container.innerHTML = expenses
    .map(
      (expense) => `
      <div class="list-item" style="--item-color: #ef4444;">
        <div class="list-item-info">
          <div class="list-item-title">⚡ ${expense.description}</div>
          <div class="list-item-details">
            ${getCategoryEmoji(expense.category)} ${expense.category} • 📅 ${formatDate(expense.date)}
            ${expense.comment ? "<br>💬 " + expense.comment : ""}
          </div>
        </div>
        <div class="list-item-amount">$${expense.amount.toFixed(2)}</div>
        <div class="list-item-actions">
          <button class="btn-small btn-success" onclick="editUnprogrammed('${expense.id}', ${JSON.stringify(expense).replace(/"/g, "&quot;")})">✏️</button>
          <button class="btn-small btn-danger" onclick="deleteExpense('${expense.id}')">🗑️</button>
        </div>
      </div>
    `
    )
    .join("");
}

window.deleteExpense = async function (id) {
  if (!confirm("¿Estás seguro de eliminar este gasto?")) return;

  try {
    showLoading("Eliminando gasto...");
    await deleteDoc(doc(db, "expenses", id));
    cache.clear("expenses", currentWeek.id);
    await loadExpenses();
    await updateDashboard();
    showMessage("✅ Gasto eliminado", "success");
  } catch (error) {
    showMessage("Error al eliminar gasto: " + error.message, "error");
    console.error("Error en deleteExpense:", error);
  } finally {
    hideLoading();
  }
};

// ============= GESTIÓN DE GASTOS DE TRABAJO =============
window.addWorkExpense = async function () {
  if (!currentWeek) {
    showMessage("⚠️ Primero debes crear y activar una semana", "warning");
    return;
  }

  const type = document.getElementById("workType").value;
  const amount = parseFloat(document.getElementById("workAmount").value);
  const description = document.getElementById("workDescription").value;
  const date = document.getElementById("workDate").value;

  const errors = validateForm(
    { amount, date },
    {
      amount: { required: true, min: 0.01, label: "Monto" },
      date: { required: true, type: "date", label: "Fecha" },
    }
  );

  const dateValidation = validateDateInWeekRange(date, currentWeek);
  if (!dateValidation.valid) {
    errors.push(dateValidation.error);
  }

  if (errors.length > 0) {
    showMessage(errors.join(", "), "warning");
    return;
  }

  try {
    showLoading("Guardando gasto de trabajo...");
    const workData = {
      userId: currentUser.uid,
      weekId: currentWeek.id,
      type: type,
      amount: amount,
      description: description?.trim() || "",
      date: date,
      createdAt: Timestamp.now(),
    };

    if (editingItem && editingType === "work") {
      await updateDoc(doc(db, "workExpenses", editingItem), workData);
      showMessage("✅ Gasto de trabajo actualizado", "success");
      cancelEditWork();
    } else {
      await addDoc(collection(db, "workExpenses"), workData);
      showMessage("✅ Gasto de trabajo registrado", "success");
    }

    cache.clear("workExpenses", currentWeek.id);
    document.getElementById("workAmount").value = "";
    document.getElementById("workDescription").value = "";

    await loadWorkExpenses();
    await updateDashboard();
  } catch (error) {
    showMessage("Error al guardar gasto de trabajo: " + error.message, "error");
    console.error("Error en addWorkExpense:", error);
  } finally {
    hideLoading();
  }
};

async function loadWorkExpenses() {
  if (!currentWeek) return;

  // Verificar caché
  const cached = cache.get("workExpenses", currentWeek.id);
  if (cached) {
    displayWorkExpenses(cached);
    return;
  }

  try {
    const q = query(
      collection(db, "workExpenses"),
      where("userId", "==", currentUser.uid),
      where("weekId", "==", currentWeek.id)
    );
    const snapshot = await getDocs(q);
    const expenses = [];

    snapshot.forEach((doc) => {
      expenses.push({ id: doc.id, ...doc.data() });
    });

    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    cache.set("workExpenses", expenses, currentWeek.id);
    displayWorkExpenses(expenses);
  } catch (error) {
    showMessage("Error al cargar gastos de trabajo: " + error.message, "error");
    console.error("Error en loadWorkExpenses:", error);
  }
}

function displayWorkExpenses(expenses) {
  const container = document.getElementById("workList");

  if (expenses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🚗</div>
        <p>No hay gastos de trabajo registrados</p>
      </div>
    `;
    return;
  }

  container.innerHTML = expenses
    .map(
      (expense) => `
      <div class="list-item" style="--item-color: #8b5cf6;">
        <div class="list-item-info">
          <div class="list-item-title">${expense.type === "Gasolina" ? "⛽" : "🍔"} ${expense.type}</div>
          <div class="list-item-details">
            ${expense.description} • 📅 ${formatDate(expense.date)}
          </div>
        </div>
        <div class="list-item-amount">$${expense.amount.toFixed(2)}</div>
        <div class="list-item-actions">
          <button class="btn-small btn-success" onclick="editWork('${expense.id}', ${JSON.stringify(expense).replace(/"/g, "&quot;")})">✏️</button>
          <button class="btn-small btn-danger" onclick="deleteWorkExpense('${expense.id}')">🗑️</button>
        </div>
      </div>
    `
    )
    .join("");
}

window.editWork = function (id, expense) {
  editingItem = id;
  editingType = "work";

  document.getElementById("workType").value = expense.type;
  document.getElementById("workAmount").value = expense.amount;
  document.getElementById("workDescription").value = expense.description;
  document.getElementById("workDate").value = expense.date;

  document.getElementById("cancelEditWork").style.display = "block";
  showTab("work-expenses");
};

window.cancelEditWork = function () {
  editingItem = null;
  editingType = null;
  document.getElementById("workAmount").value = "";
  document.getElementById("workDescription").value = "";
  document.getElementById("cancelEditWork").style.display = "none";
};

window.deleteWorkExpense = async function (id) {
  if (!confirm("¿Estás seguro de eliminar este gasto de trabajo?")) return;

  try {
    showLoading("Eliminando gasto de trabajo...");
    await deleteDoc(doc(db, "workExpenses", id));
    cache.clear("workExpenses", currentWeek.id);
    await loadWorkExpenses();
    await updateDashboard();
    showMessage("✅ Gasto de trabajo eliminado", "success");
  } catch (error) {
    showMessage("Error al eliminar gasto de trabajo: " + error.message, "error");
    console.error("Error en deleteWorkExpense:", error);
  } finally {
    hideLoading();
  }
};

// ============= DASHBOARD Y CÁLCULOS =============
async function updateDashboard() {
  if (!currentWeek) {
    document.getElementById("weekInfo").innerHTML =
      '⚠️ No hay semana activa. Ve a la pestaña "Semanas" para crear una.';
    document.getElementById("dashboardCards").innerHTML = "";
    return;
  }

  document.getElementById("weekInfo").innerHTML = `
    📅 Semana Activa: <strong>${currentWeek.name}</strong><br>
    📆 ${formatDate(currentWeek.startDate)} - ${formatDate(currentWeek.endDate)}
  `;

  try {
    // Cargar todos los datos
    const incomes = await getWeekData("incomes", currentWeek.id);
    const expenses = await getWeekData("expenses", currentWeek.id);
    const workExpenses = await getWeekData("workExpenses", currentWeek.id);

    // Calcular totales
    const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
    const programmedExpenses = expenses.filter((e) => e.type === "programmed");
    const unprogrammedExpenses = expenses.filter((e) => e.type === "unprogrammed");

    const totalProgrammed = programmedExpenses.reduce((sum, e) => sum + e.amount, 0);
    const totalUnprogrammed = unprogrammedExpenses.reduce((sum, e) => sum + e.amount, 0);
    const totalWork = workExpenses.reduce((sum, e) => sum + e.amount, 0);
    const totalExpenses = totalProgrammed + totalUnprogrammed + totalWork;

    const balance = totalIncome - totalExpenses;
    const debtPayment = balance > 0 ? balance * 0.6 : 0;
    const freeMoney = balance > 0 ? balance * 0.4 : 0;

    // Mostrar tarjetas
    const cards = [
      {
        title: "Total Ingresos",
        value: `$${totalIncome.toFixed(2)}`,
        color1: "#4ade80",
        color2: "#22c55e",
        click: "showIncomeDetail",
      },
      {
        title: "Gastos Totales",
        value: `$${totalExpenses.toFixed(2)}`,
        color1: "#ef4444",
        color2: "#dc2626",
        click: "showExpenseDetail",
      },
      {
        title: "Gastos Programados",
        value: `$${totalProgrammed.toFixed(2)}`,
        subtitle: `${programmedExpenses.length} gastos`,
        color1: "#f59e0b",
        color2: "#d97706",
        click: "showProgrammedDetail",
      },
      {
        title: "Gastos No Programados",
        value: `$${totalUnprogrammed.toFixed(2)}`,
        subtitle: `${unprogrammedExpenses.length} gastos`,
        color1: "#ef4444",
        color2: "#dc2626",
        click: "showUnprogrammedDetail",
      },
      {
        title: "Gastos de Trabajo",
        value: `$${totalWork.toFixed(2)}`,
        subtitle: `${workExpenses.length} gastos`,
        color1: "#8b5cf6",
        color2: "#7c3aed",
        click: "showWorkDetail",
      },
      {
        title: "Balance Final",
        value: `$${balance.toFixed(2)}`,
        color1: balance >= 0 ? "#10b981" : "#ef4444",
        color2: balance >= 0 ? "#059669" : "#dc2626",
      },
      {
        title: "Pago a Deuda (60%)",
        value: `$${debtPayment.toFixed(2)}`,
        subtitle: `Dinero libre: $${freeMoney.toFixed(2)}`,
        color1: "#3b82f6",
        color2: "#2563eb",
        click: "showDebtDetail",
      },
    ];

    document.getElementById("dashboardCards").innerHTML = cards
      .map(
        (card) => `
        <div class="card" style="--color1: ${card.color1}; --color2: ${card.color2};" ${card.click ? `onclick="${card.click}()"` : ""}>
          <div class="card-title">${card.title}</div>
          <div class="card-value">${card.value}</div>
          ${card.subtitle ? `<div class="card-subtitle">${card.subtitle}</div>` : ""}
        </div>
      `
      )
      .join("");

    // Calcular salud financiera
    updateFinancialHealth(totalIncome, totalExpenses, totalUnprogrammed, debtPayment);

    // Crear gráficos
    try {
      const chartData = {
        totalIncome,
        totalProgrammed,
        totalUnprogrammed,
        totalWork,
      };
      createDashboardChart(chartData);

      // Gráfico de gastos por categoría
      const categoryMap = {};
      expenses.forEach((e) => {
        categoryMap[e.category] = (categoryMap[e.category] || 0) + e.amount;
      });
      const categories = Object.keys(categoryMap);
      const amounts = Object.values(categoryMap);
      if (categories.length > 0) {
        createExpensesChart({ categories, amounts });
      }
    } catch (chartError) {
      console.error("Error al crear gráficos:", chartError);
    }

    // Recargar listas
    await loadIncomes();
    await loadExpenses();
    await loadWorkExpenses();
  } catch (error) {
    const errorMessage = handleError(error, "updateDashboard");
    showMessage(errorMessage, "error");
    console.error("Error en updateDashboard:", error);
  }
}

function updateFinancialHealth(income, expenses, unprogrammed, debtPayment) {
  if (income === 0) {
    document.getElementById("healthIndicators").innerHTML =
      "<p>Registra tus ingresos para ver indicadores</p>";
    return;
  }

  const savingsRate = (((income - expenses) / income) * 100).toFixed(1);
  const expenseRatio = ((expenses / income) * 100).toFixed(1);
  const unprogrammedRatio = ((unprogrammed / expenses) * 100).toFixed(1);

  let healthStatus = "🟢 Excelente";
  let healthColor = "#4ade80";

  if (expenseRatio > 90) {
    healthStatus = "🔴 Crítico";
    healthColor = "#ef4444";
  } else if (expenseRatio > 70) {
    healthStatus = "🟡 Mejorable";
    healthColor = "#f59e0b";
  }

  document.getElementById("healthIndicators").innerHTML = `
    <div class="health-indicator">
      <span class="health-label">Estado General:</span>
      <span class="health-value" style="color: ${healthColor};">${healthStatus}</span>
    </div>
    <div class="health-indicator">
      <span class="health-label">Tasa de Ahorro:</span>
      <span class="health-value">${savingsRate}%</span>
    </div>
    <div class="health-indicator">
      <span class="health-label">Gastos vs Ingresos:</span>
      <span class="health-value">${expenseRatio}%</span>
    </div>
    <div class="health-indicator">
      <span class="health-label">Gastos No Programados:</span>
      <span class="health-value">${unprogrammedRatio}% del total</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${Math.min(savingsRate, 100)}%;"></div>
    </div>
    ${
      unprogrammedRatio > 30
        ? '<div class="alert alert-warning" style="margin-top:10px;">⚠️ Tus gastos no programados son altos. Intenta reducirlos.</div>'
        : ""
    }
  `;
}

async function getWeekData(collection_name, weekId) {
  // Verificar caché
  const cacheKey = collection_name === "incomes" ? "incomes" : collection_name === "expenses" ? "expenses" : "workExpenses";
  const cached = cache.get(cacheKey, weekId);
  if (cached) {
    return cached;
  }

  const q = query(
    collection(db, collection_name),
    where("userId", "==", currentUser.uid),
    where("weekId", "==", weekId)
  );
  const snapshot = await getDocs(q);
  const data = [];
  snapshot.forEach((doc) => {
    data.push({ id: doc.id, ...doc.data() });
  });

  cache.set(cacheKey, data, weekId);
  return data;
}

// ============= MODALES DE DETALLE =============
window.showIncomeDetail = async function () {
  if (!currentWeek) return;
  const incomes = await getWeekData("incomes", currentWeek.id);
  showDetailModal(
    "💵 Detalle de Ingresos",
    incomes.map((i) => ({
      title: i.type,
      description: i.description,
      amount: i.amount,
      date: i.date,
    }))
  );
};

window.showExpenseDetail = async function () {
  if (!currentWeek) return;
  const expenses = await getWeekData("expenses", currentWeek.id);
  showDetailModal(
    "💸 Detalle de Gastos Totales",
    expenses.map((e) => ({
      title: e.description,
      description: `${e.category} • ${e.type === "programmed" ? "📋 Programado" : "⚡ No Programado"}`,
      amount: e.amount,
      date: e.date,
    }))
  );
};

window.showProgrammedDetail = async function () {
  if (!currentWeek) return;
  const expenses = await getWeekData("expenses", currentWeek.id);
  const programmed = expenses.filter((e) => e.type === "programmed");
  showDetailModal(
    "📋 Gastos Programados",
    programmed.map((e) => ({
      title: e.description,
      description: e.category,
      amount: e.amount,
      date: e.date,
    }))
  );
};

window.showUnprogrammedDetail = async function () {
  if (!currentWeek) return;
  const expenses = await getWeekData("expenses", currentWeek.id);
  const unprogrammed = expenses.filter((e) => e.type === "unprogrammed");
  showDetailModal(
    "⚡ Gastos No Programados",
    unprogrammed.map((e) => ({
      title: e.description,
      description: e.category + (e.comment ? " • " + e.comment : ""),
      amount: e.amount,
      date: e.date,
    }))
  );
};

window.showWorkDetail = async function () {
  if (!currentWeek) return;
  const work = await getWeekData("workExpenses", currentWeek.id);
  showDetailModal(
    "🚗 Gastos de Trabajo",
    work.map((w) => ({
      title: w.type,
      description: w.description,
      amount: w.amount,
      date: w.date,
    }))
  );
};

window.showDebtDetail = async function () {
  if (!currentWeek) return;
  const incomes = await getWeekData("incomes", currentWeek.id);
  const expenses = await getWeekData("expenses", currentWeek.id);
  const workExpenses = await getWeekData("workExpenses", currentWeek.id);

  const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
  const totalExpenses =
    expenses.reduce((sum, e) => sum + e.amount, 0) +
    workExpenses.reduce((sum, w) => sum + w.amount, 0);
  const balance = totalIncome - totalExpenses;
  const debtPayment = balance > 0 ? balance * 0.6 : 0;
  const freeMoney = balance > 0 ? balance * 0.4 : 0;

  const content = `
    <div style="padding: 20px; background: #f8f9fa; border-radius: 10px;">
      <h4>Cálculo de Pago a Deuda</h4>
      <div style="margin: 15px 0;">
        <div class="health-indicator">
          <span class="health-label">Balance Total:</span>
          <span class="health-value">$${balance.toFixed(2)}</span>
        </div>
        <div class="health-indicator">
          <span class="health-label">60% para Deuda:</span>
          <span class="health-value" style="color: #3b82f6;">$${debtPayment.toFixed(2)}</span>
        </div>
        <div class="health-indicator">
          <span class="health-label">40% Dinero Libre:</span>
          <span class="health-value" style="color: #4ade80;">$${freeMoney.toFixed(2)}</span>
        </div>
      </div>
      ${
        balance <= 0
          ? '<div class="alert alert-warning">⚠️ No hay balance positivo esta semana</div>'
          : ""
      }
    </div>
  `;

  document.getElementById("modalTitle").textContent = "💰 Pago a Deuda";
  document.getElementById("modalBody").innerHTML = content;
  document.getElementById("detailModal").classList.add("active");
};

function showDetailModal(title, items) {
  if (items.length === 0) {
    document.getElementById("modalBody").innerHTML =
      '<div class="empty-state"><p>No hay datos para mostrar</p></div>';
  } else {
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    document.getElementById("modalBody").innerHTML = `
      <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 10px;">
        <h4>Total: $${total.toFixed(2)}</h4>
        <p style="color: #666; font-size: 14px;">${items.length} registro(s)</p>
      </div>
      ${items
        .map(
          (item) => `
        <div class="list-item" style="--item-color: #667eea;">
          <div class="list-item-info">
            <div class="list-item-title">${item.title}</div>
            <div class="list-item-details">${item.description} • 📅 ${formatDate(item.date)}</div>
          </div>
          <div class="list-item-amount">$${item.amount.toFixed(2)}</div>
        </div>
      `
        )
        .join("")}
    `;
  }

  document.getElementById("modalTitle").textContent = title;
  document.getElementById("detailModal").classList.add("active");
}

window.closeModal = function () {
  document.getElementById("detailModal").classList.remove("active");
};

// ============= RESUMEN MENSUAL (LAZY LOADING) =============
function generateMonthGrid() {
  const months = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

  const currentYear = new Date().getFullYear();

  const grid = document.getElementById("monthGrid");
  grid.innerHTML = months
    .map(
      (month, index) => `
      <div class="month-card" onclick="selectMonth(${index}, ${currentYear})">
        <div class="month-card-name">${month}</div>
        <div class="month-card-year">${currentYear}</div>
      </div>
    `
    )
    .join("");
}

window.selectMonth = async function (monthIndex, year) {
  selectedMonth = { month: monthIndex, year: year };

  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];

  document.getElementById("selectedMonth").textContent = `${monthNames[monthIndex]} ${year}`;
  document.getElementById("monthlyDetails").style.display = "block";

  // Lazy loading: cargar datos solo cuando se selecciona un mes
  await loadMonthlyData(monthIndex, year);
};

async function loadMonthlyData(month, year) {
  // Verificar caché
  const cacheKey = `monthly_${month}_${year}`;
  const cached = cache.get("monthlyData", cacheKey);
  if (cached) {
    document.getElementById("monthlyCards").innerHTML = cached.cardsHTML;
    displayMonthlyWeeks(cached.weeks);
    return;
  }

  try {
    showLoading("Cargando datos mensuales...");
    // Obtener todas las semanas del mes
    const q = query(
      collection(db, "weeks"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const allWeeks = [];

    snapshot.forEach((doc) => {
      const weekData = { id: doc.id, ...doc.data() };
      const weekMonth = new Date(weekData.startDate).getMonth();
      const weekYear = new Date(weekData.startDate).getFullYear();

      if (weekMonth === month && weekYear === year) {
        allWeeks.push(weekData);
      }
    });

    allWeeks.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    // Calcular totales del mes
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalProgrammed = 0;
    let totalUnprogrammed = 0;
    let totalWork = 0;
    let totalDebt = 0;

    for (const week of allWeeks) {
      const incomes = await getWeekData("incomes", week.id);
      const expenses = await getWeekData("expenses", week.id);
      const workExpenses = await getWeekData("workExpenses", week.id);

      const weekIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
      const weekProgrammed = expenses
        .filter((e) => e.type === "programmed")
        .reduce((sum, e) => sum + e.amount, 0);
      const weekUnprogrammed = expenses
        .filter((e) => e.type === "unprogrammed")
        .reduce((sum, e) => sum + e.amount, 0);
      const weekWork = workExpenses.reduce((sum, w) => sum + w.amount, 0);
      const weekExpenses = weekProgrammed + weekUnprogrammed + weekWork;
      const weekBalance = weekIncome - weekExpenses;
      const weekDebt = weekBalance > 0 ? weekBalance * 0.6 : 0;

      totalIncome += weekIncome;
      totalExpenses += weekExpenses;
      totalProgrammed += weekProgrammed;
      totalUnprogrammed += weekUnprogrammed;
      totalWork += weekWork;
      totalDebt += weekDebt;
    }

    const totalBalance = totalIncome - totalExpenses;
    const balanceAfterDebt = totalBalance - totalDebt;

    // Mostrar tarjetas del mes
    const cards = [
      {
        title: "Ingresos del Mes",
        value: `$${totalIncome.toFixed(2)}`,
        color1: "#4ade80",
        color2: "#22c55e",
        click: "showMonthIncomeDetail",
      },
      {
        title: "Gastos del Mes",
        value: `$${totalExpenses.toFixed(2)}`,
        color1: "#ef4444",
        color2: "#dc2626",
        click: "showMonthExpenseDetail",
      },
      {
        title: "Balance del Mes",
        value: `$${totalBalance.toFixed(2)}`,
        color1: totalBalance >= 0 ? "#10b981" : "#ef4444",
        color2: totalBalance >= 0 ? "#059669" : "#dc2626",
      },
      {
        title: "Pago Total a Deuda",
        value: `$${totalDebt.toFixed(2)}`,
        color1: "#3b82f6",
        color2: "#2563eb",
        click: "showMonthDebtDetail",
      },
      {
        title: "Balance Post-Deuda",
        value: `$${balanceAfterDebt.toFixed(2)}`,
        color1: balanceAfterDebt >= 0 ? "#10b981" : "#ef4444",
        color2: balanceAfterDebt >= 0 ? "#059669" : "#dc2626",
      },
      {
        title: "Gastos Programados",
        value: `$${totalProgrammed.toFixed(2)}`,
        color1: "#f59e0b",
        color2: "#d97706",
      },
      {
        title: "Gastos No Programados",
        value: `$${totalUnprogrammed.toFixed(2)}`,
        color1: "#ef4444",
        color2: "#dc2626",
      },
      {
        title: "Gastos de Trabajo",
        value: `$${totalWork.toFixed(2)}`,
        color1: "#8b5cf6",
        color2: "#7c3aed",
      },
    ];

    const cardsHTML = cards
      .map(
        (card) => `
      <div class="card" style="--color1: ${card.color1}; --color2: ${card.color2};" ${card.click ? `onclick="${card.click}()"` : ""}>
        <div class="card-title">${card.title}</div>
        <div class="card-value">${card.value}</div>
      </div>
    `
      )
      .join("");

    document.getElementById("monthlyCards").innerHTML = cardsHTML;

    // Guardar en caché
    cache.set("monthlyData", { cardsHTML, weeks: allWeeks }, cacheKey);

    // Mostrar semanas
    displayMonthlyWeeks(allWeeks);
  } catch (error) {
    showMessage("Error al cargar datos mensuales: " + error.message, "error");
    console.error("Error en loadMonthlyData:", error);
  } finally {
    hideLoading();
  }
}

function displayMonthlyWeeks(weeks) {
  const container = document.getElementById("monthlyWeeks");

  if (weeks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <p>No hay semanas en este mes</p>
      </div>
    `;
    return;
  }

  container.innerHTML = weeks
    .map(
      (week) => `
      <div class="week-card" onclick="showWeekDetail('${week.id}')">
        <div class="week-card-title">${week.name}</div>
        <div class="week-card-dates">${formatDate(week.startDate)} - ${formatDate(week.endDate)}</div>
      </div>
    `
    )
    .join("");
}

window.showWeekDetail = async function (weekId) {
  try {
    showLoading("Cargando detalles de semana...");
    // Obtener datos de la semana
    const q = query(
      collection(db, "weeks"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    let weekData = null;

    snapshot.forEach((doc) => {
      if (doc.id === weekId) {
        weekData = { id: doc.id, ...doc.data() };
      }
    });

    if (!weekData) return;

    const incomes = await getWeekData("incomes", weekId);
    const expenses = await getWeekData("expenses", weekId);
    const workExpenses = await getWeekData("workExpenses", weekId);

    const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
    const programmed = expenses.filter((e) => e.type === "programmed");
    const unprogrammed = expenses.filter((e) => e.type === "unprogrammed");
    const totalProgrammed = programmed.reduce((sum, e) => sum + e.amount, 0);
    const totalUnprogrammed = unprogrammed.reduce((sum, e) => sum + e.amount, 0);
    const totalWork = workExpenses.reduce((sum, w) => sum + w.amount, 0);
    const totalExpenses = totalProgrammed + totalUnprogrammed + totalWork;
    const balance = totalIncome - totalExpenses;
    const debtPayment = balance > 0 ? balance * 0.6 : 0;
    const freeMoney = balance > 0 ? balance * 0.4 : 0;

    const content = `
      <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
        <h4>${weekData.name}</h4>
        <p style="color: #666;">${formatDate(weekData.startDate)} - ${formatDate(weekData.endDate)}</p>
      </div>

      <div class="dashboard-grid" style="margin-bottom: 20px;">
        <div class="card" style="--color1: #4ade80; --color2: #22c55e;">
          <div class="card-title">Ingresos</div>
          <div class="card-value">$${totalIncome.toFixed(2)}</div>
        </div>
        <div class="card" style="--color1: #ef4444; --color2: #dc2626;">
          <div class="card-title">Gastos</div>
          <div class="card-value">$${totalExpenses.toFixed(2)}</div>
        </div>
        <div class="card" style="--color1: ${balance >= 0 ? "#10b981" : "#ef4444"}; --color2: ${balance >= 0 ? "#059669" : "#dc2626"};">
          <div class="card-title">Balance</div>
          <div class="card-value">$${balance.toFixed(2)}</div>
        </div>
        <div class="card" style="--color1: #3b82f6; --color2: #2563eb;">
          <div class="card-title">Pago Deuda</div>
          <div class="card-value">$${debtPayment.toFixed(2)}</div>
          <div class="card-subtitle">Libre: $${freeMoney.toFixed(2)}</div>
        </div>
      </div>

      <h4 style="margin: 20px 0 10px 0;">Desglose de Gastos</h4>
      <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-bottom: 15px;">
        <div class="health-indicator">
          <span class="health-label">📋 Gastos Programados:</span>
          <span class="health-value">$${totalProgrammed.toFixed(2)}</span>
        </div>
        <div class="health-indicator">
          <span class="health-label">⚡ Gastos No Programados:</span>
          <span class="health-value">$${totalUnprogrammed.toFixed(2)}</span>
        </div>
        <div class="health-indicator">
          <span class="health-label">🚗 Gastos de Trabajo:</span>
          <span class="health-value">$${totalWork.toFixed(2)}</span>
        </div>
      </div>

      <h4 style="margin: 20px 0 10px 0;">Transacciones</h4>
      <div style="max-height: 300px; overflow-y: auto;">
        ${[...incomes, ...expenses, ...workExpenses]
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map((item) => {
            const isIncome = incomes.includes(item);
            const isExpense = expenses.includes(item);
            const isWork = workExpenses.includes(item);

            let icon = "💵";
            let color = "#4ade80";
            let title = item.description || item.type;
            let subtitle = formatDate(item.date);

            if (isExpense) {
              icon = item.type === "programmed" ? "📋" : "⚡";
              color = item.type === "programmed" ? "#f59e0b" : "#ef4444";
              subtitle = `${item.category} • ${formatDate(item.date)}`;
            } else if (isWork) {
              icon = item.type === "Gasolina" ? "⛽" : "🍔";
              color = "#8b5cf6";
              subtitle = `${item.description} • ${formatDate(item.date)}`;
            }

            return `
              <div class="list-item" style="--item-color: ${color}; margin-bottom: 10px;">
                <div class="list-item-info">
                  <div class="list-item-title">${icon} ${title}</div>
                  <div class="list-item-details">${subtitle}</div>
                </div>
                <div class="list-item-amount">${isIncome ? "+" : "-"}$${item.amount.toFixed(2)}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    document.getElementById("weekModalTitle").textContent = "Detalle de Semana";
    document.getElementById("weekModalBody").innerHTML = content;
    document.getElementById("weekDetailModal").classList.add("active");
  } catch (error) {
    showMessage("Error al cargar detalles de semana: " + error.message, "error");
    console.error("Error en showWeekDetail:", error);
  } finally {
    hideLoading();
  }
};

window.closeWeekModal = function () {
  document.getElementById("weekDetailModal").classList.remove("active");
};

// Funciones para mostrar detalles mensuales
window.showMonthIncomeDetail = async function () {
  const items = await getMonthTransactions("incomes");
  showDetailModal(
    "💵 Ingresos del Mes",
    items.map((i) => ({
      title: i.type,
      description: i.description,
      amount: i.amount,
      date: i.date,
    }))
  );
};

window.showMonthExpenseDetail = async function () {
  const expenses = await getMonthTransactions("expenses");
  const workExpenses = await getMonthTransactions("workExpenses");
  const all = [...expenses, ...workExpenses];

  showDetailModal(
    "💸 Gastos del Mes",
    all.map((e) => ({
      title: e.description || e.type,
      description: e.category || (e.type === "Gasolina" ? "⛽ Gasolina" : "🍔 Comida"),
      amount: e.amount,
      date: e.date,
    }))
  );
};

window.showMonthDebtDetail = async function () {
  const weeks = await getMonthWeeks();
  let details = [];

  for (const week of weeks) {
    const incomes = await getWeekData("incomes", week.id);
    const expenses = await getWeekData("expenses", week.id);
    const workExpenses = await getWeekData("workExpenses", week.id);

    const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
    const totalExpenses =
      expenses.reduce((sum, e) => sum + e.amount, 0) +
      workExpenses.reduce((sum, w) => sum + w.amount, 0);
    const balance = totalIncome - totalExpenses;
    const debt = balance > 0 ? balance * 0.6 : 0;

    if (debt > 0) {
      details.push({
        title: week.name,
        description: `Balance: $${balance.toFixed(2)}`,
        amount: debt,
        date: week.startDate,
      });
    }
  }

  showDetailModal("💰 Pago a Deuda por Semana", details);
};

async function getMonthTransactions(collection_name) {
  const weeks = await getMonthWeeks();
  let allItems = [];

  for (const week of weeks) {
    const items = await getWeekData(collection_name, week.id);
    allItems = [...allItems, ...items];
  }

  return allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getMonthWeeks() {
  if (!selectedMonth) return [];

  const q = query(
    collection(db, "weeks"),
    where("userId", "==", currentUser.uid)
  );
  const snapshot = await getDocs(q);
  const weeks = [];

  snapshot.forEach((doc) => {
    const weekData = { id: doc.id, ...doc.data() };
    const weekMonth = new Date(weekData.startDate).getMonth();
    const weekYear = new Date(weekData.startDate).getFullYear();

    if (weekMonth === selectedMonth.month && weekYear === selectedMonth.year) {
      weeks.push(weekData);
    }
  });

  return weeks.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

// ============= EXPORTACIÓN =============
window.exportMonthlyPDF = async function () {
  if (!selectedMonth) {
    showMessage("Por favor selecciona un mes primero", "warning");
    return;
  }

  try {
    showLoading("Generando PDF...");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const monthNames = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];
    
    const monthName = monthNames[selectedMonth.month];
    const year = selectedMonth.year;
    
    // Título
    doc.setFontSize(20);
    doc.text(`Presupuesto Mensual - ${monthName} ${year}`, 14, 20);
    
    // Obtener datos
    const weeks = await getMonthWeeks();
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalProgrammed = 0;
    let totalUnprogrammed = 0;
    let totalWork = 0;
    
    let yPos = 35;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 14;
    
    // Resumen por semana
    for (const week of weeks) {
      if (yPos > pageHeight - 40) {
        doc.addPage();
        yPos = 20;
      }
      
      const incomes = await getWeekData("incomes", week.id);
      const expenses = await getWeekData("expenses", week.id);
      const workExpenses = await getWeekData("workExpenses", week.id);
      
      const weekIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
      const weekProgrammed = expenses
        .filter((e) => e.type === "programmed")
        .reduce((sum, e) => sum + e.amount, 0);
      const weekUnprogrammed = expenses
        .filter((e) => e.type === "unprogrammed")
        .reduce((sum, e) => sum + e.amount, 0);
      const weekWork = workExpenses.reduce((sum, w) => sum + w.amount, 0);
      const weekExpenses = weekProgrammed + weekUnprogrammed + weekWork;
      
      totalIncome += weekIncome;
      totalExpenses += weekExpenses;
      totalProgrammed += weekProgrammed;
      totalUnprogrammed += weekUnprogrammed;
      totalWork += weekWork;
      
      // Semana
      doc.setFontSize(14);
      doc.setFont(undefined, "bold");
      doc.text(week.name, margin, yPos);
      yPos += 7;
      
      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      doc.text(`Ingresos: $${weekIncome.toFixed(2)}`, margin, yPos);
      doc.text(`Gastos: $${weekExpenses.toFixed(2)}`, margin + 60, yPos);
      doc.text(`Balance: $${(weekIncome - weekExpenses).toFixed(2)}`, margin + 120, yPos);
      yPos += 10;
    }
    
    // Resumen total
    if (yPos > pageHeight - 60) {
      doc.addPage();
      yPos = 20;
    }
    
    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.text("Resumen Total del Mes", margin, yPos);
    yPos += 10;
    
    doc.setFontSize(12);
    doc.setFont(undefined, "normal");
    doc.text(`Total Ingresos: $${totalIncome.toFixed(2)}`, margin, yPos);
    yPos += 7;
    doc.text(`Total Gastos: $${totalExpenses.toFixed(2)}`, margin, yPos);
    yPos += 7;
    doc.text(`Gastos Programados: $${totalProgrammed.toFixed(2)}`, margin, yPos);
    yPos += 7;
    doc.text(`Gastos No Programados: $${totalUnprogrammed.toFixed(2)}`, margin, yPos);
    yPos += 7;
    doc.text(`Gastos de Trabajo: $${totalWork.toFixed(2)}`, margin, yPos);
    yPos += 7;
    
    doc.setFont(undefined, "bold");
    const balance = totalIncome - totalExpenses;
    doc.text(`Balance Final: $${balance.toFixed(2)}`, margin, yPos);
    yPos += 7;
    
    if (balance > 0) {
      const debtPayment = balance * 0.6;
      const freeMoney = balance * 0.4;
      doc.text(`Pago a Deuda (60%): $${debtPayment.toFixed(2)}`, margin, yPos);
      yPos += 7;
      doc.text(`Dinero Libre (40%): $${freeMoney.toFixed(2)}`, margin, yPos);
    }
    
    // Guardar PDF
    doc.save(`presupuesto_${monthName}_${year}.pdf`);
    showMessage("✅ PDF exportado exitosamente", "success");
  } catch (error) {
    showMessage("Error al exportar PDF: " + error.message, "error");
    console.error("Error en exportMonthlyPDF:", error);
  } finally {
    hideLoading();
  }
};

window.exportMonthlyCSV = async function () {
  if (!selectedMonth) {
    showMessage("Por favor selecciona un mes primero", "warning");
    return;
  }

  try {
    showLoading("Generando CSV...");
    const weeks = await getMonthWeeks();
    let csvData = "Tipo,Descripción,Categoría,Monto,Fecha,Semana\n";

    for (const week of weeks) {
      const incomes = await getWeekData("incomes", week.id);
      const expenses = await getWeekData("expenses", week.id);
      const workExpenses = await getWeekData("workExpenses", week.id);

      incomes.forEach((i) => {
        csvData += `Ingreso,"${i.description || i.type}","${i.type}",${i.amount},${i.date},"${week.name}"\n`;
      });

      expenses.forEach((e) => {
        csvData += `Gasto,"${e.description}","${e.category}",${e.amount},${e.date},"${week.name}"\n`;
      });

      workExpenses.forEach((w) => {
        csvData += `Gasto Trabajo,"${w.description}","${w.type}",${w.amount},${w.date},"${week.name}"\n`;
      });
    }

    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const monthNames = [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre",
    ];

    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `presupuesto_${monthNames[selectedMonth.month]}_${selectedMonth.year}.csv`
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showMessage("✅ CSV exportado exitosamente", "success");
  } catch (error) {
    showMessage("Error al exportar CSV: " + error.message, "error");
    console.error("Error en exportMonthlyCSV:", error);
  } finally {
    hideLoading();
  }
};

// ============= METAS DE AHORRO =============
window.createGoal = async function () {
  const name = document.getElementById("goalName").value;
  const target = parseFloat(document.getElementById("goalTarget").value);
  const deadline = document.getElementById("goalDeadline").value;

  const errors = validateForm(
    { name, target, deadline },
    {
      name: { required: true, label: "Nombre de la meta" },
      target: { required: true, min: 0.01, label: "Monto objetivo" },
      deadline: { required: true, type: "date", label: "Fecha límite" },
    }
  );

  if (deadline && new Date(deadline) < new Date()) {
    errors.push("La fecha límite debe ser en el futuro");
  }

  if (errors.length > 0) {
    showMessage(errors.join(", "), "warning");
    return;
  }

  try {
    showLoading("Creando meta...");
    const goalData = {
      userId: currentUser.uid,
      name: name.trim(),
      target: target,
      current: 0,
      deadline: deadline,
      createdAt: Timestamp.now(),
    };

    await addDoc(collection(db, "goals"), goalData);
    cache.clear("goals");
    document.getElementById("goalName").value = "";
    document.getElementById("goalTarget").value = "";
    document.getElementById("goalDeadline").value = "";
    await loadGoals();
    showMessage("✅ Meta creada exitosamente", "success");
  } catch (error) {
    showMessage("Error al crear meta: " + error.message, "error");
    console.error("Error en createGoal:", error);
  } finally {
    hideLoading();
  }
};

async function loadGoals() {
  // Verificar caché
  const cached = cache.get("goals");
  if (cached) {
    displayGoals(cached);
    return;
  }

  try {
    const q = query(
      collection(db, "goals"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const goals = [];

    snapshot.forEach((doc) => {
      goals.push({ id: doc.id, ...doc.data() });
    });

    cache.set("goals", goals);
    displayGoals(goals);
  } catch (error) {
    showMessage("Error al cargar metas: " + error.message, "error");
    console.error("Error en loadGoals:", error);
  }
}

function displayGoals(goals) {
  const container = document.getElementById("goalsList");

  if (goals.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎯</div>
        <p>No hay metas creadas aún</p>
      </div>
    `;
    return;
  }

  container.innerHTML = goals
    .map((goal) => {
      const progress = ((goal.current / goal.target) * 100).toFixed(1);
      const daysLeft = Math.ceil((new Date(goal.deadline) - new Date()) / (1000 * 60 * 60 * 24));

      return `
        <div class="list-item" style="--item-color: #8b5cf6; flex-direction: column; align-items: flex-start;">
          <div style="width: 100%; display: flex; justify-content: space-between; margin-bottom: 10px;">
            <div>
              <div class="list-item-title">🎯 ${goal.name}</div>
              <div class="list-item-details">
                Meta: $${goal.target.toFixed(2)} • Actual: $${goal.current.toFixed(2)}
                <br>📅 ${daysLeft} días restantes
              </div>
            </div>
            <button class="btn-small btn-danger" onclick="deleteGoal('${goal.id}')">🗑️</button>
          </div>
          <div style="width: 100%;">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${Math.min(progress, 100)}%;"></div>
            </div>
            <p style="text-align: center; margin-top: 5px; font-weight: 600; color: #8b5cf6;">${progress}%</p>
          </div>
        </div>
      `;
    })
    .join("");
}

window.deleteGoal = async function (id) {
  if (!confirm("¿Estás seguro de eliminar esta meta?")) return;

  try {
    showLoading("Eliminando meta...");
    await deleteDoc(doc(db, "goals", id));
    cache.clear("goals");
    await loadGoals();
    showMessage("✅ Meta eliminada", "success");
  } catch (error) {
    showMessage("Error al eliminar meta: " + error.message, "error");
    console.error("Error en deleteGoal:", error);
  } finally {
    hideLoading();
  }
};

// ============= NAVEGACIÓN (BUG FIXED) =============
window.showTab = function (tabName, element = null) {
  // Ocultar todas las secciones
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.remove("active");
  });

  // Desactivar todos los tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  // Activar la sección
  const section = document.getElementById(tabName);
  if (section) {
    section.classList.add("active");
  }

  // Activar el tab correspondiente
  if (element) {
    element.classList.add("active");
  } else {
    // Buscar el tab por su onclick
    document.querySelectorAll(".tab").forEach((tab) => {
      if (tab.getAttribute("onclick")?.includes(tabName)) {
        tab.classList.add("active");
      }
    });
  }
};

window.showSubTab = function (subTabName, element = null) {
  // Ocultar todas las sub-secciones
  document.querySelectorAll(".sub-section").forEach((section) => {
    section.classList.remove("active");
  });

  // Desactivar todos los sub-tabs
  document.querySelectorAll(".sub-tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  // Activar la sub-sección
  const section = document.getElementById(subTabName);
  if (section) {
    section.classList.add("active");
  }

  // Activar el sub-tab correspondiente
  if (element) {
    element.classList.add("active");
  } else {
    // Buscar el sub-tab por su onclick
    document.querySelectorAll(".sub-tab").forEach((tab) => {
      if (tab.getAttribute("onclick")?.includes(subTabName)) {
        tab.classList.add("active");
      }
    });
  }
};

// Los event listeners ya están configurados en el HTML con onclick="showTab('name', this)"
// No necesitamos reconfigurarlos aquí ya que el parámetro 'this' se pasa correctamente

// ============= UTILIDADES =============
function formatDate(dateString) {
  const date = new Date(dateString + "T00:00:00");
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getCategoryEmoji(category) {
  const emojis = {
    Comida: "🍔",
    Transporte: "🚗",
    Salud: "🏥",
    Servicios: "💡",
    Entretenimiento: "🎮",
    Educación: "📚",
    Emergencia: "🚨",
    Otros: "📦",
  };
  return emojis[category] || "📦";
}

// Cerrar modal al hacer clic fuera
document.addEventListener("DOMContentLoaded", () => {
  const detailModal = document.getElementById("detailModal");
  const weekDetailModal = document.getElementById("weekDetailModal");

  if (detailModal) {
    detailModal.addEventListener("click", function (e) {
      if (e.target === this) {
        closeModal();
      }
    });
  }

  if (weekDetailModal) {
    weekDetailModal.addEventListener("click", function (e) {
      if (e.target === this) {
        closeWeekModal();
      }
    });
  }

  // Inicializar gráficos y notificaciones
  initializeCharts();
  checkGoalsNotifications();
  setInterval(checkGoalsNotifications, 24 * 60 * 60 * 1000); // Verificar cada 24 horas
});

// ============= GRÁFICOS CON CHART.JS =============
let dashboardChart = null;
let expensesChart = null;

function initializeCharts() {
  // Los gráficos se crearán cuando se actualice el dashboard
}

function createDashboardChart(data) {
  const ctx = document.getElementById("dashboardChart");
  if (!ctx) return;

  if (dashboardChart) {
    dashboardChart.destroy();
  }

  dashboardChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Ingresos", "Gastos Programados", "Gastos No Programados", "Gastos Trabajo"],
      datasets: [
        {
          data: [
            data.totalIncome,
            data.totalProgrammed,
            data.totalUnprogrammed,
            data.totalWork,
          ],
          backgroundColor: [
            "rgba(74, 222, 128, 0.8)",
            "rgba(245, 158, 11, 0.8)",
            "rgba(239, 68, 68, 0.8)",
            "rgba(139, 92, 246, 0.8)",
          ],
          borderColor: [
            "rgba(74, 222, 128, 1)",
            "rgba(245, 158, 11, 1)",
            "rgba(239, 68, 68, 1)",
            "rgba(139, 92, 246, 1)",
          ],
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
        },
        title: {
          display: true,
          text: "Distribución de Finanzas",
        },
      },
    },
  });
}

function createExpensesChart(data) {
  const ctx = document.getElementById("expensesChart");
  if (!ctx) return;

  if (expensesChart) {
    expensesChart.destroy();
  }

  expensesChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.categories,
      datasets: [
        {
          label: "Gastos por Categoría",
          data: data.amounts,
          backgroundColor: "rgba(239, 68, 68, 0.8)",
          borderColor: "rgba(239, 68, 68, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        title: {
          display: true,
          text: "Gastos por Categoría",
        },
      },
    },
  });
}

// Los gráficos ahora se crean dentro de updateDashboard

// ============= NOTIFICACIONES PARA METAS =============
async function checkGoalsNotifications() {
  if (!currentUser) return;

  try {
    const q = query(
      collection(db, "goals"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const goals = [];

    snapshot.forEach((doc) => {
      goals.push({ id: doc.id, ...doc.data() });
    });

    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    goals.forEach((goal) => {
      const deadline = new Date(goal.deadline);
      const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
      const progress = (goal.current / goal.target) * 100;

      // Notificar si falta menos de 7 días
      if (deadline <= sevenDaysFromNow && deadline > now && progress < 100) {
        showMessage(
          `⚠️ Meta "${goal.name}" vence en ${daysLeft} día(s). Progreso: ${progress.toFixed(1)}%`,
          "warning"
        );
      }

      // Notificar si la meta está vencida
      if (deadline < now && progress < 100) {
        showMessage(
          `🔴 Meta "${goal.name}" está vencida. Progreso: ${progress.toFixed(1)}%`,
          "error"
        );
      }
    });
  } catch (error) {
    console.error("Error al verificar notificaciones de metas:", error);
  }
}

// validateDateRange ya está definida arriba, no duplicar

// ============= MANEJO DE ERRORES MEJORADO =============
function handleError(error, context = "") {
  let userMessage = "Ha ocurrido un error";
  let technicalMessage = error.message || String(error);

  // Errores de Firebase
  if (error.code) {
    switch (error.code) {
      case "permission-denied":
        userMessage = "No tienes permiso para realizar esta acción";
        break;
      case "unavailable":
        userMessage = "El servicio no está disponible. Verifica tu conexión a internet";
        break;
      case "deadline-exceeded":
        userMessage = "La operación tardó demasiado. Intenta nuevamente";
        break;
      case "not-found":
        userMessage = "El recurso solicitado no fue encontrado";
        break;
      case "already-exists":
        userMessage = "Este registro ya existe";
        break;
      case "resource-exhausted":
        userMessage = "Se ha excedido el límite de recursos. Intenta más tarde";
        break;
      case "failed-precondition":
        userMessage = "La operación no se puede completar en este momento";
        break;
      case "aborted":
        userMessage = "La operación fue cancelada";
        break;
      case "out-of-range":
        userMessage = "El valor está fuera del rango permitido";
        break;
      case "unimplemented":
        userMessage = "Esta funcionalidad aún no está implementada";
        break;
      case "internal":
        userMessage = "Error interno del servidor. Intenta más tarde";
        break;
      case "unauthenticated":
        userMessage = "Debes iniciar sesión para realizar esta acción";
        break;
      default:
        userMessage = getSpanishError(error.code) || userMessage;
    }
  }

  // Errores de red
  if (error.message && error.message.includes("network")) {
    userMessage = "Error de conexión. Verifica tu conexión a internet";
  }

  // Errores de validación
  if (error.name === "ValidationError") {
    userMessage = error.message;
  }

  // Log técnico
  console.error(`Error en ${context}:`, {
    message: technicalMessage,
    code: error.code,
    stack: error.stack,
  });

  return userMessage;
}

// Actualizar funciones para usar handleError
const originalShowMessage = showMessage;
showMessage = function (message, type = "info") {
  if (type === "error" && message.includes("Error:")) {
    // Ya tiene formato de error
    originalShowMessage(message, type);
  } else {
    originalShowMessage(message, type);
  }
};

// ============= TESTS UNITARIOS BÁSICOS =============
window.runTests = function () {
  const tests = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Validación de fechas
  function testDateValidation() {
    const week = {
      startDate: "2024-01-01",
      endDate: "2024-01-07",
    };
    const result1 = validateDateInWeekRange("2024-01-05", week);
    const result2 = validateDateInWeekRange("2024-01-10", week);
    const result3 = validateDateInWeekRange("2023-12-31", week);

    if (result1.valid && !result2.valid && !result3.valid) {
      passed++;
      return { name: "Validación de fechas", status: "✅ PASS" };
    } else {
      failed++;
      return { name: "Validación de fechas", status: "❌ FAIL" };
    }
  }

  // Test 2: Formato de fecha
  function testDateFormat() {
    const date1 = formatDate("2024-01-15");
    const date2 = formatDate("2024-12-31");

    if (date1 === "15/01/2024" && date2 === "31/12/2024") {
      passed++;
      return { name: "Formato de fecha", status: "✅ PASS" };
    } else {
      failed++;
      return { name: "Formato de fecha", status: "❌ FAIL" };
    }
  }

  // Test 3: Validación de formularios
  function testFormValidation() {
    const errors1 = validateForm(
      { email: "", password: "123" },
      {
        email: { required: true, type: "email", label: "Email" },
        password: { required: true, min: 6, label: "Contraseña" },
      }
    );

    if (errors1.length === 2) {
      passed++;
      return { name: "Validación de formularios", status: "✅ PASS" };
    } else {
      failed++;
      return { name: "Validación de formularios", status: "❌ FAIL" };
    }
  }

  tests.push(testDateValidation());
  tests.push(testDateFormat());
  tests.push(testFormValidation());

  // Mostrar resultados
  const results = `
    <div style="padding: 20px; background: #f8f9fa; border-radius: 10px; margin: 20px 0;">
      <h3>Resultados de Tests</h3>
      <p>✅ Pasados: ${passed}</p>
      <p>❌ Fallidos: ${failed}</p>
      <ul>
        ${tests.map((t) => `<li>${t.name}: ${t.status}</li>`).join("")}
      </ul>
    </div>
  `;

  showMessage(`Tests completados: ${passed} pasados, ${failed} fallidos`, passed === tests.length ? "success" : "warning");
  console.log("Tests:", tests);
};

// Ejecutar tests en desarrollo (comentar en producción)
// window.runTests();

