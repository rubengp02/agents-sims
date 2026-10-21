# Comparación real preparada, pendiente de aprobar límites

21 de octubre de 2026. Se implementó y comprobó el ejecutor real sin ejecutar
inferencias. El [plan fijado](PLAN.json) no equivale a una autorización: la plantilla
privada conserva `approved:false`. No existe un registro real de intento nuevo.
Las autorizaciones y presupuestos de pilotos anteriores permanecen cerrados.

## Alcance propuesto

Cuatro ejecuciones nuevas de la misma tarea media, todas con Codex CLI oficial,
modelo solicitado `gpt-6.1-sol`, razonamiento `low`, sesión nueva, mismos permisos,
archivos iniciales y aceptación. El Jefe decide localmente un solo Programador.
Cada pareja recibe exactamente el mismo prompt y prefijo del ejecutor:

1. Codex directo con contexto actual.
2. Oficina con contexto actual.
3. Oficina con contrato completo en `TASK.md` y sin duplicarlo en el prompt.
4. Codex directo con esa misma variante mínima.

Se invierte el orden de los métodos en la segunda pareja. Solo hay una pareja
por variante: será un resultado exploratorio, sin promoción automática ni una
afirmación de ahorro general. La variante compacta intermedia se conserva en el
diseño local y se pospone para limitar el gasto; este primer piloto compara el
paquete mínimo completo, sin aislar por separado cada eliminación de duplicados.
No incluye Luna, continuación de sesiones ni un cambio a Agent Orchestrator.

No se reutiliza como control la ejecución histórica directa con `medium`: aquí
ambos métodos necesitan una observación nueva con `low` y el mismo motor. El motor
AO permanece disponible como opción de la oficina. La configuración de producción,
la interfaz, personajes, escenarios y animaciones no se alteran.

## Límites que necesitan aprobación

| Control                                                 |                  Máximo |
| ------------------------------------------------------- | ----------------------: |
| Ejecuciones                                             |         4, secuenciales |
| Tokens totales observados                               |                 480.000 |
| Tokens por ejecución                                    |                 120.000 |
| Tiempo total                                            |              16 minutos |
| Tiempo por brazo, incluida preparación y comprobaciones | 3 minutos y 40 segundos |
| Tiempo de modelo por ejecución                          |               3 minutos |
| Reparaciones y reintentos automáticos                   |                       0 |

Se conserva la cota anterior de 120.000 por llamada, pero el total de cuatro
llamadas es un presupuesto nuevo: no se puede inferir de una autorización anterior
para una sola llamada. Antes de cada despacho deben caber las reservas completas
de tokens y tiempo de todos los brazos pendientes. El plazo total deja además
80 segundos para el arranque común. Ninguna cota se amplía automáticamente.

Los tokens pueden comunicarse al terminar un turno; el límite observado no
garantiza cortar la generación exactamente en el token máximo. Cualquier exceso,
consumo perdido, respuesta no completada, fallo de aceptación, pérdida de elegibilidad
de suscripción o límite temporal pausa el piloto entero. No se inicia otro brazo.
Un registro de intento existente impide reiniciar el presupuesto, incluso si falló.

## Controles y evidencia

- La autorización debe vincular la huella exacta del plan, todos los límites y
  una aprobación explícita vigente. Se comprueba antes de construir el proveedor.
- El código debe coincidir con la huella preparada. Se fija el mismo runtime de
  Codex para los cuatro brazos; cada ejecución mantiene sus verificaciones oficiales
  de suscripción antes del turno, durante él y al terminar.
- Cada brazo usa un proyecto aislado nuevo. Se verifican la base por hash, el contrato,
  guía y pruebas protegidas antes del despacho; se comprueban después el alcance,
  commit, rama y configuración Git local. Las preparaciones Git las hace el arnés,
  no el modelo; no se modifica la configuración global.
- Pruebas públicas y aceptación registrada arrancan localmente. La aceptación
  independiente vuelve a comprobar los 36 casos; no basta con que el modelo diga
  `completed`. Se rechaza cualquier cambio fuera de `money.mjs` e `invoice.mjs`.
- Se guardan entrada, caché, salida, tiempo completo y del ejecutor, modelo y esfuerzo
  solicitados, versión de CLI, modo de sesión y métricas seguras. Los datos no
  comunicados quedan desconocidos. No se copian prompts, respuestas, argumentos ni
  credenciales al informe público. Caché no se suma otra vez a la entrada.
- Se registran y conservan los intentos desfavorables. Si el ejecutor pierde la
  respuesta después de despachar, el consumo queda desconocido, no cero.

El nuevo ejecutor se probó con un proveedor en memoria: un ensayo de cuatro brazos
pasó 36/36 por brazo y otros cinco escenarios pausaron correctamente ante defecto,
consumo desconocido, exceso, respuesta perdida y falta de verificación de suscripción.
La séptima prueba comprobó el rechazo de autorizaciones pendientes o alteradas antes
de crear el proveedor. Ninguna de esas observaciones es consumo o calidad de IA real.

La [validación completa](../validacion-piloto-1.json) superó tipos, lint, 735 pruebas
de aplicación/empaquetado, 46 pruebas de políticas/preparación, puente nativo falso,
simulación de contexto y compilación. Conservó los 90 informes históricos y el
código permaneció igual durante la batería. La preparación del plan rechazó el
código inicial y aceptó la implementación de referencia con 36 comprobaciones.

## Próximo paso

Con aprobación expresa de estos límites se registrará la autorización privada y
se ejecutará una sola vez `node scripts/context-pilot.mjs execute`. Sin ella el
comando se bloquea. No hay una opción de CLI para saltarse ese control o activar
un proveedor simulado en una ejecución real. Claude sigue desactivado, Antigravity
desconectado y no existe una alternativa de pago por API o créditos adicionales.

Para repetir pruebas locales del arnés, sin inferencias:

```text
node --test scripts/context-pilot.test.mjs
```
