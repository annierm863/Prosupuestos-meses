# 🎯 ARQUITECTURA: Sistema de Metas Integrado

## 📋 RESUMEN EJECUTIVO

Transformar el módulo de **Metas** en el motor central de disciplina financiera, integrando:
- **Metas** → Objetivos con seguimiento automático
- **Deudas** → Metas vinculadas a deudas específicas
- **Gestión Semanal** → Plan de acción semanal generado automáticamente
- **Regla 60/40** → Asignación automática del excedente (60% deudas, 40% metas/ahorro)

---

## 🏗️ ARQUITECTURA DE DATOS

### 1. **Estructura de Metas Mejorada** (`goals` collection)

```javascript
{
  id: "goal_123",
  userId: "user_uid",
  
  // Tipo de meta
  type: "debt" | "savings" | "composite", // Nuevo campo
  
  // Datos básicos
  name: "BofA a $0",
  target: 5000.00,
  current: 2500.00,
  deadline: "2026-11-30",
  
  // Vinculación con deuda (si type === "debt")
  linkedDebtId: "debt_456", // ID de la deuda en liabilities
  targetDebtAmount: 0, // Monto objetivo (generalmente 0)
  
  // Componentes (si type === "composite")
  components: [
    { goalId: "goal_789", type: "debt", weight: 0.6 },
    { goalId: "goal_790", type: "savings", weight: 0.4 }
  ],
  parentGoalId: null, // Si es componente, referencia al padre
  
  // Cálculos automáticos
  weeklyTarget: 416.67, // Calculado: (target - current) / semanas_restantes
  monthlyTarget: 1800.00, // Calculado: weeklyTarget * 4.33
  status: "EN_RUTA" | "RIESGO" | "ATRASADA", // Calculado automáticamente
  
  // Configuración de asignación
  allocationPercentage: 60, // % del excedente que va a esta meta (default según tipo)
  
  // Metadatos
  createdAt: Timestamp,
  updatedAt: Timestamp,
  isActive: true
}
```

### 2. **Plan Semanal de Acción** (`weeklyPlans` collection) - NUEVO

```javascript
{
  id: "plan_week_2026_01",
  userId: "user_uid",
  weekId: "week_123", // Referencia a la semana actual
  weekStartDate: "2026-01-01",
  weekEndDate: "2026-01-07",
  
  // Cálculos del excedente
  totalIncome: 2000.00,
  totalExpenses: 1200.00,
  surplus: 800.00, // totalIncome - totalExpenses
  
  // Asignación según perfil
  allocationProfile: {
    debtPercentage: 60, // Configurable por usuario
    savingsPercentage: 40
  },
  
  allocatedToDebts: 480.00, // surplus * 0.6
  allocatedToSavings: 320.00, // surplus * 0.4
  
  // Acciones generadas (checklist)
  actions: [
    {
      id: "action_1",
      type: "debt_payment",
      goalId: "goal_123",
      debtId: "debt_456",
      amount: 300.00,
      description: "Pagar $300 a BofA",
      status: "pending" | "completed" | "skipped",
      completedAt: null,
      completedBy: null // userId si fue completado manualmente
    },
    {
      id: "action_2",
      type: "savings_contribution",
      goalId: "goal_789",
      amount: 200.00,
      description: "Aportar $200 a Fondo de Emergencia",
      status: "pending",
      completedAt: null
    }
  ],
  
  // Estado del plan
  status: "draft" | "active" | "completed",
  completedActions: 0,
  totalActions: 2,
  
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### 3. **Perfil de Asignación de Usuario** (`userAllocationProfile` collection) - NUEVO

```javascript
{
  id: "profile_user_123",
  userId: "user_uid",
  
  // Porcentajes de asignación del excedente
  debtPercentage: 60, // Default, pero configurable
  savingsPercentage: 40,
  
  // Priorización de metas
  priorityOrder: ["goal_123", "goal_789"], // IDs de metas en orden de prioridad
  
  // Reglas especiales
  rules: {
    minDebtPayment: 100.00, // Mínimo a deudas aunque el % sea menor
    emergencyFundFirst: true, // Priorizar fondo de emergencia
    debtStrategy: "avalanche" | "snowball" // Estrategia de pago de deudas
  },
  
  updatedAt: Timestamp
}
```

### 4. **Transacciones de Metas** (`goalTransactions` collection) - NUEVO

```javascript
{
  id: "trans_123",
  userId: "user_uid",
  goalId: "goal_123",
  weekId: "week_123", // Semana donde se aplicó
  weeklyPlanId: "plan_week_2026_01",
  
  // Tipo de transacción
  type: "debt_payment" | "savings_contribution" | "manual_adjustment",
  
  // Monto y fecha
  amount: 300.00,
  date: "2026-01-05",
  
  // Si es pago de deuda
  debtId: "debt_456",
  debtPaymentId: "payment_789", // Referencia a debtPayments si aplica
  
  // Si es aporte a ahorro
  savingsAccount: "emergency_fund", // Opcional
  
  // Metadatos
  source: "weekly_plan" | "manual", // Cómo se generó
  actionId: "action_1", // Referencia a la acción del plan semanal
  notes: "Pago automático desde plan semanal",
  
  createdAt: Timestamp
}
```

---

## 🔄 FLUJO DE FUNCIONAMIENTO

### **Fase 1: Creación/Configuración de Metas**

1. Usuario crea meta:
   - **Tipo Deuda**: Selecciona deuda existente → Meta automática "Deuda X a $0"
   - **Tipo Ahorro**: Define monto objetivo y fecha límite
   - **Tipo Compuesta**: Agrupa múltiples metas (ej: "0 deuda + 15k ahorro")

2. Sistema calcula automáticamente:
   - `weeklyTarget = (target - current) / semanas_restantes`
   - `monthlyTarget = weeklyTarget * 4.33`
   - `status` inicial basado en si está en ruta o no

### **Fase 2: Generación del Plan Semanal**

**Trigger**: Al abrir/actualizar la semana activa

1. **Calcular Excedente Semanal**:
   ```javascript
   const surplus = totalIncome - totalExpenses;
   ```

2. **Aplicar Perfil de Asignación**:
   ```javascript
   const debtAllocation = surplus * allocationProfile.debtPercentage;
   const savingsAllocation = surplus * allocationProfile.savingsPercentage;
   ```

3. **Distribuir a Metas Prioritarias**:
   - Ordenar metas activas por prioridad (configurada o automática)
   - Distribuir `debtAllocation` entre metas de tipo "debt"
   - Distribuir `savingsAllocation` entre metas de tipo "savings"
   - Respetar límites: no exceder `weeklyTarget` de cada meta

4. **Generar Acciones (Checklist)**:
   - Por cada asignación, crear acción en `weeklyPlans.actions[]`
   - Cada acción tiene: tipo, meta, monto, descripción, status

### **Fase 3: Ejecución del Plan**

1. Usuario ve checklist en dashboard semanal
2. Al completar acción:
   - Si es `debt_payment`: Crear registro en `debtPayments` + actualizar `liabilities.amount`
   - Si es `savings_contribution`: Actualizar `goals.current` + crear `goalTransactions`
   - Marcar acción como `completed` en `weeklyPlans.actions[]`
   - Actualizar `weeklyPlans.completedActions`

3. Sistema recalcula estado de metas:
   - Actualizar `goals.current`
   - Recalcular `goals.status` (EN_RUTA/RIESGO/ATRASADA)
   - Actualizar `goals.weeklyTarget` si cambió el tiempo restante

### **Fase 4: Monitoreo y Alertas**

1. **Cálculo de Estado de Meta**:
   ```javascript
   function calculateGoalStatus(goal) {
     const weeksRemaining = (new Date(goal.deadline) - new Date()) / (7 * 24 * 60 * 60 * 1000);
     const weeklyTarget = (goal.target - goal.current) / weeksRemaining;
     const actualWeeklyProgress = getActualWeeklyProgress(goal); // De goalTransactions
     
     if (actualWeeklyProgress >= weeklyTarget * 0.9) return "EN_RUTA";
     if (actualWeeklyProgress >= weeklyTarget * 0.5) return "RIESGO";
     return "ATRASADA";
   }
   ```

2. **Alertas Automáticas**:
   - Meta en RIESGO: Notificación semanal
   - Meta ATRASADA: Notificación diaria hasta recuperar
   - Plan semanal no completado: Recordatorio al final de semana

---

## 🎨 INTERFAZ DE USUARIO

### **1. Vista de Metas Mejorada**

```
┌─────────────────────────────────────────────────────────┐
│ 🎯 Mis Metas Activas                          [+ Nueva] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 🏦 BofA a $0                    [EN_RUTA] 🟢       │ │
│ │ Meta: $5,000 • Actual: $2,500 • 12 semanas         │ │
│ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ │
│ │ 50% completado                                     │ │
│ │                                                     │ │
│ │ 📊 Esta semana: $208.33                            │ │
│ │ 📅 Fecha límite: 30 Nov 2026                       │ │
│ │                                                     │ │
│ │ [Ver Detalles] [Editar] [Pausar]                    │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 💰 Fondo de Emergencia            [RIESGO] 🟡     │ │
│ │ Meta: $15,000 • Actual: $3,000 • 8 semanas         │ │
│ │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ │
│ │ 20% completado                                     │ │
│ │                                                     │ │
│ │ ⚠️ Estás 15% por debajo del objetivo semanal        │ │
│ │ 📊 Esta semana necesitas: $1,500                   │ │
│ │                                                     │ │
│ │ [Ver Detalles] [Ajustar Plan]                      │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### **2. Plan Semanal de Acción (Nuevo Panel en Dashboard)**

```
┌─────────────────────────────────────────────────────────┐
│ 📋 Plan de Acción Semanal - Semana 1, Enero 2026       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ 💰 Excedente Disponible: $800.00                        │
│    ├─ Asignado a Deudas (60%): $480.00                  │
│    └─ Asignado a Ahorros (40%): $320.00                 │
│                                                          │
│ ✅ Acciones de esta Semana:                             │
│                                                          │
│ ☐ Pagar $300.00 a BofA (Meta: BofA a $0)               │
│    [Completar]                                          │
│                                                          │
│ ☐ Pagar $180.00 a Capital One (Meta: Capital One a $0) │
│    [Completar]                                          │
│                                                          │
│ ☐ Aportar $200.00 a Fondo de Emergencia                 │
│    [Completar]                                          │
│                                                          │
│ ☐ Aportar $120.00 a Meta de Vacaciones                  │
│    [Completar]                                          │
│                                                          │
│ Progreso: 0/4 acciones completadas                       │
│                                                          │
│ [Ver Distribución Detallada] [Ajustar Asignación]      │
└─────────────────────────────────────────────────────────┘
```

### **3. Configuración de Perfil de Asignación**

```
┌─────────────────────────────────────────────────────────┐
│ ⚙️ Perfil de Asignación de Excedente                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Distribución del Excedente Semanal:                     │
│                                                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Deudas:        [████████████░░░░] 60%              │ │
│ │ Ahorros/Metas: [████████░░░░░░░░] 40%              │ │
│ └────────────────────────────────────────────────────┘ │
│                                                          │
│ Prioridad de Metas:                                     │
│ 1. BofA a $0 (Deuda - Alta prioridad)                  │
│ 2. Fondo de Emergencia (Ahorro)                         │
│ 3. Capital One a $0 (Deuda)                             │
│                                                          │
│ [Reordenar]                                             │
│                                                          │
│ Reglas Especiales:                                       │
│ ☑ Priorizar fondo de emergencia                        │
│ ☐ Pago mínimo a deudas: $100.00                        │
│                                                          │
│ [Guardar Cambios]                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 FUNCIONES PRINCIPALES A IMPLEMENTAR

### **1. Gestión de Metas**

```javascript
// Crear meta vinculada a deuda
async function createDebtGoal(debtId, targetAmount = 0, deadline)

// Crear meta de ahorro
async function createSavingsGoal(name, target, deadline)

// Crear meta compuesta
async function createCompositeGoal(name, componentGoalIds, deadline)

// Calcular estado de meta (EN_RUTA/RIESGO/ATRASADA)
function calculateGoalStatus(goal)

// Actualizar progreso de meta desde transacciones
async function updateGoalProgress(goalId, amount, type)
```

### **2. Plan Semanal**

```javascript
// Generar plan semanal automático
async function generateWeeklyPlan(weekId)

// Calcular excedente semanal
async function calculateWeeklySurplus(weekId)

// Distribuir excedente según perfil
function distributeSurplus(surplus, goals, allocationProfile)

// Completar acción del plan
async function completeWeeklyAction(actionId, weekId)

// Obtener plan semanal actual
async function getCurrentWeeklyPlan()
```

### **3. Integración con Deudas**

```javascript
// Vincular meta a deuda existente
async function linkGoalToDebt(goalId, debtId)

// Registrar pago desde plan semanal
async function registerPaymentFromPlan(actionId, amount, date)

// Sincronizar progreso de meta con deuda
async function syncGoalWithDebt(goalId)
```

### **4. Dashboard y Visualización**

```javascript
// Mostrar panel de plan semanal
function displayWeeklyPlan(plan)

// Mostrar estado de todas las metas
function displayGoalsDashboard(goals)

// Mostrar alertas de metas en riesgo
function displayGoalAlerts(goals)
```

---

## 📊 CÁLCULOS Y LÓGICA

### **Cálculo de Estado de Meta**

```javascript
function calculateGoalStatus(goal) {
  const now = new Date();
  const deadline = new Date(goal.deadline);
  const weeksRemaining = Math.ceil((deadline - now) / (7 * 24 * 60 * 60 * 1000));
  
  if (weeksRemaining <= 0) {
    return goal.current >= goal.target ? "COMPLETADA" : "ATRASADA";
  }
  
  const remaining = goal.target - goal.current;
  const requiredWeekly = remaining / weeksRemaining;
  
  // Obtener progreso real de las últimas 4 semanas
  const recentProgress = getRecentWeeklyProgress(goal, 4);
  const avgWeeklyProgress = recentProgress.reduce((a, b) => a + b, 0) / recentProgress.length;
  
  if (avgWeeklyProgress >= requiredWeekly * 0.9) return "EN_RUTA";
  if (avgWeeklyProgress >= requiredWeekly * 0.5) return "RIESGO";
  return "ATRASADA";
}
```

### **Distribución del Excedente**

```javascript
function distributeSurplus(surplus, goals, profile) {
  const debtAllocation = surplus * (profile.debtPercentage / 100);
  const savingsAllocation = surplus * (profile.savingsPercentage / 100);
  
  // Filtrar metas por tipo y ordenar por prioridad
  const debtGoals = goals
    .filter(g => g.type === "debt" && g.isActive)
    .sort((a, b) => getPriority(a) - getPriority(b));
  
  const savingsGoals = goals
    .filter(g => g.type === "savings" && g.isActive)
    .sort((a, b) => getPriority(a) - getPriority(b));
  
  // Distribuir a deudas (proporcional al weeklyTarget)
  const debtDistribution = distributeProportionally(debtGoals, debtAllocation);
  
  // Distribuir a ahorros (proporcional al weeklyTarget)
  const savingsDistribution = distributeProportionally(savingsGoals, savingsAllocation);
  
  return [...debtDistribution, ...savingsDistribution];
}

function distributeProportionally(goals, totalAmount) {
  const totalWeeklyTarget = goals.reduce((sum, g) => sum + g.weeklyTarget, 0);
  
  return goals.map(goal => {
    const proportion = goal.weeklyTarget / totalWeeklyTarget;
    const allocated = Math.min(proportion * totalAmount, goal.weeklyTarget);
    
    return {
      goalId: goal.id,
      amount: allocated,
      type: goal.type === "debt" ? "debt_payment" : "savings_contribution"
    };
  });
}
```

---

## 🚀 PLAN DE IMPLEMENTACIÓN (Fases)

### **Fase 1: Base de Datos y Estructura** (2-3 días)
- [ ] Actualizar estructura de `goals` con nuevos campos
- [ ] Crear colección `weeklyPlans`
- [ ] Crear colección `userAllocationProfile`
- [ ] Crear colección `goalTransactions`
- [ ] Migrar metas existentes al nuevo formato

### **Fase 2: Funciones Core** (3-4 días)
- [ ] Implementar `calculateGoalStatus()`
- [ ] Implementar `calculateWeeklySurplus()`
- [ ] Implementar `distributeSurplus()`
- [ ] Implementar `generateWeeklyPlan()`
- [ ] Implementar funciones de creación de metas mejoradas

### **Fase 3: Integración con Deudas** (2-3 días)
- [ ] Función para vincular meta a deuda
- [ ] Sincronización automática meta ↔ deuda
- [ ] Registrar pagos desde plan semanal
- [ ] Actualizar `liabilities.amount` automáticamente

### **Fase 4: Interfaz de Usuario** (4-5 días)
- [ ] Rediseñar vista de Metas con estados
- [ ] Crear panel de Plan Semanal en Dashboard
- [ ] Crear vista de configuración de perfil
- [ ] Implementar checklist de acciones
- [ ] Agregar alertas y notificaciones

### **Fase 5: Testing y Refinamiento** (2-3 días)
- [ ] Probar flujo completo
- [ ] Validar cálculos
- [ ] Ajustar UI/UX
- [ ] Documentar funcionalidades

---

## 💡 MEJORAS FUTURAS (Post-MVP)

1. **Metas Recurrentes**: Metas que se renuevan automáticamente
2. **Metas Condicionales**: "Si ahorro X, entonces activar meta Y"
3. **Análisis Predictivo**: "A este ritmo, alcanzarás la meta en X semanas"
4. **Integración con Inversiones**: Metas que se convierten en inversiones
5. **Compartir Metas**: Metas compartidas entre usuarios (parejas/familias)
6. **Metas por Categoría**: Agrupar metas por categorías (Emergencia, Vacaciones, etc.)

---

## ✅ VENTAJAS DE ESTA ARQUITECTURA

1. **Modular**: Cada componente es independiente y testeable
2. **Escalable**: Fácil agregar nuevos tipos de metas o reglas
3. **Automático**: Mínima intervención manual del usuario
4. **Transparente**: Usuario siempre sabe de dónde viene cada asignación
5. **Flexible**: Perfil de asignación configurable por usuario
6. **Integrado**: Todo conectado: Semanas → Metas → Deudas → Acciones

---

## 🎯 RESULTADO FINAL

El usuario tendrá:
- ✅ Metas que se convierten automáticamente en números semanales
- ✅ Plan de acción claro cada semana
- ✅ Seguimiento automático de progreso (EN_RUTA/RIESGO/ATRASADA)
- ✅ Integración perfecta entre deudas y metas
- ✅ Disciplina financiera automatizada con la regla 60/40


