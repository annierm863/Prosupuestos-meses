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
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
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

// ============= SEGURIDAD: Variables globales expuestas =============
// NOTA: Estas variables están expuestas para compatibilidad, pero deberían
// ser privadas en producción. Las reglas de Firestore deben proteger los datos.
// window.auth = auth; // Comentado por seguridad - usar solo internamente
// window.db = db; // Comentado por seguridad - usar solo internamente

// ============= ESTADO GLOBAL =============
let currentUser = null;
let currentWeek = null;
let selectedMonth = null;
let editingItem = null;
let editingType = null;

// ============= CACHÉ LOCAL =============
const cache = (function() {
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
  const data = {
    weeks: null,
    incomes: {},
    expenses: {},
    workExpenses: {},
    goals: null,
    monthlyData: {},
    assets: null,
    liabilities: null,
    investments: null,
    budgets: null,
    allIncomes: null,
    allExpenses: null,
  };
  const timestamps = {};

  return {
    get(key, subKey = null) {
      const cacheKey = subKey ? `${key}_${subKey}` : key;
      const cached = data[cacheKey];
      const timestamp = timestamps[cacheKey];

      if (cached !== undefined && cached !== null && timestamp && Date.now() - timestamp < CACHE_DURATION) {
        return cached;
      }
      return null;
    },

    set(key, value, subKey = null) {
      const cacheKey = subKey ? `${key}_${subKey}` : key;
      data[cacheKey] = value;
      timestamps[cacheKey] = Date.now();
    },

    clear(key = null, subKey = null) {
      if (key) {
        if (subKey) {
          // Limpiar un sub-caché específico
          const cacheKey = `${key}_${subKey}`;
          delete data[cacheKey];
          delete timestamps[cacheKey];
        } else {
          // Limpiar todo el caché de una clave
          if (typeof data[key] === "object" && !Array.isArray(data[key]) && data[key] !== null) {
            // Si es un objeto, limpiar todas las sub-claves
            Object.keys(data).forEach((k) => {
              if (k.startsWith(key + "_")) {
                delete data[k];
                delete timestamps[k];
              }
            });
          }
          data[key] = typeof data[key] === "object" && !Array.isArray(data[key]) ? {} : null;
          timestamps[key] = null;
        }
      } else {
        // Limpiar todo el caché
        Object.keys(data).forEach((k) => {
          data[k] = typeof data[k] === "object" && !Array.isArray(data[k]) ? {} : null;
        });
        Object.keys(timestamps).forEach((k) => {
          timestamps[k] = null;
        });
      }
    },
  };
})();

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
// ============= REGISTRO DESHABILITADO - SOLO ADMIN =============
// El registro público ha sido deshabilitado por seguridad.
// Solo el administrador puede crear nuevas cuentas desde Firebase Console.
window.register = async function () {
  showAuthMessage("⚠️ El registro está deshabilitado. Contacta al administrador para crear una cuenta.", "warning");
  return;
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
    
    // Inicializar sidebar: expandir categoría activa si hay un item activo
    const activeItem = document.querySelector(".nav-item.active");
    if (activeItem) {
      const category = activeItem.closest(".nav-category");
      if (category) {
        const categoryHeader = category.querySelector(".nav-category-header");
        if (categoryHeader) {
          categoryHeader.classList.add("active");
          const submenu = categoryHeader.nextElementSibling;
          if (submenu) {
            submenu.classList.add("active");
          }
        }
      }
    }
  } catch (error) {
    showMessage("Error al inicializar la aplicación: " + error.message, "error");
    console.error("Error en initApp:", error);
  } finally {
    hideLoading();
  }
}

function setDefaultDates() {
  const today = new Date().toISOString().split("T")[0];
  const currentMonth = new Date().toISOString().slice(0, 7);
  document.getElementById("incomeDate").value = today;
  document.getElementById("programmedDate").value = today;
  document.getElementById("unprogrammedDate").value = today;
  document.getElementById("workDate").value = today;
  document.getElementById("weekStartDate").value = today;
  document.getElementById("weekEndDate").value = today;
  const budgetMonthInput = document.getElementById("budgetMonth");
  if (budgetMonthInput) {
    budgetMonthInput.value = currentMonth;
  }
  const investmentDateInput = document.getElementById("investmentDate");
  if (investmentDateInput) {
    investmentDateInput.value = today;
  }
  // Inicializar selector de mes para análisis de gastos de trabajo
  const workMonthSelector = document.getElementById("workMonthSelector");
  if (workMonthSelector) {
    workMonthSelector.value = currentMonth;
  }
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
  if (cache && typeof cache.get === 'function') {
    const cached = cache.get("weeks");
    if (cached) {
      displayWeeks(cached);
      if (cached.length > 0 && !currentWeek) {
        currentWeek = cached[0];
      }
      return;
    }
  }

  try {
    // Usar solo where, ordenar en JavaScript para evitar necesidad de índice compuesto
    const q = query(
      collection(db, "weeks"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const weeks = [];

    snapshot.forEach((doc) => {
      weeks.push({ id: doc.id, ...doc.data() });
    });

    // Ordenar por fecha de inicio (más reciente primero) en JavaScript
    weeks.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    if (cache && typeof cache.set === 'function') {
      cache.set("weeks", weeks);
    }
    displayWeeks(weeks);

    // Seleccionar la semana más reciente como activa
    if (weeks.length > 0 && !currentWeek) {
      currentWeek = weeks[0];
    }
  } catch (error) {
    const errorMessage = handleError(error, "loadWeeks");
    showMessage("Error al cargar semanas: " + errorMessage, "error");
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

// Función auxiliar para cargar todos los ingresos (sin filtrar por semana)
async function loadAllIncomes() {
  if (!currentUser) return [];
  try {
    const cached = cache.get("allIncomes");
    if (cached) return cached;

    const q = query(
      collection(db, "incomes"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const incomes = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      incomes.push({
        id: doc.id,
        ...data,
        date: data.date || (data.createdAt?.toDate ? data.createdAt.toDate().toISOString().split("T")[0] : null),
      });
    });
    incomes.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt?.toDate() || 0);
      const dateB = new Date(b.date || b.createdAt?.toDate() || 0);
      return dateB - dateA;
    });
    cache.set("allIncomes", incomes);
    return incomes;
  } catch (error) {
    handleError(error, "loadAllIncomes");
    return [];
  }
}

async function loadIncomes() {
  if (!currentWeek) return [];

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

// Función auxiliar para cargar todos los gastos (sin filtrar por semana)
async function loadAllExpenses() {
  if (!currentUser) return [];
  try {
    const cached = cache.get("allExpenses");
    if (cached) return cached;

    const q = query(
      collection(db, "expenses"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const expenses = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      expenses.push({
        id: doc.id,
        ...data,
        date: data.date || (data.createdAt?.toDate ? data.createdAt.toDate().toISOString().split("T")[0] : null),
      });
    });
    expenses.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt?.toDate() || 0);
      const dateB = new Date(b.date || b.createdAt?.toDate() || 0);
      return dateB - dateA;
    });
    cache.set("allExpenses", expenses);
    return expenses;
  } catch (error) {
    handleError(error, "loadAllExpenses");
    return [];
  }
}

async function loadExpenses() {
  if (!currentWeek) return [];

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

    // Limpiar caché antes de recargar
    cache.clear("workExpenses", currentWeek.id);
    document.getElementById("workAmount").value = "";
    document.getElementById("workDescription").value = "";

    // Recargar gastos y actualizar dashboard
    await loadWorkExpenses();
    await updateDashboard();
    
    // Forzar actualización del análisis
    if (currentWeek) {
      const workExpenses = await getWeekData("workExpenses", currentWeek.id);
      await updateWorkAnalysis(workExpenses);
    }
  } catch (error) {
    showMessage("Error al guardar gasto de trabajo: " + error.message, "error");
    console.error("Error en addWorkExpense:", error);
  } finally {
    hideLoading();
  }
};

async function loadWorkExpenses() {
  if (!currentWeek) return;

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
    
    console.log("Gastos de trabajo cargados:", expenses.length, expenses);
    displayWorkExpenses(expenses);
  } catch (error) {
    showMessage("Error al cargar gastos de trabajo: " + error.message, "error");
    console.error("Error en loadWorkExpenses:", error);
  }
}

function getWorkTypeEmoji(type) {
  const emojis = {
    "Gasolina": "⛽",
    "Comida": "🍔",
    "Servicios": "🔧",
    "Mantenimiento": "🛠️",
    "Reparaciones": "🔨",
    "Otros": "📦"
  };
  return emojis[type] || "📦";
}

function displayWorkExpenses(expenses) {
  const container = document.getElementById("workList");

  if (!expenses || expenses.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🚗</div>
        <p>No hay gastos de trabajo registrados</p>
      </div>
    `;
    // Actualizar análisis incluso si no hay datos
    updateWorkAnalysis([]);
    return;
  }

  container.innerHTML = expenses
    .map(
      (expense) => `
      <div class="list-item" style="--item-color: #8b5cf6;">
        <div class="list-item-info">
          <div class="list-item-title">${getWorkTypeEmoji(expense.type)} ${expense.type}</div>
          <div class="list-item-details">
            ${expense.description || ""} • 📅 ${formatDate(expense.date)}
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

  // Actualizar análisis después de mostrar la lista
  updateWorkAnalysis(expenses);
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
    
    // Forzar actualización del análisis después de eliminar
    if (currentWeek) {
      const workExpenses = await getWeekData("workExpenses", currentWeek.id);
      await updateWorkAnalysis(workExpenses);
    }
    
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
    // Los gastos de trabajo NO se incluyen en el presupuesto semanal (control separado)
    const totalExpenses = totalProgrammed + totalUnprogrammed;

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

    // Mostrar sección separada de gastos de trabajo
    displayWorkExpensesSection(totalWork, workExpenses.length);

    // Calcular salud financiera (sin incluir gastos de trabajo)
    updateFinancialHealth(totalIncome, totalExpenses, totalUnprogrammed, debtPayment);

    // Crear gráficos (sin incluir gastos de trabajo en el gráfico principal)
    try {
      const chartData = {
        totalIncome,
        totalProgrammed,
        totalUnprogrammed,
        totalWork: 0, // No incluir en el gráfico del presupuesto
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
    
    // Actualizar análisis de gastos de trabajo
    if (currentWeek) {
      const workExpenses = await getWeekData("workExpenses", currentWeek.id);
      updateWorkAnalysis(workExpenses);
    }
  } catch (error) {
    const errorMessage = handleError(error, "updateDashboard");
    showMessage(errorMessage, "error");
    console.error("Error en updateDashboard:", error);
  }
}

// Función para mostrar la sección separada de gastos de trabajo
function displayWorkExpensesSection(totalWork, count) {
  const section = document.getElementById("workExpensesSection");
  const dashboard = document.getElementById("workExpensesDashboard");
  
  if (!section || !dashboard) return;

  if (totalWork === 0 && count === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  dashboard.innerHTML = `
    <div class="card" style="--color1: #8b5cf6; --color2: #7c3aed;" onclick="showWorkDetail()">
      <div class="card-title">Total Gastos de Trabajo</div>
      <div class="card-value">$${totalWork.toFixed(2)}</div>
      <div class="card-subtitle">${count} registro(s)</div>
    </div>
    <div class="card" style="--color1: #6366f1; --color2: #4f46e5;">
      <div class="card-title">💰 Control Separado</div>
      <div class="card-value" style="font-size: 18px;">No afecta el presupuesto semanal</div>
    </div>
  `;
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
  // Los gastos de trabajo NO se incluyen en el cálculo del balance
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
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
      const startDate = new Date(weekData.startDate);
      const endDate = new Date(weekData.endDate);
      
      // Calcular cuántos días de la semana están en el mes seleccionado
      const targetMonthStart = new Date(year, month, 1);
      const targetMonthEnd = new Date(year, month + 1, 0, 23, 59, 59);
      
      // Calcular el rango de intersección
      const intersectionStart = startDate > targetMonthStart ? startDate : targetMonthStart;
      const intersectionEnd = endDate < targetMonthEnd ? endDate : targetMonthEnd;
      
      // Si hay intersección, calcular cuántos días están en este mes
      if (intersectionStart <= intersectionEnd) {
        const daysInMonth = Math.ceil((intersectionEnd - intersectionStart) / (1000 * 60 * 60 * 24)) + 1;
        const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        
        // La semana pertenece a este mes si tiene más de la mitad de sus días aquí
        // O si comienza en este mes (prioridad)
        const startMonth = startDate.getMonth();
        const startYear = startDate.getFullYear();
        const belongsToMonth = (startMonth === month && startYear === year) || (daysInMonth > totalDays / 2);
        
        if (belongsToMonth) {
          allWeeks.push(weekData);
        }
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
      // Los gastos de trabajo NO se incluyen en el presupuesto semanal
      const weekExpenses = weekProgrammed + weekUnprogrammed;
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
        subtitle: "(Sin gastos de trabajo)",
        color1: "#ef4444",
        color2: "#dc2626",
        click: "showMonthExpenseDetail",
      },
      {
        title: "Gastos de Trabajo",
        value: `$${totalWork.toFixed(2)}`,
        subtitle: "Control separado",
        color1: "#8b5cf6",
        color2: "#7c3aed",
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
    ];

    const cardsHTML = cards
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
    // Los gastos de trabajo NO se incluyen en el presupuesto semanal
    const totalExpenses = totalProgrammed + totalUnprogrammed;
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
          <div class="card-title">Gastos del Presupuesto</div>
          <div class="card-value">$${totalExpenses.toFixed(2)}</div>
          <div class="card-subtitle">(Sin gastos de trabajo)</div>
        </div>
        <div class="card" style="--color1: #8b5cf6; --color2: #7c3aed;">
          <div class="card-title">Gastos de Trabajo</div>
          <div class="card-value">$${totalWork.toFixed(2)}</div>
          <div class="card-subtitle">Control separado</div>
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
          <span class="health-label">🚗 Gastos de Trabajo (Separado):</span>
          <span class="health-value">$${totalWork.toFixed(2)}</span>
        </div>
        <div style="margin-top: 10px; padding: 10px; background: #e0e7ff; border-radius: 5px; color: #4f46e5; font-size: 12px;">
          ⚠️ Los gastos de trabajo son un control separado y NO afectan el balance del presupuesto semanal
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
    // Los gastos de trabajo NO se incluyen en el cálculo del balance
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
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
      const startDate = new Date(weekData.startDate);
      const endDate = new Date(weekData.endDate);
      
      // Calcular cuántos días de la semana están en el mes seleccionado
      const targetMonthStart = new Date(selectedMonth.year, selectedMonth.month, 1);
      const targetMonthEnd = new Date(selectedMonth.year, selectedMonth.month + 1, 0, 23, 59, 59);
      
      // Calcular el rango de intersección
      const intersectionStart = startDate > targetMonthStart ? startDate : targetMonthStart;
      const intersectionEnd = endDate < targetMonthEnd ? endDate : targetMonthEnd;
      
      // Si hay intersección, calcular cuántos días están en este mes
      if (intersectionStart <= intersectionEnd) {
        const daysInMonth = Math.ceil((intersectionEnd - intersectionStart) / (1000 * 60 * 60 * 24)) + 1;
        const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        
        // La semana pertenece a este mes si tiene más de la mitad de sus días aquí
        // O si comienza en este mes (prioridad)
        const startMonth = startDate.getMonth();
        const startYear = startDate.getFullYear();
        const belongsToMonth = (startMonth === selectedMonth.month && startYear === selectedMonth.year) || (daysInMonth > totalDays / 2);
        
        if (belongsToMonth) {
          weeks.push(weekData);
        }
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
      // Los gastos de trabajo NO se incluyen en el presupuesto semanal
      const weekExpenses = weekProgrammed + weekUnprogrammed;
      
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
      doc.text(`Trabajo: $${weekWork.toFixed(2)}`, margin + 120, yPos);
      yPos += 5;
      doc.text(`Balance: $${(weekIncome - weekExpenses).toFixed(2)}`, margin, yPos);
      doc.setFontSize(8);
      doc.text(`(Gastos trabajo no incluidos)`, margin + 60, yPos);
      yPos += 8;
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
    doc.text(`Total Gastos del Presupuesto: $${totalExpenses.toFixed(2)}`, margin, yPos);
    yPos += 7;
    doc.text(`Gastos Programados: $${totalProgrammed.toFixed(2)}`, margin, yPos);
    yPos += 7;
    doc.text(`Gastos No Programados: $${totalUnprogrammed.toFixed(2)}`, margin, yPos);
    yPos += 7;
    doc.text(`Gastos de Trabajo (Separado): $${totalWork.toFixed(2)}`, margin, yPos);
    yPos += 5;
    doc.setFontSize(9);
    doc.text(`(No incluido en el presupuesto)`, margin + 5, yPos);
    yPos += 7;
    
    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    // Balance sin incluir gastos de trabajo
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
            <div style="display: flex; gap: 5px;">
              <button class="btn-small" style="background: #3b82f6; color: white;" onclick="editGoal('${goal.id}')">✏️ Editar</button>
              <button class="btn-small btn-danger" onclick="deleteGoal('${goal.id}')">🗑️</button>
            </div>
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

window.editGoal = async function (id) {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  try {
    // Cargar la meta actual
    const goalDoc = await getDoc(doc(db, "goals", id));
    if (!goalDoc.exists()) {
      showMessage("Meta no encontrada", "error");
      return;
    }

    const goal = { id: goalDoc.id, ...goalDoc.data() };

    // Mostrar formulario de edición
    const newName = prompt("Nombre de la meta:", goal.name);
    if (newName === null) return;

    const newTarget = prompt("Monto objetivo:", goal.target);
    if (newTarget === null) return;
    const targetValue = parseFloat(newTarget);
    if (isNaN(targetValue) || targetValue <= 0) {
      showMessage("Monto objetivo inválido", "error");
      return;
    }

    const newCurrent = prompt("Monto actual:", goal.current || 0);
    if (newCurrent === null) return;
    const currentValue = parseFloat(newCurrent);
    if (isNaN(currentValue) || currentValue < 0) {
      showMessage("Monto actual inválido", "error");
      return;
    }

    const newDeadline = prompt("Fecha límite (YYYY-MM-DD):", goal.deadline);
    if (newDeadline === null) return;
    if (!newDeadline) {
      showMessage("Fecha límite requerida", "error");
      return;
    }

    showLoading("Actualizando meta...");
    await updateDoc(doc(db, "goals", id), {
      name: newName,
      target: targetValue,
      current: currentValue,
      deadline: newDeadline,
    });

    cache.clear("goals");
    await loadGoals();
    showMessage("✅ Meta actualizada", "success");
  } catch (error) {
    showMessage("Error al actualizar meta: " + error.message, "error");
    console.error("Error en editGoal:", error);
  } finally {
    hideLoading();
  }
};

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

// ============= NAVEGACIÓN CON SIDEBAR =============

// Toggle sidebar (para móvil)
window.toggleSidebar = function () {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const mainContent = document.getElementById("mainContent");
  
  sidebar.classList.toggle("collapsed");
  overlay.classList.toggle("show");
  
  if (window.innerWidth <= 768) {
    if (sidebar.classList.contains("collapsed")) {
      mainContent.classList.add("expanded");
    } else {
      mainContent.classList.remove("expanded");
    }
  }
};

// Toggle categorías del menú
window.toggleCategory = function (element) {
  // Prevenir propagación del evento
  if (event) {
    event.stopPropagation();
  }
  
  // Toggle clase active en el header
  element.classList.toggle("active");
  
  // Encontrar el submenu (siguiente elemento hermano)
  const submenu = element.nextElementSibling;
  if (submenu && submenu.classList.contains("nav-submenu")) {
    submenu.classList.toggle("active");
  }
};

window.showTab = async function (tabName, element = null) {
  // Ocultar todas las secciones
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.remove("active");
  });

  // Desactivar todos los items del menú
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
  });

  // Activar la sección
  const section = document.getElementById(tabName);
  if (section) {
    section.classList.add("active");
  }

  // Activar el item del menú correspondiente
  if (element) {
    element.classList.add("active");
    // Expandir la categoría padre si existe
    const category = element.closest(".nav-category");
    if (category) {
      const categoryHeader = category.querySelector(".nav-category-header");
      if (categoryHeader && !categoryHeader.classList.contains("active")) {
        categoryHeader.classList.add("active");
        const submenu = categoryHeader.nextElementSibling;
        if (submenu) {
          submenu.classList.add("active");
        }
      }
    }
  } else {
    // Buscar el item por el tabName
    document.querySelectorAll(".nav-item").forEach((item) => {
      const onclick = item.getAttribute("onclick");
      if (onclick && onclick.includes(tabName)) {
        item.classList.add("active");
        // Expandir la categoría padre
        const category = item.closest(".nav-category");
        if (category) {
          const categoryHeader = category.querySelector(".nav-category-header");
          if (categoryHeader) {
            categoryHeader.classList.add("active");
            const submenu = categoryHeader.nextElementSibling;
            if (submenu) {
              submenu.classList.add("active");
            }
          }
        }
      }
    });
  }

  // Cerrar sidebar en móvil después de seleccionar
  if (window.innerWidth <= 768) {
    toggleSidebar();
  }

  // Cargar datos de las nuevas secciones cuando se seleccionen
  if (tabName === "networth") {
    await loadNetworth();
  } else if (tabName === "debts") {
    await displayDebts();
  } else if (tabName === "investments") {
    await displayInvestments();
  } else if (tabName === "budgets") {
    await displayBudgets();
  } else if (tabName === "trends") {
    await loadTrends();
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

// ============= ANÁLISIS DE GASTOS DE TRABAJO =============
async function updateWorkAnalysis(expenses) {
  if (!expenses || expenses.length === 0) {
    if (document.getElementById("workWeeklySummary")) {
      document.getElementById("workWeeklySummary").innerHTML = `
        <div class="empty-state">
          <p>No hay gastos registrados esta semana</p>
        </div>
      `;
    }
    return;
  }

  // Calcular resumen semanal
  const totalWeekly = expenses.reduce((sum, e) => sum + e.amount, 0);
  const weeklyByCategory = {};
  expenses.forEach(expense => {
    if (!weeklyByCategory[expense.type]) {
      weeklyByCategory[expense.type] = { total: 0, count: 0 };
    }
    weeklyByCategory[expense.type].total += expense.amount;
    weeklyByCategory[expense.type].count += 1;
  });

  // Mostrar resumen semanal
  if (document.getElementById("workWeeklySummary")) {
    const weeklyCards = [
      {
        title: "Total Semanal",
        value: `$${totalWeekly.toFixed(2)}`,
        subtitle: `${expenses.length} gasto(s)`,
        color1: "#8b5cf6",
        color2: "#7c3aed"
      },
      ...Object.entries(weeklyByCategory).map(([type, data]) => ({
        title: `${getWorkTypeEmoji(type)} ${type}`,
        value: `$${data.total.toFixed(2)}`,
        subtitle: `${data.count} registro(s)`,
        color1: "#6366f1",
        color2: "#4f46e5"
      }))
    ];

    document.getElementById("workWeeklySummary").innerHTML = weeklyCards
      .map(card => `
        <div class="card" style="--color1: ${card.color1}; --color2: ${card.color2};">
          <div class="card-title">${card.title}</div>
          <div class="card-value">${card.value}</div>
          ${card.subtitle ? `<div class="card-subtitle">${card.subtitle}</div>` : ""}
        </div>
      `).join("");
  }

  // Cargar análisis mensual si hay selector
  if (document.getElementById("workMonthSelector")) {
    const monthValue = document.getElementById("workMonthSelector").value || 
      new Date().toISOString().slice(0, 7);
    await loadWorkMonthlyAnalysis(monthValue);
  }

  // Cargar análisis por categoría
  if (document.getElementById("workCategoryPeriod")) {
    await loadWorkCategoryAnalysis();
  }

  // Actualizar gráfico
  updateWorkExpensesChart(expenses);
}

async function loadWorkMonthlyAnalysis(monthValue = null) {
  if (!currentUser) return;

  try {
    showLoading("Cargando análisis mensual...");
    
    const month = monthValue || document.getElementById("workMonthSelector")?.value || 
      new Date().toISOString().slice(0, 7);
    
    if (!month) return;

    const [year, monthNum] = month.split("-").map(Number);
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0, 23, 59, 59);

    // Obtener todas las semanas del mes
    const q = query(
      collection(db, "weeks"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const weeks = [];
    
    snapshot.forEach((doc) => {
      const weekData = { id: doc.id, ...doc.data() };
      const weekStart = new Date(weekData.startDate);
      if (weekStart >= startDate && weekStart <= endDate) {
        weeks.push(weekData);
      }
    });

    // Obtener todos los gastos de trabajo del mes
    let allWorkExpenses = [];
    for (const week of weeks) {
      const weekExpenses = await getWeekData("workExpenses", week.id);
      allWorkExpenses = [...allWorkExpenses, ...weekExpenses];
    }

    // Filtrar por mes
    allWorkExpenses = allWorkExpenses.filter(expense => {
      const expenseDate = new Date(expense.date);
      return expenseDate >= startDate && expenseDate <= endDate;
    });

    // Calcular resumen mensual
    const totalMonthly = allWorkExpenses.reduce((sum, e) => sum + e.amount, 0);
    const monthlyByCategory = {};
    allWorkExpenses.forEach(expense => {
      if (!monthlyByCategory[expense.type]) {
        monthlyByCategory[expense.type] = { total: 0, count: 0 };
      }
      monthlyByCategory[expense.type].total += expense.amount;
      monthlyByCategory[expense.type].count += 1;
    });

    // Mostrar resumen mensual
    if (document.getElementById("workMonthlySummary")) {
      const monthlyCards = [
        {
          title: "Total Mensual",
          value: `$${totalMonthly.toFixed(2)}`,
          subtitle: `${allWorkExpenses.length} gasto(s)`,
          color1: "#8b5cf6",
          color2: "#7c3aed"
        },
        ...Object.entries(monthlyByCategory).map(([type, data]) => ({
          title: `${getWorkTypeEmoji(type)} ${type}`,
          value: `$${data.total.toFixed(2)}`,
          subtitle: `${data.count} registro(s)`,
          color1: "#6366f1",
          color2: "#4f46e5"
        }))
      ];

      document.getElementById("workMonthlySummary").innerHTML = monthlyCards.length > 0
        ? monthlyCards.map(card => `
            <div class="card" style="--color1: ${card.color1}; --color2: ${card.color2};">
              <div class="card-title">${card.title}</div>
              <div class="card-value">${card.value}</div>
              ${card.subtitle ? `<div class="card-subtitle">${card.subtitle}</div>` : ""}
            </div>
          `).join("")
        : `
          <div class="empty-state">
            <p>No hay gastos registrados en este mes</p>
          </div>
        `;
    }
  } catch (error) {
    showMessage("Error al cargar análisis mensual: " + error.message, "error");
    console.error("Error en loadWorkMonthlyAnalysis:", error);
  } finally {
    hideLoading();
  }
}

async function loadWorkCategoryAnalysis() {
  if (!currentUser || !currentWeek) return;

  try {
    const period = document.getElementById("workCategoryPeriod")?.value || "week";
    let expenses = [];

    if (period === "week") {
      // Gastos de la semana actual
      expenses = await getWeekData("workExpenses", currentWeek.id);
    } else {
      // Gastos del mes actual
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0, 23, 59, 59);

      const q = query(
        collection(db, "weeks"),
        where("userId", "==", currentUser.uid)
      );
      const snapshot = await getDocs(q);
      const weeks = [];
      
      snapshot.forEach((doc) => {
        const weekData = { id: doc.id, ...doc.data() };
        const weekStart = new Date(weekData.startDate);
        if (weekStart >= startDate && weekStart <= endDate) {
          weeks.push(weekData);
        }
      });

      for (const week of weeks) {
        const weekExpenses = await getWeekData("workExpenses", week.id);
        expenses = [...expenses, ...weekExpenses.filter(e => {
          const expenseDate = new Date(e.date);
          return expenseDate >= startDate && expenseDate <= endDate;
        })];
      }
    }

    // Agrupar por categoría
    const byCategory = {};
    expenses.forEach(expense => {
      if (!byCategory[expense.type]) {
        byCategory[expense.type] = { total: 0, count: 0, items: [] };
      }
      byCategory[expense.type].total += expense.amount;
      byCategory[expense.type].count += 1;
      byCategory[expense.type].items.push(expense);
    });

    // Mostrar resumen por categoría
    if (document.getElementById("workCategorySummary")) {
      const total = expenses.reduce((sum, e) => sum + e.amount, 0);
      
      if (Object.keys(byCategory).length === 0) {
        document.getElementById("workCategorySummary").innerHTML = `
          <div class="empty-state">
            <p>No hay gastos registrados en este período</p>
          </div>
        `;
        return;
      }

      const categoryHTML = Object.entries(byCategory)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([type, data]) => {
          const percentage = total > 0 ? ((data.total / total) * 100).toFixed(1) : 0;
          return `
            <div style="background: white; padding: 15px; border-radius: 10px; margin-bottom: 15px; border-left: 4px solid #8b5cf6;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div>
                  <h4 style="color: #333; margin: 0;">${getWorkTypeEmoji(type)} ${type}</h4>
                  <p style="color: #666; font-size: 14px; margin: 5px 0 0 0;">${data.count} registro(s)</p>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 24px; font-weight: bold; color: #8b5cf6;">$${data.total.toFixed(2)}</div>
                  <div style="font-size: 12px; color: #666;">${percentage}% del total</div>
                </div>
              </div>
              <div class="progress-bar" style="margin-top: 10px;">
                <div class="progress-fill" style="width: ${percentage}%; background: #8b5cf6;"></div>
              </div>
            </div>
          `;
        }).join("");

      document.getElementById("workCategorySummary").innerHTML = `
        <div style="background: #f0f4ff; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="margin: 0; color: #333;">Total ${period === "week" ? "Semanal" : "Mensual"}</h4>
            <div style="font-size: 28px; font-weight: bold; color: #8b5cf6;">$${total.toFixed(2)}</div>
          </div>
        </div>
        ${categoryHTML}
      `;
    }
  } catch (error) {
    showMessage("Error al cargar análisis por categoría: " + error.message, "error");
    console.error("Error en loadWorkCategoryAnalysis:", error);
  }
}

function updateWorkExpensesChart(expenses) {
  try {
    const ctx = document.getElementById("workExpensesChart");
    if (!ctx) return;

    // Destruir gráfico anterior si existe
    if (window.workExpensesChartInstance) {
      window.workExpensesChartInstance.destroy();
    }

    // Agrupar por categoría
    const byCategory = {};
    expenses.forEach(expense => {
      if (!byCategory[expense.type]) {
        byCategory[expense.type] = 0;
      }
      byCategory[expense.type] += expense.amount;
    });

    const categories = Object.keys(byCategory);
    const amounts = Object.values(byCategory);

    if (categories.length === 0) return;

    window.workExpensesChartInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: categories.map(cat => `${getWorkTypeEmoji(cat)} ${cat}`),
        datasets: [{
          label: "Gastos por Categoría",
          data: amounts,
          backgroundColor: [
            "#8b5cf6",
            "#6366f1",
            "#4f46e5",
            "#7c3aed",
            "#a78bfa",
            "#c4b5fd"
          ],
          borderWidth: 2,
          borderColor: "#fff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom"
          },
          title: {
            display: true,
            text: "Distribución de Gastos de Trabajo"
          }
        }
      }
    });
  } catch (error) {
    console.error("Error al crear gráfico de gastos de trabajo:", error);
  }
}

// Hacer funciones accesibles globalmente
window.loadWorkMonthlyAnalysis = loadWorkMonthlyAnalysis;
window.loadWorkCategoryAnalysis = loadWorkCategoryAnalysis;

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

// ============= PATRIMONIO NETO (ACTIVOS Y PASIVOS) =============

// Cargar activos
async function loadAssets() {
  if (!currentUser) return [];
  try {
    const cached = cache.get("assets");
    if (cached) return cached;

    const q = query(
      collection(db, "assets"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const assets = [];
    snapshot.forEach((doc) => {
      assets.push({ id: doc.id, ...doc.data() });
    });
    assets.sort((a, b) => new Date(b.createdAt?.toDate() || 0) - new Date(a.createdAt?.toDate() || 0));
    cache.set("assets", assets);
    return assets;
  } catch (error) {
    handleError(error, "loadAssets");
    return [];
  }
}

// Agregar activo
window.addAsset = async function () {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  const type = document.getElementById("assetType").value;
  const name = document.getElementById("assetName").value;
  const value = parseFloat(document.getElementById("assetValue").value);

  if (!name || !value || value <= 0) {
    showMessage("Por favor completa todos los campos correctamente", "error");
    return;
  }

  try {
    showLoading("Agregando activo...");
    const assetData = {
      userId: currentUser.uid,
      type,
      name,
      value,
      createdAt: Timestamp.now(),
    };
    await addDoc(collection(db, "assets"), assetData);
    cache.clear("assets");
    document.getElementById("assetName").value = "";
    document.getElementById("assetValue").value = "";
    showMessage("✅ Activo agregado exitosamente", "success");
    await loadNetworth();
  } catch (error) {
    handleError(error, "addAsset");
  } finally {
    hideLoading();
  }
};

// Cargar pasivos
async function loadLiabilities() {
  if (!currentUser) return [];
  try {
    const cached = cache.get("liabilities");
    if (cached) return cached;

    const q = query(
      collection(db, "liabilities"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const liabilities = [];
    snapshot.forEach((doc) => {
      liabilities.push({ id: doc.id, ...doc.data() });
    });
    liabilities.sort((a, b) => new Date(b.createdAt?.toDate() || 0) - new Date(a.createdAt?.toDate() || 0));
    cache.set("liabilities", liabilities);
    return liabilities;
  } catch (error) {
    handleError(error, "loadLiabilities");
    return [];
  }
}

// Agregar pasivo
window.addLiability = async function () {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  const type = document.getElementById("liabilityType").value;
  const name = document.getElementById("liabilityName").value;
  const amount = parseFloat(document.getElementById("liabilityAmount").value);
  const interest = parseFloat(document.getElementById("liabilityInterest").value) || 0;
  const minPayment = parseFloat(document.getElementById("liabilityMinPayment").value) || 0;

  if (!name || !amount || amount <= 0) {
    showMessage("Por favor completa todos los campos correctamente", "error");
    return;
  }

  try {
    showLoading("Agregando pasivo...");
    const liabilityData = {
      userId: currentUser.uid,
      type,
      name,
      amount,
      originalAmount: amount, // Guardar el monto original para calcular progreso
      interest,
      minPayment,
      createdAt: Timestamp.now(),
    };
    await addDoc(collection(db, "liabilities"), liabilityData);
    cache.clear("liabilities");
    document.getElementById("liabilityName").value = "";
    document.getElementById("liabilityAmount").value = "";
    document.getElementById("liabilityInterest").value = "";
    document.getElementById("liabilityMinPayment").value = "";
    showMessage("✅ Pasivo agregado exitosamente", "success");
    await loadNetworth();
  } catch (error) {
    handleError(error, "addLiability");
  } finally {
    hideLoading();
  }
};

// Cargar y mostrar patrimonio neto
async function loadNetworth() {
  if (!currentUser) return;
  try {
    showLoading("Cargando patrimonio neto...");
    const assets = await loadAssets();
    const liabilities = await loadLiabilities();

    const totalAssets = assets.reduce((sum, a) => sum + (a.value || 0), 0);
    const totalLiabilities = liabilities.reduce((sum, l) => sum + (l.amount || 0), 0);
    const networth = totalAssets - totalLiabilities;

    // Mostrar cards
    const cards = [
      {
        title: "💰 Total Activos",
        value: `$${totalAssets.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#4ade80",
        icon: "💵",
      },
      {
        title: "💳 Total Pasivos",
        value: `$${totalLiabilities.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#ef4444",
        icon: "💳",
      },
      {
        title: "📊 Patrimonio Neto",
        value: `$${networth.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: networth >= 0 ? "#3b82f6" : "#ef4444",
        icon: "💰",
      },
    ];

    const cardsHTML = cards
      .map(
        (card) => `
      <div class="card" style="border-left: 5px solid ${card.color}; background: white !important; color: #333 !important;">
        <div class="card-header" style="color: #333 !important;">
          <span style="font-size: 24px">${card.icon}</span>
          <h3 style="color: #333 !important; margin: 0;">${card.title}</h3>
        </div>
        <div class="card-value" style="color: ${card.color} !important;">${card.value}</div>
      </div>
    `
      )
      .join("");

    document.getElementById("networthCards").innerHTML = cardsHTML;

    // Mostrar lista de activos
    const assetsHTML = assets
      .map(
        (asset) => `
      <div class="card" style="margin-bottom: 10px; padding: 15px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${asset.name}</strong> (${asset.type})
            <br>
            <small style="color: #666;">Valor: $${asset.value.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</small>
          </div>
          <button onclick="deleteAsset('${asset.id}')" style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">🗑️</button>
        </div>
      </div>
    `
      )
      .join("");

    document.getElementById("assetsList").innerHTML = assetsHTML || "<p>No hay activos registrados</p>";

    // Mostrar lista de pasivos
    const liabilitiesHTML = liabilities
      .map(
        (liability) => `
      <div class="card" style="margin-bottom: 10px; padding: 15px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong>${liability.name}</strong> (${liability.type})
            <br>
            <small style="color: #666;">
              Monto: $${liability.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })} | 
              Interés: ${liability.interest}% | 
              Pago Mínimo: $${liability.minPayment.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
            </small>
          </div>
          <button onclick="deleteLiability('${liability.id}')" style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">🗑️</button>
        </div>
      </div>
    `
      )
      .join("");

    document.getElementById("liabilitiesList").innerHTML = liabilitiesHTML || "<p>No hay pasivos registrados</p>";

    // Gráfico de evolución (simplificado)
    createNetworthChart(assets, liabilities);
  } catch (error) {
    handleError(error, "loadNetworth");
  } finally {
    hideLoading();
  }
}

// Eliminar activo
window.deleteAsset = async function (id) {
  if (!confirm("¿Estás seguro de eliminar este activo?")) return;
  try {
    showLoading("Eliminando activo...");
    await deleteDoc(doc(db, "assets", id));
    cache.clear("assets");
    showMessage("✅ Activo eliminado", "success");
    await loadNetworth();
  } catch (error) {
    handleError(error, "deleteAsset");
  } finally {
    hideLoading();
  }
};

// Eliminar pasivo
window.deleteLiability = async function (id) {
  if (!confirm("¿Estás seguro de eliminar este pasivo?")) return;
  try {
    showLoading("Eliminando pasivo...");
    await deleteDoc(doc(db, "liabilities", id));
    cache.clear("liabilities");
    showMessage("✅ Pasivo eliminado", "success");
    await loadNetworth();
  } catch (error) {
    handleError(error, "deleteLiability");
  } finally {
    hideLoading();
  }
};

// Gráfico de patrimonio neto
function createNetworthChart(assets, liabilities) {
  const ctx = document.getElementById("networthChart");
  if (!ctx) return;

  const totalAssets = assets.reduce((sum, a) => sum + (a.value || 0), 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + (l.amount || 0), 0);
  const networth = totalAssets - totalLiabilities;

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Activos", "Pasivos"],
      datasets: [
        {
          data: [totalAssets, totalLiabilities],
          backgroundColor: ["#4ade80", "#ef4444"],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: `Patrimonio Neto: $${networth.toLocaleString("es-ES", { minimumFractionDigits: 2 })}` },
      },
    },
  });
}

// ============= LIBERTAD FINANCIERA =============

window.calculateFreedom = function () {
  const monthlyExpenses = parseFloat(document.getElementById("monthlyExpenses").value);
  const currentAge = parseInt(document.getElementById("currentAge").value);
  const targetAge = parseInt(document.getElementById("targetAge").value);

  if (!monthlyExpenses || !currentAge || !targetAge || targetAge <= currentAge) {
    showMessage("Por favor completa todos los campos correctamente", "error");
    return;
  }

  const annualExpenses = monthlyExpenses * 12;
  const targetAmount = annualExpenses * 25; // Regla del 4%
  const yearsToSave = targetAge - currentAge;
  const monthsToSave = yearsToSave * 12;

  // Calcular ahorro mensual necesario (asumiendo 7% retorno anual)
  const monthlyReturn = 0.07 / 12;
  let monthlySavings = 0;
  if (yearsToSave > 0) {
    monthlySavings = (targetAmount * monthlyReturn) / (Math.pow(1 + monthlyReturn, monthsToSave) - 1);
  }

  const resultsHTML = `
    <div class="card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 15px; margin-top: 20px;">
      <h3 style="color: white; margin-bottom: 20px;">🚀 Resultados de Libertad Financiera</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
        <div>
          <div style="font-size: 14px; opacity: 0.9;">Gastos Anuales Necesarios</div>
          <div style="font-size: 28px; font-weight: bold;">$${annualExpenses.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</div>
        </div>
        <div>
          <div style="font-size: 14px; opacity: 0.9;">Monto Objetivo (25x gastos)</div>
          <div style="font-size: 28px; font-weight: bold;">$${targetAmount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</div>
        </div>
        <div>
          <div style="font-size: 14px; opacity: 0.9;">Años para Alcanzar</div>
          <div style="font-size: 28px; font-weight: bold;">${yearsToSave} años</div>
        </div>
        <div>
          <div style="font-size: 14px; opacity: 0.9;">Ahorro Mensual Necesario</div>
          <div style="font-size: 28px; font-weight: bold;">$${monthlySavings.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</div>
        </div>
      </div>
      <div style="margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.2); border-radius: 10px;">
        <strong>💡 Nota:</strong> Este cálculo asume un retorno anual del 7% en tus inversiones (ajustado por inflación).
        La regla del 4% significa que puedes retirar el 4% de tu patrimonio anualmente sin agotarlo.
      </div>
    </div>
  `;

  document.getElementById("freedomResults").innerHTML = resultsHTML;

  // Actualizar cards
  const cards = [
    {
      title: "💰 Monto Objetivo",
      value: `$${targetAmount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
      color: "#667eea",
      icon: "🎯",
    },
    {
      title: "📅 Años Restantes",
      value: `${yearsToSave} años`,
      color: "#764ba2",
      icon: "⏰",
    },
    {
      title: "💵 Ahorro Mensual Necesario",
      value: `$${monthlySavings.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
      color: "#4ade80",
      icon: "💰",
    },
  ];

  const cardsHTML = cards
    .map(
      (card) => `
    <div class="card" style="border-left: 5px solid ${card.color}; background: white !important; color: #333 !important;">
      <div class="card-header" style="color: #333 !important;">
        <span style="font-size: 24px">${card.icon}</span>
        <h3 style="color: #333 !important; margin: 0;">${card.title}</h3>
      </div>
      <div class="card-value" style="color: ${card.color} !important;">${card.value}</div>
    </div>
  `
    )
    .join("");

  document.getElementById("freedomCards").innerHTML = cardsHTML;
};

window.simulateFreedom = function () {
  const monthlyExpenses = parseFloat(document.getElementById("monthlyExpenses").value);
  const extraSavings = parseFloat(document.getElementById("extraSavings").value) || 0;

  if (!monthlyExpenses) {
    showMessage("Primero calcula tu libertad financiera", "error");
    return;
  }

  const annualExpenses = monthlyExpenses * 12;
  const targetAmount = annualExpenses * 25;
  const monthlyReturn = 0.07 / 12;

  // Calcular con ahorro actual
  const currentMonthly = parseFloat(document.getElementById("freedomResults")?.textContent.match(/\$[\d,]+\.\d{2}/)?.[0]?.replace(/[$,]/g, "") || 0);
  const newMonthlySavings = currentMonthly + extraSavings;

  // Calcular años necesarios con nuevo ahorro
  let months = 0;
  let balance = 0;
  while (balance < targetAmount && months < 600) {
    balance = balance * (1 + monthlyReturn) + newMonthlySavings;
    months++;
  }

  const newYears = Math.ceil(months / 12);
  const yearsSaved = parseFloat(document.getElementById("currentAge").value) + Math.ceil(months / 12) - parseFloat(document.getElementById("targetAge").value);

  const simHTML = `
    <div class="card" style="background: #f0f9ff; padding: 20px; border-radius: 10px; margin-top: 15px;">
      <h4>📊 Resultados de la Simulación</h4>
      <p><strong>Ahorro mensual adicional:</strong> $${extraSavings.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
      <p><strong>Nuevo ahorro mensual total:</strong> $${newMonthlySavings.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
      <p><strong>Tiempo para alcanzar libertad financiera:</strong> ${newYears} años</p>
      ${yearsSaved > 0 ? `<p style="color: #4ade80;"><strong>✨ Ahorras ${yearsSaved} años!</strong></p>` : ""}
    </div>
  `;

  document.getElementById("simulationResults").innerHTML = simHTML;
};

// ============= GESTIÓN DE DEUDAS =============

// Toggle campos de tarjeta de crédito
window.toggleCreditCardFields = function () {
  const type = document.getElementById("debtType").value;
  const creditCardFields = document.getElementById("creditCardFields");
  if (creditCardFields) {
    creditCardFields.style.display = type === "Tarjeta de Crédito" ? "block" : "none";
  }
};

// Toggle campos de 0% interés
window.toggleZeroInterestFields = function () {
  const hasZeroInterest = document.getElementById("debtHasZeroInterest").value;
  const zeroInterestFields = document.getElementById("zeroInterestFields");
  if (zeroInterestFields) {
    zeroInterestFields.style.display = hasZeroInterest === "yes" ? "block" : "none";
  }
};

window.addDebt = async function () {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  const type = document.getElementById("debtType").value;
  const name = document.getElementById("debtName").value;
  const amount = parseFloat(document.getElementById("debtAmount").value);
  const interest = parseFloat(document.getElementById("debtInterest").value) || 0;
  const minPayment = parseFloat(document.getElementById("debtMinPayment").value) || 0;
  const owner = document.getElementById("debtOwner").value || "Yo";

  if (!name || !amount || amount <= 0) {
    showMessage("Por favor completa todos los campos correctamente", "error");
    return;
  }

  try {
    showLoading("Agregando deuda...");
    const liabilityData = {
      userId: currentUser.uid,
      type,
      name,
      amount,
      originalAmount: amount, // Guardar el monto original para calcular progreso
      interest,
      minPayment,
      owner: owner, // Propietario de la deuda
      createdAt: Timestamp.now(),
    };

    // Agregar campos específicos de tarjeta de crédito
    if (type === "Tarjeta de Crédito") {
      const closingDay = parseInt(document.getElementById("debtClosingDay").value);
      const paymentDay = parseInt(document.getElementById("debtPaymentDay").value);
      const hasZeroInterest = document.getElementById("debtHasZeroInterest").value === "yes";
      
      if (closingDay && closingDay >= 1 && closingDay <= 31) {
        liabilityData.closingDay = closingDay;
      }
      if (paymentDay && paymentDay >= 1 && paymentDay <= 31) {
        liabilityData.paymentDay = paymentDay;
      }
      if (hasZeroInterest) {
        const zeroInterestExpiry = document.getElementById("debtZeroInterestExpiry").value;
        if (zeroInterestExpiry) {
          liabilityData.zeroInterestExpiry = zeroInterestExpiry;
        }
      }
    }

    await addDoc(collection(db, "liabilities"), liabilityData);
    cache.clear("liabilities");
    
    // Limpiar formulario
    document.getElementById("debtName").value = "";
    document.getElementById("debtAmount").value = "";
    document.getElementById("debtInterest").value = "";
    document.getElementById("debtMinPayment").value = "";
    document.getElementById("debtOwner").value = "Yo";
    document.getElementById("debtClosingDay").value = "";
    document.getElementById("debtPaymentDay").value = "";
    document.getElementById("debtHasZeroInterest").value = "no";
    document.getElementById("debtZeroInterestExpiry").value = "";
    toggleCreditCardFields();
    toggleZeroInterestFields();
    
    await displayDebts();
    showMessage("✅ Deuda agregada exitosamente", "success");
  } catch (error) {
    handleError(error, "addDebt");
  } finally {
    hideLoading();
  }
};

window.updateDebtAmount = async function (id) {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  try {
    // Cargar la deuda actual
    const debtDoc = await getDoc(doc(db, "liabilities", id));
    if (!debtDoc.exists()) {
      showMessage("Deuda no encontrada", "error");
      return;
    }

    const debt = { id: debtDoc.id, ...debtDoc.data() };

    const newAmount = prompt(`Monto actual de la deuda "${debt.name}":\n(Monto anterior: $${debt.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })})`, debt.amount);
    if (newAmount === null) return;
    
    const amountValue = parseFloat(newAmount);
    if (isNaN(amountValue) || amountValue < 0) {
      showMessage("Monto inválido", "error");
      return;
    }

    showLoading("Actualizando deuda...");
    await updateDoc(doc(db, "liabilities", id), {
      amount: amountValue,
    });

    cache.clear("liabilities");
    await displayDebts();
    await loadNetworth(); // Actualizar también la sección de patrimonio neto
    showMessage("✅ Deuda actualizada", "success");
  } catch (error) {
    handleError(error, "updateDebtAmount");
  } finally {
    hideLoading();
  }
};

// Registrar pago a una tarjeta/deuda
window.registerPayment = async function (debtId) {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  try {
    const debtDoc = await getDoc(doc(db, "liabilities", debtId));
    if (!debtDoc.exists()) {
      showMessage("Deuda no encontrada", "error");
      return;
    }

    const debt = { id: debtDoc.id, ...debtDoc.data() };
    
    const paymentAmount = prompt(`Registrar pago para "${debt.name}"\nMonto actual: $${debt.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}\n\nIngresa el monto del pago:`, debt.minPayment || 0);
    if (paymentAmount === null) return;
    
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      showMessage("Monto inválido", "error");
      return;
    }

    const paymentDate = prompt("Fecha del pago (YYYY-MM-DD):", new Date().toISOString().split("T")[0]);
    if (paymentDate === null) return;

    showLoading("Registrando pago...");
    
    // Registrar el pago en una subcolección
    const paymentData = {
      debtId: debtId,
      userId: currentUser.uid,
      amount: amount,
      date: paymentDate,
      createdAt: Timestamp.now(),
    };
    
    await addDoc(collection(db, "debtPayments"), paymentData);
    
    // Actualizar el monto de la deuda
    const newAmount = Math.max(0, debt.amount - amount);
    await updateDoc(doc(db, "liabilities", debtId), {
      amount: newAmount,
    });

    cache.clear("liabilities");
    await displayDebts();
    await loadNetworth();
    showMessage(`✅ Pago de $${amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })} registrado exitosamente`, "success");
  } catch (error) {
    handleError(error, "registerPayment");
  } finally {
    hideLoading();
  }
};

// Mostrar historial de pagos
window.showPaymentHistory = async function (debtId) {
  if (!currentUser) return;

  try {
    showLoading("Cargando historial...");
    
    const debtDoc = await getDoc(doc(db, "liabilities", debtId));
    if (!debtDoc.exists()) {
      showMessage("Deuda no encontrada", "error");
      return;
    }

    const debt = { id: debtDoc.id, ...debtDoc.data() };
    
    const q = query(
      collection(db, "debtPayments"),
      where("debtId", "==", debtId),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const payments = [];
    
    snapshot.forEach((doc) => {
      payments.push({ id: doc.id, ...doc.data() });
    });
    
    payments.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA;
    });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    
    const content = `
      <div style="padding: 20px;">
        <h3 style="color: #333; margin-bottom: 15px;">📋 Historial de Pagos: ${debt.name}</h3>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
          <p style="color: #666; margin: 5px 0;"><strong>Total Pagado:</strong> <span style="color: #10b981; font-weight: bold; font-size: 18px;">$${totalPaid.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</span></p>
          <p style="color: #666; margin: 5px 0;"><strong>Monto Actual:</strong> $${debt.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
          <p style="color: #666; margin: 5px 0;"><strong>Total de Pagos:</strong> ${payments.length}</p>
        </div>
        
        ${payments.length > 0 ? `
        <h4 style="color: #333; margin-bottom: 10px;">Pagos Registrados:</h4>
        <div style="max-height: 400px; overflow-y: auto;">
          ${payments.map(payment => `
            <div style="background: white; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #10b981;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <p style="color: #333; margin: 0; font-weight: 600;">$${payment.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
                  <p style="color: #666; margin: 5px 0 0 0; font-size: 13px;">📅 ${formatDate(payment.date)}</p>
                </div>
                <button onclick="deletePayment('${payment.id}', '${debtId}')" style="background: #ef4444; color: white; border: none; padding: 6px 10px; border-radius: 5px; cursor: pointer; font-size: 11px;">🗑️</button>
              </div>
            </div>
          `).join('')}
        </div>
        ` : `
        <div style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 10px;">
          <div style="font-size: 48px; margin-bottom: 15px;">💰</div>
          <p style="color: #666;">No hay pagos registrados aún</p>
        </div>
        `}
      </div>
    `;

    document.getElementById("modalTitle").textContent = "Historial de Pagos";
    document.getElementById("modalBody").innerHTML = content;
    document.getElementById("detailModal").classList.add("active");
  } catch (error) {
    handleError(error, "showPaymentHistory");
  } finally {
    hideLoading();
  }
};

// Eliminar pago
window.deletePayment = async function (paymentId, debtId) {
  if (!confirm("¿Estás seguro de eliminar este pago? El monto se agregará de vuelta a la deuda.")) return;

  try {
    showLoading("Eliminando pago...");
    
    const paymentDoc = await getDoc(doc(db, "debtPayments", paymentId));
    if (!paymentDoc.exists()) {
      showMessage("Pago no encontrado", "error");
      return;
    }

    const payment = paymentDoc.data();
    const debtDoc = await getDoc(doc(db, "liabilities", debtId));
    if (!debtDoc.exists()) {
      showMessage("Deuda no encontrada", "error");
      return;
    }

    const debt = debtDoc.data();
    
    // Restaurar el monto a la deuda
    await updateDoc(doc(db, "liabilities", debtId), {
      amount: debt.amount + payment.amount,
    });
    
    // Eliminar el pago
    await deleteDoc(doc(db, "debtPayments", paymentId));

    cache.clear("liabilities");
    await displayDebts();
    await loadNetworth();
    showMessage("✅ Pago eliminado", "success");
    
    // Cerrar modal y recargar historial
    closeModal();
    await showPaymentHistory(debtId);
  } catch (error) {
    handleError(error, "deletePayment");
  } finally {
    hideLoading();
  }
};

async function loadDebts() {
  if (!currentUser) return [];
  const liabilities = await loadLiabilities();
  return liabilities.filter((l) => l.amount > 0);
}

async function displayDebts() {
  if (!currentUser) return;
  try {
    showLoading("Cargando deudas...");
    let debts = await loadDebts();
    
    // Aplicar filtro por propietario
    const ownerFilter = document.getElementById("debtOwnerFilter")?.value || "all";
    if (ownerFilter !== "all") {
      debts = debts.filter(d => (d.owner || "Yo") === ownerFilter);
    }

    const totalDebt = debts.reduce((sum, d) => sum + (d.amount || 0), 0);
    const totalMinPayments = debts.reduce((sum, d) => sum + (d.minPayment || 0), 0);
    const avgInterest = debts.length > 0 ? debts.reduce((sum, d) => sum + (d.interest || 0), 0) / debts.length : 0;

    const cards = [
      {
        title: "💳 Deuda Total",
        value: `$${totalDebt.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#ef4444",
        icon: "💳",
      },
      {
        title: "💰 Pago Mínimo Mensual",
        value: `$${totalMinPayments.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#f59e0b",
        icon: "💵",
      },
      {
        title: "📊 Interés Promedio",
        value: `${avgInterest.toFixed(2)}%`,
        color: "#8b5cf6",
        icon: "📈",
      },
    ];

    const cardsHTML = cards
      .map(
        (card) => `
      <div class="card" style="border-left: 5px solid ${card.color}; background: white !important; color: #333 !important;">
        <div class="card-header" style="color: #333 !important;">
          <span style="font-size: 24px">${card.icon}</span>
          <h3 style="color: #333 !important; margin: 0;">${card.title}</h3>
        </div>
        <div class="card-value" style="color: ${card.color} !important;">${card.value}</div>
      </div>
    `
      )
      .join("");

    document.getElementById("debtsCards").innerHTML = cardsHTML;

    const debtsHTML = debts.length > 0 ? debts
      .map(
        (debt) => {
          const progress = debt.originalAmount ? ((1 - debt.amount / debt.originalAmount) * 100).toFixed(1) : 0;
          
          // Calcular alertas y fechas importantes
          const alerts = [];
          const today = new Date();
          const currentDay = today.getDate();
          const currentMonth = today.getMonth();
          const currentYear = today.getFullYear();
          
          // Alerta para fecha de cierre
          if (debt.closingDay) {
            const daysUntilClosing = debt.closingDay >= currentDay 
              ? debt.closingDay - currentDay 
              : (new Date(currentYear, currentMonth + 1, 0).getDate() - currentDay) + debt.closingDay;
            if (daysUntilClosing <= 3 && daysUntilClosing >= 0) {
              alerts.push({ type: "warning", message: `⚠️ Cierre de ciclo en ${daysUntilClosing} día(s) (día ${debt.closingDay})` });
            }
          }
          
          // Alerta para fecha de pago
          if (debt.paymentDay) {
            const daysUntilPayment = debt.paymentDay >= currentDay 
              ? debt.paymentDay - currentDay 
              : (new Date(currentYear, currentMonth + 1, 0).getDate() - currentDay) + debt.paymentDay;
            if (daysUntilPayment <= 5 && daysUntilPayment >= 0) {
              alerts.push({ type: "danger", message: `🔴 Pago vence en ${daysUntilPayment} día(s) (día ${debt.paymentDay})` });
            }
          }
          
          // Alerta para caducidad de 0% interés
          if (debt.zeroInterestExpiry) {
            const expiryDate = new Date(debt.zeroInterestExpiry);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry <= 30 && daysUntilExpiry >= 0) {
              alerts.push({ type: "info", message: `ℹ️ 0% interés caduca en ${daysUntilExpiry} día(s)` });
            } else if (daysUntilExpiry < 0) {
              alerts.push({ type: "danger", message: `🔴 0% interés caducó hace ${Math.abs(daysUntilExpiry)} día(s)` });
            }
          }
          
          // Obtener icono de propietario
          const ownerIcon = debt.owner === "Yo" ? "👤" : debt.owner === "Esposa" ? "👩" : "👥";
          
          return `
      <div class="card" style="margin-bottom: 15px; padding: 20px; background: white; border-left: 5px solid #ef4444; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" onclick="showDebtDetails('${debt.id}')" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
        ${alerts.length > 0 ? `
        <div style="margin-bottom: 15px;">
          ${alerts.map(alert => `
            <div style="background: ${alert.type === 'danger' ? '#fee2e2' : alert.type === 'warning' ? '#fef3c7' : '#dbeafe'}; 
                        color: ${alert.type === 'danger' ? '#991b1b' : alert.type === 'warning' ? '#92400e' : '#1e40af'}; 
                        padding: 10px; border-radius: 5px; margin-bottom: 5px; font-size: 13px; font-weight: 500;">
              ${alert.message}
            </div>
          `).join('')}
        </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
              <h4 style="color: #333; margin: 0;">${debt.name}</h4>
              <span style="background: #e0e7ff; color: #4338ca; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">${ownerIcon} ${debt.owner || "Yo"}</span>
            </div>
            <p style="color: #666; margin: 5px 0;"><strong>Tipo:</strong> ${debt.type}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Monto Actual:</strong> <span style="color: #ef4444; font-weight: bold;">$${debt.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</span></p>
            ${debt.originalAmount ? `<p style="color: #666; margin: 5px 0;"><strong>Monto Original:</strong> $${debt.originalAmount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>` : ''}
            <p style="color: #666; margin: 5px 0;"><strong>Interés:</strong> ${debt.interest || 0}% anual</p>
            <p style="color: #666; margin: 5px 0;"><strong>Pago Mínimo:</strong> $${(debt.minPayment || 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })}/mes</p>
            
            ${debt.closingDay ? `<p style="color: #666; margin: 5px 0;"><strong>📅 Cierre de Ciclo:</strong> Día ${debt.closingDay} de cada mes</p>` : ''}
            ${debt.paymentDay ? `<p style="color: #666; margin: 5px 0;"><strong>💳 Fecha de Pago:</strong> Día ${debt.paymentDay} de cada mes</p>` : ''}
            ${debt.zeroInterestExpiry ? `<p style="color: #666; margin: 5px 0;"><strong>⏰ 0% Interés hasta:</strong> ${formatDate(debt.zeroInterestExpiry)}</p>` : ''}
            
            ${debt.originalAmount ? `
            <div style="margin-top: 15px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span style="color: #666; font-size: 12px;">Progreso de pago</span>
                <span style="color: #4ade80; font-weight: bold; font-size: 12px;">${progress}%</span>
              </div>
              <div style="background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="background: #4ade80; height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
              </div>
            </div>
            ` : ''}
          </div>
          <div style="display: flex; flex-direction: column; gap: 5px; margin-left: 15px;">
            <button onclick="event.stopPropagation(); showDebtDetails('${debt.id}')" style="background: #8b5cf6; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-size: 12px;">👁️ Ver Detalles</button>
            <button onclick="event.stopPropagation(); registerPayment('${debt.id}')" style="background: #10b981; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-size: 12px;">💰 Registrar Pago</button>
            <button onclick="event.stopPropagation(); showPaymentHistory('${debt.id}')" style="background: #6366f1; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-size: 12px;">📋 Historial</button>
            <button onclick="event.stopPropagation(); updateDebtAmount('${debt.id}')" style="background: #3b82f6; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-size: 12px;">✏️ Actualizar</button>
            <button onclick="event.stopPropagation(); deleteLiability('${debt.id}')" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; font-size: 12px;">🗑️ Eliminar</button>
          </div>
        </div>
      </div>
    `;
        }
      )
      .join("") : `
      <div class="empty-state" style="text-align: center; padding: 40px; background: white; border-radius: 10px;">
        <div style="font-size: 48px; margin-bottom: 15px;">💳</div>
        <p style="color: #666; font-size: 16px;">No hay deudas registradas</p>
        <p style="color: #999; font-size: 14px; margin-top: 5px;">Agrega tu primera deuda usando el formulario de arriba</p>
      </div>
    `;

    document.getElementById("debtsList").innerHTML = debtsHTML;

    updateDebtStrategy();
  } catch (error) {
    handleError(error, "displayDebts");
  } finally {
    hideLoading();
  }
}

window.updateDebtStrategy = function () {
  const strategy = document.getElementById("debtStrategy").value;
  loadDebts().then((debts) => {
    if (debts.length === 0) {
      document.getElementById("debtPlan").innerHTML = "<p>No hay deudas para planificar</p>";
      return;
    }

    let sortedDebts = [];
    if (strategy === "snowball") {
      sortedDebts = [...debts].sort((a, b) => a.amount - b.amount);
    } else {
      sortedDebts = [...debts].sort((a, b) => (b.interest || 0) - (a.interest || 0));
    }

    const planHTML = `
      <div class="card" style="background: #f0f9ff; padding: 20px; border-radius: 10px; margin-top: 15px;">
        <h4 style="color: #333 !important;">📋 Plan de Pago (${strategy === "snowball" ? "Bola de Nieve" : "Avalancha"})</h4>
        <ol style="margin-top: 15px;">
          ${sortedDebts
            .map(
              (debt, index) => `
            <li style="margin-bottom: 10px; padding: 10px; background: white; border-radius: 5px; color: #333;">
              <strong style="color: #333 !important;">${debt.name}</strong> - 
              Monto: $${debt.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })} | 
              Interés: ${debt.interest}% | 
              Pago Mínimo: $${debt.minPayment.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
            </li>
          `
            )
            .join("")}
        </ol>
        <p style="margin-top: 15px; color: #666;">
          <strong style="color: #333 !important;">Estrategia:</strong> ${strategy === "snowball" ? "Paga primero la deuda más pequeña para ganar momentum psicológico" : "Paga primero la deuda con mayor interés para ahorrar más dinero"}
        </p>
      </div>
    `;

    document.getElementById("debtPlan").innerHTML = planHTML;
  });
};

// ============= INVERSIONES =============

async function loadInvestments() {
  if (!currentUser) return [];
  try {
    const cached = cache.get("investments");
    if (cached) return cached;

    const q = query(
      collection(db, "investments"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const investments = [];
    snapshot.forEach((doc) => {
      investments.push({ id: doc.id, ...doc.data() });
    });
    investments.sort((a, b) => new Date(b.date?.toDate() || 0) - new Date(a.date?.toDate() || 0));
    cache.set("investments", investments);
    return investments;
  } catch (error) {
    handleError(error, "loadInvestments");
    return [];
  }
}

window.addInvestment = async function () {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  const type = document.getElementById("investmentType").value;
  const name = document.getElementById("investmentName").value;
  const amount = parseFloat(document.getElementById("investmentAmount").value);
  const currentValue = parseFloat(document.getElementById("investmentCurrentValue").value);
  const date = document.getElementById("investmentDate").value;

  if (!name || !amount || amount <= 0 || !date) {
    showMessage("Por favor completa todos los campos correctamente", "error");
    return;
  }

  try {
    showLoading("Agregando inversión...");
    const investmentData = {
      userId: currentUser.uid,
      type,
      name,
      amount,
      currentValue: currentValue || amount,
      date: Timestamp.fromDate(new Date(date)),
      createdAt: Timestamp.now(),
    };
    await addDoc(collection(db, "investments"), investmentData);
    cache.clear("investments");
    document.getElementById("investmentName").value = "";
    document.getElementById("investmentAmount").value = "";
    document.getElementById("investmentCurrentValue").value = "";
    document.getElementById("investmentDate").value = "";
    showMessage("✅ Inversión agregada exitosamente", "success");
    await displayInvestments();
  } catch (error) {
    handleError(error, "addInvestment");
  } finally {
    hideLoading();
  }
};

async function displayInvestments() {
  if (!currentUser) return;
  try {
    showLoading("Cargando inversiones...");
    const investments = await loadInvestments();

    const totalInvested = investments.reduce((sum, i) => sum + (i.amount || 0), 0);
    const totalValue = investments.reduce((sum, i) => sum + (i.currentValue || i.amount || 0), 0);
    const totalReturn = totalValue - totalInvested;
    const returnPercent = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

    const cards = [
      {
        title: "💰 Total Invertido",
        value: `$${totalInvested.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#3b82f6",
        icon: "💵",
      },
      {
        title: "📈 Valor Actual",
        value: `$${totalValue.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#4ade80",
        icon: "📊",
      },
      {
        title: "📊 Ganancia/Pérdida",
        value: `$${totalReturn.toLocaleString("es-ES", { minimumFractionDigits: 2 })} (${returnPercent >= 0 ? "+" : ""}${returnPercent.toFixed(2)}%)`,
        color: returnPercent >= 0 ? "#4ade80" : "#ef4444",
        icon: returnPercent >= 0 ? "📈" : "📉",
      },
    ];

    const cardsHTML = cards
      .map(
        (card) => `
      <div class="card" style="border-left: 5px solid ${card.color}; background: white !important; color: #333 !important;">
        <div class="card-header" style="color: #333 !important;">
          <span style="font-size: 24px">${card.icon}</span>
          <h3 style="color: #333 !important; margin: 0;">${card.title}</h3>
        </div>
        <div class="card-value" style="color: ${card.color} !important;">${card.value}</div>
      </div>
    `
      )
      .join("");

    document.getElementById("investmentsCards").innerHTML = cardsHTML;

    const investmentsHTML = investments
      .map((investment) => {
        const returnAmount = (investment.currentValue || investment.amount) - investment.amount;
        const returnPct = investment.amount > 0 ? (returnAmount / investment.amount) * 100 : 0;
        return `
      <div class="card" style="margin-bottom: 15px; padding: 20px; background: white !important; color: #333 !important;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <h4 style="color: #333 !important; margin-bottom: 10px;">${investment.name} (${investment.type})</h4>
            <p style="color: #666; margin: 5px 0;"><strong style="color: #333;">Invertido:</strong> $${investment.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
            <p style="color: #666; margin: 5px 0;"><strong style="color: #333;">Valor Actual:</strong> $${(investment.currentValue || investment.amount).toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
            <p style="color: ${returnPct >= 0 ? "#4ade80" : "#ef4444"}; margin: 5px 0;">
              <strong style="color: #333;">Rendimiento:</strong> $${returnAmount.toLocaleString("es-ES", { minimumFractionDigits: 2 })} (${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%)
            </p>
          </div>
          <button onclick="deleteInvestment('${investment.id}')" style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">🗑️</button>
        </div>
      </div>
    `;
      })
      .join("");

    document.getElementById("investmentsList").innerHTML = investmentsHTML || "<p>No hay inversiones registradas</p>";

    createInvestmentsChart(investments);
  } catch (error) {
    handleError(error, "displayInvestments");
  } finally {
    hideLoading();
  }
}

window.deleteInvestment = async function (id) {
  if (!confirm("¿Estás seguro de eliminar esta inversión?")) return;
  try {
    showLoading("Eliminando inversión...");
    await deleteDoc(doc(db, "investments", id));
    cache.clear("investments");
    showMessage("✅ Inversión eliminada", "success");
    await displayInvestments();
  } catch (error) {
    handleError(error, "deleteInvestment");
  } finally {
    hideLoading();
  }
};

function createInvestmentsChart(investments) {
  const ctx = document.getElementById("investmentsChart");
  if (!ctx) return;

  const types = {};
  investments.forEach((inv) => {
    types[inv.type] = (types[inv.type] || 0) + (inv.currentValue || inv.amount);
  });

  new Chart(ctx, {
    type: "pie",
    data: {
      labels: Object.keys(types),
      datasets: [
        {
          data: Object.values(types),
          backgroundColor: ["#3b82f6", "#4ade80", "#f59e0b", "#ef4444", "#8b5cf6"],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: "Distribución de Inversiones por Tipo" },
      },
    },
  });
}

// ============= PRESUPUESTOS POR CATEGORÍA =============

async function loadBudgets() {
  if (!currentUser) return [];
  try {
    const cached = cache.get("budgets");
    if (cached) return cached;

    const q = query(
      collection(db, "budgets"),
      where("userId", "==", currentUser.uid)
    );
    const snapshot = await getDocs(q);
    const budgets = [];
    snapshot.forEach((doc) => {
      budgets.push({ id: doc.id, ...doc.data() });
    });
    budgets.sort((a, b) => {
      if (a.month && b.month) {
        return b.month.localeCompare(a.month);
      }
      return 0;
    });
    cache.set("budgets", budgets);
    return budgets;
  } catch (error) {
    handleError(error, "loadBudgets");
    return [];
  }
}

window.createBudget = async function () {
  if (!currentUser) {
    showMessage("Debes iniciar sesión", "error");
    return;
  }

  const category = document.getElementById("budgetCategory").value;
  const limit = parseFloat(document.getElementById("budgetLimit").value);
  const month = document.getElementById("budgetMonth").value;

  if (!category || !limit || limit <= 0 || !month) {
    showMessage("Por favor completa todos los campos correctamente", "error");
    return;
  }

  try {
    showLoading("Creando presupuesto...");
    const budgetData = {
      userId: currentUser.uid,
      category,
      limit,
      month,
      createdAt: Timestamp.now(),
    };
    await addDoc(collection(db, "budgets"), budgetData);
    cache.clear("budgets");
    document.getElementById("budgetLimit").value = "";
    showMessage("✅ Presupuesto creado exitosamente", "success");
    await displayBudgets();
  } catch (error) {
    handleError(error, "createBudget");
  } finally {
    hideLoading();
  }
};

async function displayBudgets() {
  if (!currentUser) return;
  try {
    showLoading("Cargando presupuestos...");
    const budgets = await loadBudgets();
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Cargar gastos del mes actual
    const allExpenses = await loadAllExpenses();
    const currentMonthExpenses = allExpenses.filter((e) => {
      const expenseDate = e.date || e.createdAt?.toDate();
      if (!expenseDate) return false;
      const expenseMonth = new Date(expenseDate).toISOString().slice(0, 7);
      return expenseMonth === currentMonth;
    });

    // Calcular gastos por categoría
    const expensesByCategory = {};
    currentMonthExpenses.forEach((expense) => {
      const cat = expense.category || "Otros";
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + (expense.amount || 0);
    });

    const totalBudget = budgets.reduce((sum, b) => sum + (b.limit || 0), 0);
    const totalSpent = Object.values(expensesByCategory).reduce((sum, v) => sum + v, 0);

    const cards = [
      {
        title: "📋 Presupuesto Total",
        value: `$${totalBudget.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#3b82f6",
        icon: "💰",
      },
      {
        title: "💸 Gasto Real",
        value: `$${totalSpent.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#ef4444",
        icon: "💵",
      },
      {
        title: "📊 Restante",
        value: `$${(totalBudget - totalSpent).toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: totalBudget - totalSpent >= 0 ? "#4ade80" : "#ef4444",
        icon: "📈",
      },
    ];

    const cardsHTML = cards
      .map(
        (card) => `
      <div class="card" style="border-left: 5px solid ${card.color}; background: white !important; color: #333 !important;">
        <div class="card-header" style="color: #333 !important;">
          <span style="font-size: 24px">${card.icon}</span>
          <h3 style="color: #333 !important; margin: 0;">${card.title}</h3>
        </div>
        <div class="card-value" style="color: ${card.color} !important;">${card.value}</div>
      </div>
    `
      )
      .join("");

    document.getElementById("budgetsCards").innerHTML = cardsHTML;

    const budgetsHTML = budgets
      .map((budget) => {
        const spent = expensesByCategory[budget.category] || 0;
        const remaining = budget.limit - spent;
        const percent = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
        return `
      <div class="card" style="margin-bottom: 15px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div style="flex: 1;">
            <h4>${budget.category} - ${budget.month}</h4>
            <p style="color: #666; margin: 5px 0;"><strong>Límite:</strong> $${budget.limit.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Gastado:</strong> $${spent.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</p>
            <p style="color: ${remaining >= 0 ? "#4ade80" : "#ef4444"}; margin: 5px 0;">
              <strong>Restante:</strong> $${remaining.toLocaleString("es-ES", { minimumFractionDigits: 2 })} (${percent.toFixed(1)}%)
            </p>
            <div style="margin-top: 10px; background: #e5e7eb; height: 10px; border-radius: 5px; overflow: hidden;">
              <div style="background: ${percent > 100 ? "#ef4444" : percent > 80 ? "#f59e0b" : "#4ade80"}; height: 100%; width: ${Math.min(percent, 100)}%; transition: width 0.3s;"></div>
            </div>
          </div>
          <button onclick="deleteBudget('${budget.id}')" style="background: #ef4444; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">🗑️</button>
        </div>
      </div>
    `;
      })
      .join("");

    document.getElementById("budgetsList").innerHTML = budgetsHTML || "<p>No hay presupuestos creados</p>";

    createBudgetsChart(budgets, expensesByCategory);
  } catch (error) {
    handleError(error, "displayBudgets");
  } finally {
    hideLoading();
  }
}

window.deleteBudget = async function (id) {
  if (!confirm("¿Estás seguro de eliminar este presupuesto?")) return;
  try {
    showLoading("Eliminando presupuesto...");
    await deleteDoc(doc(db, "budgets", id));
    cache.clear("budgets");
    showMessage("✅ Presupuesto eliminado", "success");
    await displayBudgets();
  } catch (error) {
    handleError(error, "deleteBudget");
  } finally {
    hideLoading();
  }
};

function createBudgetsChart(budgets, expensesByCategory) {
  const ctx = document.getElementById("budgetsChart");
  if (!ctx) return;

  const categories = budgets.map((b) => b.category);
  const limits = budgets.map((b) => b.limit);
  const spent = categories.map((cat) => expensesByCategory[cat] || 0);

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: categories,
      datasets: [
        {
          label: "Presupuesto",
          data: limits,
          backgroundColor: "#3b82f6",
        },
        {
          label: "Gastado",
          data: spent,
          backgroundColor: "#ef4444",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: "Presupuesto vs Gasto Real" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

// ============= TENDENCIAS Y ANÁLISIS =============

async function loadTrends() {
  if (!currentUser) return;
  try {
    showLoading("Analizando tendencias...");

    // Cargar datos de los últimos 6 meses
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(date.toISOString().slice(0, 7));
    }

    const allIncomes = await loadAllIncomes();
    const allExpenses = await loadAllExpenses();

    const monthlyData = months.map((month) => {
      const monthIncomes = allIncomes.filter((inc) => {
        const incDate = inc.date || inc.createdAt?.toDate();
        if (!incDate) return false;
        return new Date(incDate).toISOString().slice(0, 7) === month;
      });
      const monthExpenses = allExpenses.filter((exp) => {
        const expDate = exp.date || exp.createdAt?.toDate();
        if (!expDate) return false;
        return new Date(expDate).toISOString().slice(0, 7) === month;
      });

      const totalIncome = monthIncomes.reduce((sum, i) => sum + (i.amount || 0), 0);
      const totalExpense = monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

      return {
        month,
        income: totalIncome,
        expense: totalExpense,
        balance: totalIncome - totalExpense,
      };
    });

    // Cards
    const avgIncome = monthlyData.reduce((sum, m) => sum + m.income, 0) / monthlyData.length;
    const avgExpense = monthlyData.reduce((sum, m) => sum + m.expense, 0) / monthlyData.length;
    const avgBalance = monthlyData.reduce((sum, m) => sum + m.balance, 0) / monthlyData.length;
    const trend = monthlyData[monthlyData.length - 1].balance - monthlyData[0].balance;

    const cards = [
      {
        title: "📊 Ingreso Promedio",
        value: `$${avgIncome.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#4ade80",
        icon: "💵",
      },
      {
        title: "💸 Gasto Promedio",
        value: `$${avgExpense.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#ef4444",
        icon: "💳",
      },
      {
        title: "💰 Balance Promedio",
        value: `$${avgBalance.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: "#3b82f6",
        icon: "📈",
      },
      {
        title: "📉 Tendencia",
        value: `${trend >= 0 ? "+" : ""}$${trend.toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
        color: trend >= 0 ? "#4ade80" : "#ef4444",
        icon: trend >= 0 ? "📈" : "📉",
      },
    ];

    const cardsHTML = cards
      .map(
        (card) => `
      <div class="card" style="border-left: 5px solid ${card.color}; background: white !important; color: #333 !important;">
        <div class="card-header" style="color: #333 !important;">
          <span style="font-size: 24px">${card.icon}</span>
          <h3 style="color: #333 !important; margin: 0;">${card.title}</h3>
        </div>
        <div class="card-value" style="color: ${card.color} !important;">${card.value}</div>
      </div>
    `
      )
      .join("");

    document.getElementById("trendsCards").innerHTML = cardsHTML;

    // Gráfico de tendencias
    createTrendsChart(monthlyData);

    // Análisis por categoría
    const categoryData = {};
    allExpenses.forEach((exp) => {
      const cat = exp.category || "Otros";
      categoryData[cat] = (categoryData[cat] || 0) + (exp.amount || 0);
    });

    createCategoryTrendsChart(categoryData);

    // Insights
    generateInsights(monthlyData, categoryData, avgIncome, avgExpense);

    // Comparativa mes a mes
    displayMonthComparison(monthlyData);
  } catch (error) {
    handleError(error, "loadTrends");
  } finally {
    hideLoading();
  }
}

function createTrendsChart(monthlyData) {
  const ctx = document.getElementById("trendsChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "line",
    data: {
      labels: monthlyData.map((m) => {
        const [year, month] = m.month.split("-");
        return `${month}/${year}`;
      }),
      datasets: [
        {
          label: "Ingresos",
          data: monthlyData.map((m) => m.income),
          borderColor: "#4ade80",
          backgroundColor: "rgba(74, 222, 128, 0.1)",
          tension: 0.4,
        },
        {
          label: "Gastos",
          data: monthlyData.map((m) => m.expense),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.1)",
          tension: 0.4,
        },
        {
          label: "Balance",
          data: monthlyData.map((m) => m.balance),
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: "Tendencias de Ingresos y Gastos (Últimos 6 Meses)" },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
}

function createCategoryTrendsChart(categoryData) {
  const ctx = document.getElementById("categoryTrendsChart");
  if (!ctx) return;

  const categories = Object.keys(categoryData);
  const amounts = Object.values(categoryData);

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: categories,
      datasets: [
        {
          data: amounts,
          backgroundColor: [
            "#3b82f6",
            "#4ade80",
            "#f59e0b",
            "#ef4444",
            "#8b5cf6",
            "#ec4899",
            "#06b6d4",
          ],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" },
        title: { display: true, text: "Distribución de Gastos por Categoría" },
      },
    },
  });
}

function generateInsights(monthlyData, categoryData, avgIncome, avgExpense) {
  const insights = [];
  const savingsRate = avgIncome > 0 ? ((avgIncome - avgExpense) / avgIncome) * 100 : 0;

  if (savingsRate > 20) {
    insights.push("✅ Excelente tasa de ahorro. Estás en el camino correcto hacia la libertad financiera.");
  } else if (savingsRate > 10) {
    insights.push("⚠️ Tu tasa de ahorro es buena, pero puedes mejorarla reduciendo gastos innecesarios.");
  } else if (savingsRate > 0) {
    insights.push("⚠️ Tu tasa de ahorro es baja. Considera revisar tus gastos y aumentar tus ingresos.");
  } else {
    insights.push("❌ Estás gastando más de lo que ganas. Es urgente revisar tus finanzas.");
  }

  const topCategory = Object.entries(categoryData).sort((a, b) => b[1] - a[1])[0];
  if (topCategory) {
    insights.push(`📊 Tu mayor categoría de gasto es "${topCategory[0]}" con $${topCategory[1].toLocaleString("es-ES", { minimumFractionDigits: 2 })}.`);
  }

  const trend = monthlyData[monthlyData.length - 1].balance - monthlyData[0].balance;
  if (trend > 0) {
    insights.push("📈 Tu balance está mejorando mes a mes. ¡Sigue así!");
  } else {
    insights.push("📉 Tu balance está empeorando. Revisa tus gastos y busca formas de aumentar tus ingresos.");
  }

  const expenseRatio = avgIncome > 0 ? (avgExpense / avgIncome) * 100 : 0;
  if (expenseRatio > 90) {
    insights.push("⚠️ Estás gastando más del 90% de tus ingresos. Esto es peligroso para tu salud financiera.");
  }

  document.getElementById("insights").innerHTML = `
    <ul style="list-style: none; padding: 0;">
      ${insights.map((insight) => `<li style="padding: 10px; margin-bottom: 10px; background: white; border-radius: 5px; border-left: 4px solid #3b82f6;">${insight}</li>`).join("")}
    </ul>
  `;
}

function displayMonthComparison(monthlyData) {
  const comparisonHTML = `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e5e7eb;">Mes</th>
          <th style="padding: 10px; text-align: right; border-bottom: 2px solid #e5e7eb;">Ingresos</th>
          <th style="padding: 10px; text-align: right; border-bottom: 2px solid #e5e7eb;">Gastos</th>
          <th style="padding: 10px; text-align: right; border-bottom: 2px solid #e5e7eb;">Balance</th>
        </tr>
      </thead>
      <tbody>
        ${monthlyData
          .map(
            (m) => `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px;">${new Date(m.month + "-01").toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</td>
            <td style="padding: 10px; text-align: right; color: #4ade80;">$${m.income.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</td>
            <td style="padding: 10px; text-align: right; color: #ef4444;">$${m.expense.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</td>
            <td style="padding: 10px; text-align: right; color: ${m.balance >= 0 ? "#4ade80" : "#ef4444"}; font-weight: bold;">
              $${m.balance.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;

  document.getElementById("monthComparison").innerHTML = comparisonHTML;
}


