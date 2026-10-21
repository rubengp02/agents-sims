# Orquestación adaptativa: primera entrega

La oficina conserva el motor anterior por defecto y Agent Orchestrator como opción.
El servidor incorpora un controlador adaptativo y controles de presupuesto comunes.
No se han cambiado la interfaz, los personajes, los escenarios ni las animaciones.

## Qué decide el Jefe

El Jefe tiene una vía local y otra de planificación con IA. Si recibe un contrato
claro, riesgo e incertidumbre bajos y aceptación acreditada por el registro local,
puede preparar un único Programador sin consultar un modelo planificador. Trabajar
en dos módulos no obliga por sí solo a activar Arquitecto y Tester.

La vía `/api/team/plan` admite opcionalmente `context` y `assessment`, con el mismo
objetivo que `goal`. Conserva los parámetros anteriores; sin evidencia local
suficiente, puede preparar una planificación con el Jefe de IA, sujeta también al
presupuesto. No ejecuta automáticamente el plan. `/api/team/scope` mantiene la
creación local explícita de tareas.

`acceptanceCoverage: "complete"` es una afirmación que se verifica, no un permiso
para omitir revisión. `LocalCheckCommand.criteria` declara, desde código local
confiable, los criterios exactos que cubre cada comprobación de aceptación.
Un texto HTTP o generado por IA no puede registrar comandos ni asignarse cobertura.
Las pruebas generales del proyecto no se declaran automáticamente suficientes para
cualquier requisito nuevo. Sin esa evidencia se conserva revisión independiente.

Para riesgo alto o incertidumbre importante se mantiene análisis y revisión
profunda. El plan del Jefe puede proponer por tarea:

```json
{
  "role": "developer",
  "title": "Implementar el contrato",
  "prompt": "Encargo acotado",
  "dependsOn": [],
  "choice": { "provider": "codex", "model": "gpt-6.1-sol", "effort": "low" },
  "assessment": {
    "scope": "bounded",
    "risk": "low",
    "uncertainty": "low",
    "modules": ["money"],
    "tests": "available"
  }
}
```

También admite `context` y `reviewMode` por tarea. El código valida el plan completo
antes de crear trabajadores: dependencias, catálogo, controles de riesgo, cobertura
y comprobaciones. No admite permisos, reservas ni aumentos de presupuesto generados
por el modelo. Si una asignación pendiente no está disponible, no inicia solo una
parte del plan que dependa de ella.

La selección automática continúa acotada al catálogo permitido. El Jefe puede
proponer Sol con low/medium/high y Luna low para trabajo adecuado; las elecciones
de código con Luna necesitan evidencia revisada de calidad y consumo. El conjunto
de promociones automáticas de esta entrega está vacío. Las observaciones de éxito
no lo rellenan solas. Una elección manual sigue disponible, dentro de los controles
de catálogo, suscripción, permisos y presupuesto; no demuestra ahorro por sí misma.

## Presupuesto completo, sin reservas fijas como predicción de producción

El servidor utiliza `AdaptiveRuntime`, `UsageHistory` y `estimateTurn`. Agrupa el
historial por motor, proveedor, modelo, razonamiento, papel, alcance, riesgo,
incertidumbre, pruebas, profundidad de revisión y sesión nueva/continuada.
Predice entrada más salida, sin descontar la caché. Emplea el máximo comparable
completo multiplicado por 1,5, con confianza explícita. No se presenta como un
percentil calibrado. Menos de cinco muestras, contexto mayor, datos desconocidos o
turnos censurados requieren revisión humana.

Antes de iniciar cualquier tarea comprueba la suma estimada de todos los pasos
pendientes, sus llamadas y su tiempo. Los turnos activos permanecen incluidos.
Cada turno recibe además un límite observado como máximo igual a su reserva.
No eleva los límites de la configuración, cuyo valor inicial de tokens sigue
siendo 30.000. El tiempo del Jefe y las comprobaciones no renueva el plazo de los
trabajadores: se registra una suma conservadora de duraciones despachadas. En
paralelo de lectores esa suma puede ser mayor que el tiempo de reloj.

**El proveedor puede comunicar los tokens al cerrar el turno.** Estas reservas
reducen el riesgo de excederse; no garantizan detener la generación exactamente
en el token límite. Un exceso pausa y no se acepta como éxito eficiente.

Un arranque sin historial comparable se bloquea con `budget_review_required`.
No se interpreta como coste cero ni se inicia una calibración real automáticamente.
La ruta local autenticada `POST /api/team/budget-review` permite revisar una cota
con `id`, `tokens`, `durationMs` y `maxContextCharacters` positivos y dentro de los
límites existentes. Requiere una tarea asignada y el equipo detenido. Se vincula
al modelo, razonamiento y clase de trabajo; no autoriza otro perfil ni más contexto.
Se conserva el control de origen local y el nonce del panel.

Esa revisión **no inicia ni reanuda**. Si había una pausa, continuar exige después
la acción explícita de reanudar y ejecutar. No se han añadido controles visuales:
esta primera entrega expone la operación en la API local. No se rellenan sus
cotas automáticamente. Un consumo perdido, historial corrupto o ejecución activa
interrumpida requiere revisar el estado; no se recupera presupuesto reiniciando.

## Historial y privacidad

Se almacenan contadores deduplicados, tiempos, estados, aceptación, comprobaciones
pasadas/totales, hallazgos cuando existen, selección manual/local/del Jefe y versión
de política. Los defectos no evaluados quedan desconocidos; una continuación no se
declara reparación. Los prompts y respuestas no se copian al registro agregado.
La verdad semántica de un hallazgo no se presume por tener formato correcto.

La evidencia confiable está fuera de la carpeta que un agente de código puede
editar: en Windows, bajo LOCALAPPDATA/AgentsSims/adaptive, separada por un hash del
proyecto de oficina. En otros sistemas usa el directorio local del usuario.
El coordinador bloquea un proyecto que incluya esa evidencia en su raíz editable.
El historial corrupto se conserva y bloquea ejecución, sin impedir la observación
de la oficina. La cola y sus contadores permanecen en el checkpoint privado
existente; al recuperar se eliminan autorizaciones de ejecución y revisiones de
cota, y las tareas pendientes se mantienen en pausa.

`npm run adaptive:history` importa siete observaciones públicas de los pilotos
anteriores a ese almacén, sin leer transcripciones ni credenciales. Es idempotente,
conserva estados desfavorables y no convierte el directo reutilizado en otra llamada.
Como los informes no registraron tamaños de prompt fiables, esos contextos quedan
desconocidos; no habilitan predicciones automáticas ni promociones de modelos.

## Revisión independiente por cambios

Antes de una implementación que tenga revisor se conserva una captura privada de
la base. Después se ejecutan las comprobaciones registradas desde la aplicación,
sin una consulta al modelo para arrancarlas. Se comprueba que no alteraron los
archivos y se vinculan los resultados a una huella del contenido del proyecto.

El Tester recibe un paquete de base/candidato, diff completo, aceptación y pruebas
vigentes; sustituye el historial del autor. Trabaja en una sesión nueva y sin
escritura. Sus hallazgos requieren una línea `OFFICE_REVIEW` con `findings`, archivo,
línea, gravedad, criterio exacto y evidencia reproducible. Una lista vacía debe ser
explícita. Las referencias se validan y los hallazgos bloquean para revisión, sin
una reparación automática por otro modelo. La aplicación comprueba de nuevo que
el candidato no cambió durante la revisión.

Los resultados de pruebas ya vinculados al candidato se reutilizan para esa
revisión. Si el contenido cambió, no se reutilizan. El autor puede necesitar pruebas
adicionales para investigar un defecto; esto no obliga a repetir toda la batería
como parte de cada consulta de IA.

Límites de esta primera entrega: captura de hasta 10.000 archivos/32 MB y diff de
30.000 caracteres para revisión focalizada o 60.000 para profunda. Si no cabe,
se bloquea para dividir o revisar el alcance: no se trunca para declarar éxito.
Los enlaces simbólicos y archivos no inspeccionables requieren revisión. Todavía
no hay revisión paginada para repositorios de cualquier tamaño ni caché universal
del mapa del repositorio. El aislamiento del sandbox continúa siendo una garantía
separada del control de huellas de los archivos inspeccionados.

## Comprobaciones sin inferencia

```text
npm run adaptive:evaluate
npm run adaptive:verify
```

La evaluación usa el coordinador real con un adaptador simulado que entrega
implementaciones de referencia conocidas. Comprueba seis variantes en casos fácil,
medio y difícil, más un defecto inyectado. Sus tokens son contadores de prueba:
no son ahorro de modelos. No admite una opción para activar un proveedor real.
La prueba nativa `engine:test` comprueba aparte los módulos compilados y fijados
de AO con un proveedor de protocolo simulado.

La verificación ejecuta tipos, lint, pruebas, 33 políticas/estudios, la matriz
offline, el puente nativo y el empaquetado. Escribe su propio informe y conserva
los informes históricos. No hay benchmark real implícito en estos comandos.

## Trabajo posterior

- Calibrar los márgenes y ampliar el corpus de enrutamiento con casos externos.
- Evaluar con límites autorizados los candidatos ligeros y los esfuerzos bajos;
  registrar también defectos escapados, reparaciones y fallos.
- Medir continuación frente a sesión nueva en AO. Reutilizar un personaje nunca
  continúa una conversación. El Tester no puede continuar la del autor.
- Implementar propiedad de archivos, dos Programadores aislados e integración
  verificada en un tercer espacio antes de permitir paralelismo de escritura.
  La exclusividad actual se conserva; no se ha habilitado `parallelSafe` para
  eludirla. Ese trabajo es una etapa posterior, no una capacidad ya entregada.

Claude continúa desactivado y Antigravity desconectado. Todos los turnos reales
futuros conservan las verificaciones oficiales de ChatGPT y ausencia de créditos
adicionales. Esta implementación no autoriza ningún piloto real ni hace push.
