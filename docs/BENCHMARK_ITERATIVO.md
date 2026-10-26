# Comparación controlada: Codex individual y oficina iterativa

## Nuevo intento real: cuota disponible, cierre incompleto

El 26 de octubre se ejecutó una nueva pareja autorizada sobre `64c040c`, con
el mismo protocolo v1 y sin modificar soluciones ni límites. La consulta inicial
comunicó 1% de uso corto y 0% semanal. El ejecutor volvió a comprobar la cuota
antes de cada método: 3%/0% para individual y 4%/1% para oficina, ambos por debajo
del 80%. La cuota dejó de ser el bloqueo.

| Medición                               | Codex individual         | Oficina iterativa                    |
| -------------------------------------- | ------------------------ | ------------------------------------ |
| Tiempo total, incluidas comprobaciones | 65.784 ms                | 480.652 ms, interrupción por límite  |
| Turnos iniciados                       | 1                        | 4: Jefe, Programador, Jefe, Tester   |
| Tokens conocidos de entrada + salida   | 106.433                  | Al menos 194.756; Tester desconocido |
| Comprobaciones externas                | 32/36                    | 32/36 sobre los archivos conservados |
| Pruebas públicas                       | Aprobadas                | Aprobadas                            |
| Escritura dentro del alcance           | Sí                       | Sí                                   |
| Objetivo y recibos completos           | Sí, solución no aceptada | No, pausado por consumo desconocido  |

El Tester confirmó el modelo, pero no comunicó salida, llamadas de herramientas ni
contadores finales antes de la parada de ocho minutos. El recibo se conserva como
cancelado y con consumo desconocido; no se deduce que consumiera cero. La razón
genérica almacenada por el adaptador es `cancelled_by_user`, aunque en este ensayo
la señal de cancelación la emitió el temporizador del verificador. El objetivo
quedó `paused` con `usage_unknown`. No se atribuye una causa interna al modelo o
al proveedor sin evidencia adicional.

Las cuatro discrepancias de ambos métodos siguen siendo `TypeError` frente al
`RangeError` externo esperado para valores fraccionarios y `NaN` en cantidades y
descuentos. Se conserva la limitación ya documentada del contrato v1: no debe
interpretarse esa puntuación como una medida general de calidad. La oficina no
obtuvo aceptación ni cierre independiente en este bloque.

El informe terminó `incomplete`, con `controlsPassed: false` y sin cocientes de
tiempo o tokens. La equivalencia de archivos iniciales, modelo y esfuerzo sí quedó
verificada para los turnos recibidos. La huella del protocolo fue
`2e3aed9193b6f713150e24c5da604fb5fa6b12f3151c3dee72a45aeca47fe0cf`; los recibos
y el informe completo se conservan en el almacén privado, fuera de Git. No se
amplió el límite, no se reintentó automáticamente y no se corrigieron las soluciones.
La lectura oficial posterior indicó 11% corto y 2% semanal; no se atribuye toda
esa diferencia al benchmark porque la cuenta también comparte esta conversación.

### Diagnóstico posterior del Tester

La inspección de los registros persistidos del CLI oficial identificó el motivo
de la espera. A las 13:44:45 UTC, `codex_core::responses_retry` registró HTTP
`429 Too Many Requests` y el primer reintento de un máximo de cinco, programado
para 406,9998307 segundos después (unos seis minutos y 47 segundos).
La sesión había arrancado a las 13:44:43 UTC. El benchmark interrumpió el turno
a las 13:50:59 UTC, antes del reintento: quedaban unos 33 segundos de esa espera.
El historial nativo no contiene mensajes del asistente ni operaciones de revisión;
no fue una revisión prolongada ni un comando de pruebas bloqueado.

Existe además una carencia de observabilidad de la aplicación. El ejecutor solo
detiene por notificaciones `error` cuando `willRetry !== true`; los avisos
reintentables no se muestran como actividad. El transporte descarta `stderr`.
No se conservó una traza del transporte que acredite si este aviso concreto llegó
como notificación, pero sí consta en el registro nativo y el adaptador no contempla
su presentación. La sesión y las consultas de cuota siguieron activas, sin salida
de trabajo, hasta que la señal del benchmark la canceló.

Esto demuestra una limitación temporal de solicitudes del servicio, no que
faltaran herramientas, que se agotara la cuota de cinco horas o que el Tester
consumiera cero tokens. El registro no identifica el límite interno concreto
que originó el 429. Los avisos de instantánea de PowerShell no compatible y de
configuración administrada obsoleta aparecen durante el arranque; no acreditan
ser la causa de esta espera y no se confundieron con el error de transporte.

La evidencia resumida y las huellas se conservan junto al informe privado. La
investigación no ejecutó inferencia ni reanudó el ensayo. Pendiente antes de otra
pareja real: presentar los reintentos como espera del proveedor, conservar su
causa al cancelar y acreditar el cierre real del Tester. No se ha implementado
esa corrección durante la investigación inicial. Posteriormente se implementó la
[política de saturación](SATURACION_MODELOS.md), comprobada con errores simulados,
incluida la espera nativa del primer reintento oculto. El benchmark conserva el
modelo fijado y no usa sustituciones automáticas. La simulación y CI satisfactorios
no sustituyen el cierre real.

## Protocolo exploratorio v1

Antecedente del 26 de octubre de 2026: un intento sobre la revisión `0ff6a21`
comprobó la preparación, pero el control oficial de cuota impidió iniciar el primer
método. No ejecutó turnos ni consumió cuota de inferencia. El historial anterior
sigue incompleto y no se utiliza para publicar cocientes de eficiencia.
La lectura posterior comunicó 82% de uso en cinco horas y 13% semanal; el margen
de inicio sigue siendo inferior al 80% en cada ventana. Reinicio comunicado:
26 de octubre, 16:38 (Europe/Madrid). El bloque real está autorizado por el usuario;
no se necesita otra autorización para ejecutarlo cuando la cuota lo permita.
La simulación de ambos métodos y las nueve regresiones del comparador pasan;
también pasan en el [runtime de CI de esa revisión](https://github.com/rubengp02/agents-sims/actions/runs/40327075378).

Una pareja sobre el caso de facturación en céntimos de la batería existente.
Antes de inferencia, se acredita que la implementación inicial falla y la de
referencia supera 36 comprobaciones externas. El contrato, archivos iniciales,
pruebas públicas y reglas son idénticos en ambos métodos.

- Modelo `gpt-6.1-sol`, esfuerzo `medium` para cada papel, fijado por el verificador.
- Primero Codex individual; después la oficina iterativa real de Conversaciones,
  con la sesión del Jefe conservada y revisión independiente. El orden es fijo;
  no se infiere una ventaja causal de tiempo o caché de esta única pareja.
- En cada método: hasta 600.000 tokens comunicados, ocho minutos y seis turnos.
  La oficina comparte ese presupuesto entre coordinación, programación y revisión.
  Son techos de evaluación, no nuevos límites del chat de la aplicación.
- Contexto nuevo por método, copias separadas fuera del código de la oficina,
  mismas herramientas y mismo alcance de escritura. El Jefe y el Tester no escriben.
- Cuota oficial incluida antes y durante la ejecución, con las protecciones normales.
  Para iniciar un método de evaluación, todos los contadores deben estar por debajo
  del 80%; este margen adicional no cambia el control normal del chat.
  Recibo desconocido, límite o cancelación interrumpe el bloque; no se amplía ni
  reintenta automáticamente. No se usan APIs de pago ni se reinicia la caché.
- Pruebas externas y comprobación de archivos autorizados después de cada método.
  El verificador no corrige soluciones. Las afirmaciones del modelo no acreditan
  aceptación. Una tarea pausada sigue sin completar aunque sus pruebas pasen.

El registro conserva tiempo, tokens de entrada/salida/caché, herramientas, sesiones
identificadas por huellas, papeles, revisión y coste de los pasos de coordinación.
El tiempo incluye ejecución, comprobaciones e integración; la preparación común
se registra aparte. No se convierten tokens a dinero ni a porcentaje de cuota.

## Reproducción

Desde la carpeta de la aplicación, sin inferencia:

```powershell
npx tsx scripts/iterative-benchmark.ts
node --test scripts/iterative-benchmark.test.mjs
npx tsx scripts/iterative-benchmark.ts --simulate
```

La ejecución real se habilita explícitamente y utiliza cuota de Codex:

```powershell
$env:OFFICE_BENCHMARK_REVISION = git rev-parse HEAD
npx tsx scripts/iterative-benchmark.ts --real
```

Cada intento genera un directorio privado nuevo con huellas del protocolo y del
runtime, sin sobrescribir resultados previos. El informe privado queda en
`.local-office/iterative-benchmark/`. Antes de publicarlo, retirar transcripciones,
rutas personales y datos de cuentas; publicar solo las métricas necesarias.

## Interpretación

Es una muestra exploratoria, no un resultado estadístico. La comparación solo
se considera completa cuando ambos métodos terminan con recibos completos y
mantienen controles equivalentes. La aceptación de sus soluciones se evalúa
por separado y puede fallar en una medición completa. Si uno falla, se conserva el resultado y el
motivo; no se oculta el coste de diagnóstico ni se presentan tiempos parciales
como una mejora demostrada. La eficiencia general exige ampliar casos y repeticiones.

## Primera ejecución y limitación

La primera pareja real terminó el método individual con 106.815 tokens y 42.503 ms;
el método de oficina registró al menos 290.197 tokens, pero faltó el recibo final
del Jefe al fallar el verificador. No se considera una comparación completa ni
se publica un cociente de eficiencia con ese consumo parcial. El recibo incompleto
y su coste se conservan; no se reconstruyen como cero.

Ambas soluciones pasaron las pruebas públicas y 32 de las 36 comprobaciones
externas. Las cuatro discrepancias eran `TypeError` frente al `RangeError`
esperado para números fraccionarios y `NaN` en cantidades y descuentos. El contrato
expresa enteros válidos y rangos, pero conviene explicitar esos tipos de error
antes de ampliar el estudio. No se cambia el contrato ni las soluciones de esta
ejecución retrospectivamente, ni se afirma que el equipo haya mejorado su calidad.

Se añadió diagnóstico privado de fallos del verificador, se redujo la frecuencia
de sus capturas de estado y se corrigió la comparación para rechazar recibos
desconocidos o intentos vacíos. Nueve pruebas y un ensayo completo con ejecutor
simulado pasan sin cuota. La causa exacta del fallo real anterior no quedó registrada;
estas comprobaciones no acreditan todavía su corrección en una nueva pareja real.

La comprobación posterior no inició inferencias: la cuota oficial ya superaba
el margen de inicio de evaluación. El bloque real sigue pendiente; no se aumentó
su presupuesto ni se ocultó el consumo desconocido del intento anterior.

## Espera del cierre sin consultas periódicas

El verificador espera ahora `TeamCoordinator.waitUntilIdle()`: sigue las promesas
de ejecuciones, comprobaciones y coordinación hasta liberar sus recursos y registrar
los recibos. No llama a `snapshot()` repetidamente ni detiene el equipo por un fallo
de una consulta de estado. La instantánea final se obtiene después de esa espera;
si no puede verificarse, el resultado se conserva como `unverified`.

Tres regresiones cubren el evento de estado final anterior al recibo, los cinco
turnos completos con el observador de instantáneas averiado y una pausa humana
que termina la espera sin reanudar trabajo. Pasan 70 pruebas relacionadas del
coordinador y las conversaciones. La simulación del benchmark completa ambos
métodos y sus 36 comprobaciones por método; los contadores son sintéticos.

`npm run benchmark:iterative:test` ejecuta las nueve pruebas del comparador y el
ensayo completo simulado, y falla si ese ensayo no termina correctamente. Se ha
añadido al job de runtime de CI. El comando no habilita inferencia; la ejecución
real sigue siendo un comando separado, `npm run benchmark:iterative:run`.

La comprobación oficial del 25 de octubre, a las 17:47 de Madrid, comunicó un 90%
en la ventana de cinco horas. No se inició otra inferencia. El contador indicaba
renovación a las 20:53; deberá consultarse de nuevo antes del siguiente bloque.
Estos cambios no convierten el primer intento incompleto en una medición válida
ni prueban aún el nuevo recorrido con un modelo real.
