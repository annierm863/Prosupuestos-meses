# 🛡️ ARQUITECTURA AJUSTADA - Preservación de Datos

## ✅ PRINCIPIOS DE DISEÑO

1. **100% Compatible Hacia Atrás**: Todos los campos nuevos son opcionales
2. **Sin Migración Forzada**: Los datos existentes funcionan sin cambios
3. **Extensión, No Modificación**: Nuevas funciones, no cambios a las existentes
4. **Datos Preservados**: Cero riesgo de pérdida de datos

---

## 📊 ESTRUCTURA DE DATOS - COMPATIBLE

### **Metas Existentes (Sin Cambios)**
```javascript
// Estructura ACTUAL (se mantiene igual)
{
  userId: "user_uid",
  name: "Fondo de Emergencia",
  target: 15000.00,
  current: 3000.00,
  deadline: "2026-11-30",
  createdAt: Timestamp
}
```

### **Metas Extendidas (Campos Opcionales)**
```javascript
// Estructura NUEVA (campos adicionales, todos opcionales)
{
  // ... campos existentes se mantienen ...
  
  // NUEVOS CAMPOS (opcionales - solo se agregan si el usuario los usa)
  type: "savings" | "debt" | "composite", // Default: "savings" si no existe
  linkedDebtId: null, // Solo si type === "debt"
  weeklyTarget: null, // Calculado automáticamente cuando se necesita
  monthlyTarget: null, // Calculado automáticamente cuando se necesita
  status: null, // Calculado automáticamente: "EN_RUTA" | "RIESGO" | "ATRASADA"
  allocationPercentage: null, // Default: 40 para savings, 60 para debt
  isActive: true, // Default: true si no existe
  
  // Metadatos nuevos (opcionales)
  updatedAt: null // Se agrega cuando se actualiza
}
```

**Estrategia de Compatibilidad:**
- Si `type` no existe → asumir `"savings"` (comportamiento actual)
- Si `weeklyTarget` no existe → calcularlo on-demand cuando se muestre
- Si `status` no existe → calcularlo on-demand
- Las funciones existentes siguen funcionando igual

---

## 🔄 FUNCIONES - ESTRATEGIA DE EXTENSIÓN

### **1. Funciones Existentes (NO TOCAR)**
```javascript
// ✅ Estas funciones NO se modifican
- createGoal() // Se mantiene igual
- loadGoals() // Se mantiene igual
- displayGoals() // Se extiende, no se reemplaza
- editGoal() // Se mantiene igual
- deleteGoal() // Se mantiene igual
```

### **2. Nuevas Funciones (EXTENSIÓN)**
```javascript
// ✅ Nuevas funciones que extienden funcionalidad
- createDebtGoal() // Nueva - crea meta vinculada a deuda
- calculateGoalTargets() // Nueva - calcula weeklyTarget/monthlyTarget
- calculateGoalStatus() // Nueva - calcula EN_RUTA/RIESGO/ATRASADA
- getGoalWithCalculations() // Nueva - wrapper que agrega cálculos a metas existentes
- calculateWeeklySurplus() // Nueva - calcula excedente semanal
- generateWeeklyPlan() // Nueva - genera plan semanal
```

### **3. Funciones Mejoradas (EXTENSIÓN, NO REEMPLAZO)**
```javascript
// ✅ displayGoals() se extiende, no se reemplaza
function displayGoals(goals) {
  // Código existente se mantiene...
  
  // NUEVO: Agregar cálculos si no existen
  const enrichedGoals = goals.map(goal => {
    if (!goal.weeklyTarget) {
      goal.weeklyTarget = calculateWeeklyTarget(goal);
    }
    if (!goal.status) {
      goal.status = calculateGoalStatus(goal);
    }
    return goal;
  });
  
  // Mostrar con nueva información (si está disponible)
  // Si no está disponible, mostrar como antes
}
```

---

## 🗄️ NUEVAS COLECCIONES (OPCIONALES)

### **1. weeklyPlans** (Nueva - No afecta datos existentes)
```javascript
// Solo se crea cuando el usuario usa la funcionalidad de plan semanal
// Si no existe, no afecta nada
```

### **2. goalTransactions** (Nueva - No afecta datos existentes)
```javascript
// Solo se crea cuando se registran transacciones desde el plan
// Si no existe, no afecta nada
```

### **3. userAllocationProfile** (Nueva - No afecta datos existentes)
```javascript
// Solo se crea cuando el usuario configura su perfil
// Si no existe, usa defaults (60/40)
```

---

## 🔧 FUNCIONES DE COMPATIBILIDAD

### **Helper: Enriquecer Meta con Cálculos**
```javascript
/**
 * Agrega cálculos a una meta sin modificar la original
 * Si la meta ya tiene los campos, los usa
 * Si no, los calcula on-demand
 */
function enrichGoalWithCalculations(goal) {
  // Crear copia para no modificar original
  const enriched = { ...goal };
  
  // Calcular type si no existe (default: "savings")
  if (!enriched.type) {
    enriched.type = enriched.linkedDebtId ? "debt" : "savings";
  }
  
  // Calcular weeklyTarget si no existe
  if (!enriched.weeklyTarget) {
    enriched.weeklyTarget = calculateWeeklyTarget(enriched);
  }
  
  // Calcular monthlyTarget si no existe
  if (!enriched.monthlyTarget) {
    enriched.monthlyTarget = enriched.weeklyTarget * 4.33;
  }
  
  // Calcular status si no existe
  if (!enriched.status) {
    enriched.status = calculateGoalStatus(enriched);
  }
  
  // Default allocationPercentage
  if (!enriched.allocationPercentage) {
    enriched.allocationPercentage = enriched.type === "debt" ? 60 : 40;
  }
  
  // Default isActive
  if (enriched.isActive === undefined) {
    enriched.isActive = true;
  }
  
  return enriched;
}

/**
 * Enriquecer array de metas
 */
function enrichGoalsWithCalculations(goals) {
  return goals.map(goal => enrichGoalWithCalculations(goal));
}
```

### **Helper: Calcular Weekly Target**
```javascript
/**
 * Calcula el weeklyTarget sin modificar la meta original
 */
function calculateWeeklyTarget(goal) {
  const now = new Date();
  const deadline = new Date(goal.deadline);
  const weeksRemaining = Math.ceil((deadline - now) / (7 * 24 * 60 * 60 * 1000));
  
  if (weeksRemaining <= 0) {
    return 0; // Ya pasó la fecha
  }
  
  const remaining = goal.target - (goal.current || 0);
  return remaining > 0 ? remaining / weeksRemaining : 0;
}
```

### **Helper: Calcular Status**
```javascript
/**
 * Calcula el status sin modificar la meta original
 */
function calculateGoalStatus(goal) {
  const now = new Date();
  const deadline = new Date(goal.deadline);
  
  // Si ya pasó la fecha
  if (deadline < now) {
    return (goal.current || 0) >= goal.target ? "COMPLETADA" : "ATRASADA";
  }
  
  const weeksRemaining = Math.ceil((deadline - now) / (7 * 24 * 60 * 60 * 1000));
  if (weeksRemaining <= 0) {
    return (goal.current || 0) >= goal.target ? "COMPLETADA" : "ATRASADA";
  }
  
  const remaining = goal.target - (goal.current || 0);
  const requiredWeekly = remaining / weeksRemaining;
  const actualWeekly = calculateWeeklyTarget(goal);
  
  // Comparar con el progreso requerido
  if (actualWeekly <= 0) {
    return "COMPLETADA";
  }
  
  // Si el weeklyTarget es >= 90% del requerido → EN_RUTA
  if (actualWeekly >= requiredWeekly * 0.9) {
    return "EN_RUTA";
  }
  
  // Si el weeklyTarget es >= 50% del requerido → RIESGO
  if (actualWeekly >= requiredWeekly * 0.5) {
    return "RIESGO";
  }
  
  // Menos del 50% → ATRASADA
  return "ATRASADA";
}
```

---

## 📝 PLAN DE IMPLEMENTACIÓN SEGURO

### **Fase 1.1: Funciones Helper (Sin Cambios a Código Existente)**
1. Crear `enrichGoalWithCalculations()`
2. Crear `calculateWeeklyTarget()`
3. Crear `calculateGoalStatus()`
4. Crear `enrichGoalsWithCalculations()`
5. **NO modificar funciones existentes todavía**

### **Fase 1.2: Extender displayGoals() (Compatible)**
1. Modificar `displayGoals()` para usar `enrichGoalsWithCalculations()`
2. Mostrar nuevos campos solo si están disponibles
3. Mantener formato existente como fallback
4. **Las metas existentes se muestran igual + nueva info si está disponible**

### **Fase 1.3: Nueva Función createDebtGoal()**
1. Crear función nueva (no toca `createGoal()`)
2. Permite crear meta vinculada a deuda
3. Guarda con nuevos campos opcionales
4. **No afecta metas existentes**

### **Fase 1.4: Calcular Excedente Semanal**
1. Crear `calculateWeeklySurplus()`
2. Integrar en `updateDashboard()` (agregar, no modificar)
3. Mostrar nueva tarjeta con excedente
4. **No modifica cálculos existentes**

### **Fase 1.5: Panel de Plan Semanal**
1. Crear nueva sección en HTML
2. Crear `generateWeeklyPlan()`
3. Mostrar checklist
4. **Funcionalidad nueva, no toca nada existente**

---

## ✅ GARANTÍAS DE SEGURIDAD

### **1. Datos Existentes**
- ✅ Todas las metas existentes siguen funcionando
- ✅ No se requieren cambios en Firestore
- ✅ No se pierden datos
- ✅ Las funciones existentes siguen funcionando

### **2. Funciones Existentes**
- ✅ `createGoal()` se mantiene igual
- ✅ `loadGoals()` se mantiene igual
- ✅ `editGoal()` se mantiene igual
- ✅ `deleteGoal()` se mantiene igual
- ✅ Solo se extienden, no se reemplazan

### **3. Nuevas Funcionalidades**
- ✅ Son opcionales (el usuario decide usarlas)
- ✅ No afectan el comportamiento existente
- ✅ Se pueden usar gradualmente

### **4. Migración Opcional**
- ✅ Si el usuario quiere, puede "migrar" sus metas (agregar campos nuevos)
- ✅ Pero NO es necesario para que funcionen
- ✅ Se hace automáticamente cuando se editan

---

## 🎯 RESULTADO FINAL

**Antes:**
- Metas básicas funcionando ✅
- Sin cálculos automáticos
- Sin integración con deudas

**Después (Fase 1):**
- Metas básicas siguen funcionando igual ✅
- + Cálculos automáticos (opcionales)
- + Metas vinculadas a deudas (nuevo)
- + Plan semanal (nuevo)
- + Excedente calculado (nuevo)

**Cero riesgo, máxima compatibilidad, extensión pura.**

