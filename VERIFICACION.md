# Guía de Verificación - Arriendos360

Este documento contiene los pasos y pruebas necesarias para asegurar que todo el entorno de desarrollo (Backend, Frontend y Base de Datos) esté funcionando correctamente.

## 1. Reinicio Limpio del Entorno

Para aplicar todos los cambios y asegurar que las dependencias se instalen correctamente dentro de Docker, ejecuta:

```bash
docker-compose down -v
docker-compose up --build
```

*Nota: La primera vez tardará unos minutos mientras se instalan los paquetes de Node.*

---

## 2. Pruebas de Conectividad

### A. Verificar Base de Datos (PostgreSQL)
Revisa los logs de `arriendos360_db`. Deberías ver:
- `database system is ready to accept connections`

### B. Verificar Backend (API)
Abre tu navegador o usa `curl` en la terminal:
- **URL:** [http://localhost:3001/](http://localhost:3001/)
- **Resultado esperado:** Un JSON con el mensaje `🏠 API Arriendos360 funcionando`.

### C. Verificar Frontend (React)
- **URL:** [http://localhost:3000/](http://localhost:3000/)
- **Resultado esperado:** La interfaz de React cargada (puede tardar un poco más en compilar la primera vez).

---

## 3. Pruebas con Navegador o Postman

Puedes usar estas rutas para verificar los diferentes módulos del sistema.

### A. Pruebas en Navegador (GET)
Copia y pega estas URLs para ver si el Backend responde:
- **Estado General:** [http://localhost:3001/](http://localhost:3001/)
- **Dashboard:** [http://localhost:3001/api/dashboard/stats](http://localhost:3001/api/dashboard/stats) (Debería devolver un error 401 si no estás autenticado, lo cual es correcto).

### B. Pruebas en Postman (JSON)
Configura estas peticiones para probar la lógica de negocio:

#### 1. Registro de Usuario (POST)
- **URL:** `http://localhost:3001/api/auth/register`
- **Body (JSON):**
```json
{
  "nombre": "Usuario Prueba",
  "email": "test@ejemplo.com",
  "password": "password123",
  "rol": "admin"
}
```

#### 2. Login (POST)
- **URL:** `http://localhost:3001/api/auth/login`
- **Body (JSON):**
```json
{
  "email": "test@ejemplo.com",
  "password": "password123"
}
```
*Nota: El login te devolverá un `token`. Cópialo para las siguientes pruebas.*

#### 3. Crear Inmueble (POST)
- **URL:** `http://localhost:3001/api/inmuebles`
- **Headers:** `Authorization: Bearer <TU_TOKEN_AQUÍ>`
- **Body (JSON):**
```json
{
  "direccion": "Calle Falsa 123",
  "tipo": "Apartamento",
  "precio": 1500000,
  "estado": "disponible"
}
```

---

## 4. Script de Prueba Automática (Node.js)

- **"nodemon: not found"**: Asegúrate de haber corrido `docker-compose down -v` antes de subirlo de nuevo.
- **Error de Conexión a DB**: Revisa que las credenciales en el `docker-compose.yml` coincidan con lo que espera el Backend en su configuración.
