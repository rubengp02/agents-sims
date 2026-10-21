# Primer ejecutor oficial: entrega comprobada

Implementación de esta fase: Codex CLI con sesión de ChatGPT, diagnóstico previo, validación de catálogo y esfuerzo, rechazo de vías de pago, ejecución/cancelación/pausa y registros locales. No incluye aún el Jefe automático, reanudación integrada ni los paneles de asignación. Claude está desactivado y Antigravity no tiene cliente.

## Evidencia

- El diagnóstico compilado reconoce la instalación reciente y ChatGPT Plus; comprueba cuota vigente y saldo adicional cero comunicado. No lee archivos ni almacenes de credenciales.
- Una prueba real breve con GPT-6 Luna, razonamiento bajo y solo lectura completó la respuesta exacta `OFICINA_OK`. No pidió herramientas ni cambió archivos. El identificador de sesión y los contadores quedan en el registro local ignorado por Git.
- El CLI comunicó 14.009 tokens de entrada y 8 de salida. Es consumo de contexto completo del CLI, no una tarifa ni una predicción de cuota. No se compraron créditos ni se configuraron claves.
- Se confirmó el rechazo de Claude y Antigravity mediante los comandos compilados de diagnóstico; no se inició ninguno de esos proveedores.
- La oficina original continúa en marcha. No se cambiaron archivos visuales, sprites, mobiliario ni animaciones.

## Validaciones

- Build, comprobación de tipos y lint correctos. Persiste una advertencia anterior de dependencias de un efecto React en `webview-ui/src/App.tsx`, ajena a esta fase.
- 52 pruebas de interfaz/motor, 484 de servidor, 7 de empaquetado y 7 de navegador correctas: **550 en total**, incluidas 54 nuevas de esta fase. Las pruebas automatizadas no llaman a modelos reales.
- Formato de los archivos nuevos y `git diff --check` correctos.

## Revisión propia de límites

Las comprobaciones no son un bloqueo de facturación a nivel de cuenta: no modifican ajustes de compra o recarga del proveedor. El ejecutor exige una sesión personal y ausencia de créditos adicionales en los datos comunicados, conserva un margen del 10%, vuelve a verificar y pausa ante datos desconocidos. No hay operación de compra, recarga, reset ni alternativa API. No reserva cuota frente a otros clientes ni garantiza una cancelación instantánea.

El campo de modelo confirmado permanece vacío cuando el CLI no devuelve ese dato. No se hace pasar el modelo solicitado por un identificador de inferencia confirmado por el proveedor.

Un cierre forzoso puede conservar el lock de ejecución; se bloquea una nueva tarea hasta revisar ese cierre en lugar de duplicar una tarea potencialmente activa. El comando interactivo es de solo lectura; `--write` habilita únicamente el sandbox de escritura del proyecto. La reanudación y la coordinación entre personajes se implementarán después de este primer ejecutor.
