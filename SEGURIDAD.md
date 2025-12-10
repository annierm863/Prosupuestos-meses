# 🔒 Guía de Seguridad - Presupuesto Personal

## ⚠️ Problemas de Seguridad Identificados y Corregidos

### ✅ Correcciones Aplicadas

1. **Registro Público Deshabilitado**
   - ✅ Botón de registro eliminado de la interfaz
   - ✅ Función `register()` deshabilitada - solo muestra mensaje de error
   - ✅ Solo el administrador puede crear usuarios desde Firebase Console

2. **Código Comentado Eliminado**
   - ✅ Eliminado bloque de código comentado que exponía credenciales de Firebase
   - ✅ Credenciales ahora solo están en `app.js` (necesario para funcionamiento)

3. **Variables Globales Protegidas**
   - ✅ `window.auth` y `window.db` comentadas para evitar acceso directo
   - ✅ Las funciones internas usan las variables directamente

## 🔐 Recomendaciones de Seguridad Adicionales

### 1. Reglas de Firestore (CRÍTICO)

**Configura estas reglas en Firebase Console → Firestore Database → Rules:**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Regla general: solo usuarios autenticados pueden acceder
    match /{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
    }
    
    // Reglas específicas por colección
    match /weeks/{weekId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /incomes/{incomeId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /expenses/{expenseId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /workExpenses/{workId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /goals/{goalId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /assets/{assetId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /liabilities/{liabilityId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /investments/{investmentId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
    
    match /budgets/{budgetId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
    }
  }
}
```

### 2. Autenticación de Firebase

**En Firebase Console → Authentication → Settings → Authorized domains:**
- ✅ Agrega solo tus dominios autorizados
- ✅ Elimina dominios no autorizados
- ✅ Activa "Email/Password" como método de autenticación

### 3. Crear Usuarios (Solo Admin)

**Para crear nuevos usuarios, usa Firebase Console:**
1. Ve a Firebase Console → Authentication → Users
2. Haz clic en "Add user"
3. Ingresa email y contraseña
4. El usuario podrá iniciar sesión con esas credenciales

**O usa Firebase Admin SDK (recomendado para producción):**
```javascript
// Script de administración (ejecutar en servidor/Node.js)
const admin = require('firebase-admin');
admin.auth().createUser({
  email: 'usuario@ejemplo.com',
  password: 'contraseñaSegura123'
});
```

### 4. Validación de Inputs

✅ Ya implementado:
- Validación de formularios con `validateForm()`
- Validación de fechas
- Sanitización básica de inputs

### 5. HTTPS Obligatorio

- ✅ Asegúrate de que tu aplicación se sirva solo por HTTPS
- ✅ GitHub Pages usa HTTPS por defecto
- ✅ Firebase requiere HTTPS para producción

### 6. Rate Limiting

**Configurar en Firebase Console → Authentication → Settings:**
- Activa "Email link (passwordless sign-in)" solo si es necesario
- Configura límites de intentos de inicio de sesión
- Activa protección contra spam

### 7. Monitoreo

**Firebase Console → Usage and billing:**
- Revisa regularmente los logs de autenticación
- Monitorea intentos fallidos de inicio de sesión
- Revisa el uso de Firestore para detectar accesos anómalos

## 🚨 Problemas de Seguridad Conocidos

### ⚠️ Limitaciones Actuales

1. **API Key Expuesta**
   - Las API keys de Firebase están en el código frontend (normal para apps web)
   - **Mitigación**: Las reglas de Firestore protegen los datos
   - **Recomendación**: Configura restricciones de dominio en Firebase Console

2. **Sin Validación del Lado del Servidor**
   - Toda la validación es del lado del cliente
   - **Mitigación**: Las reglas de Firestore validan estructura y permisos
   - **Recomendación**: Implementa Cloud Functions para validación adicional

3. **Sin Encriptación de Datos Sensibles**
   - Los datos financieros se almacenan en texto plano
   - **Mitigación**: Firestore está encriptado en tránsito y reposo
   - **Recomendación**: Considera encriptación adicional para datos muy sensibles

## 📋 Checklist de Seguridad

- [x] Registro público deshabilitado
- [x] Código comentado con credenciales eliminado
- [x] Variables globales protegidas
- [ ] Reglas de Firestore configuradas (HACER ESTO)
- [ ] Dominios autorizados configurados en Firebase
- [ ] Monitoreo de autenticación activado
- [ ] Rate limiting configurado
- [ ] HTTPS habilitado (GitHub Pages lo hace automáticamente)

## 🔧 Cómo Crear Usuarios (Solo Admin)

### Opción 1: Firebase Console (Más Fácil)
1. Ve a https://console.firebase.google.com
2. Selecciona tu proyecto
3. Ve a Authentication → Users
4. Haz clic en "Add user"
5. Ingresa email y contraseña
6. El usuario podrá iniciar sesión inmediatamente

### Opción 2: Script de Administración
Crea un script Node.js para crear usuarios programáticamente (útil si necesitas crear muchos usuarios).

## 📞 Soporte

Si detectas algún problema de seguridad, contacta inmediatamente al administrador.

---
**Última actualización**: $(Get-Date -Format "yyyy-MM-dd")
**Versión**: 1.0


