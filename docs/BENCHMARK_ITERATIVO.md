# Comparación controlada: Codex individual y oficina iterativa

## Protocolo exploratorio v1

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
