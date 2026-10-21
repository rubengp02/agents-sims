# Difícil: cola concurrente e idempotente

Corrige la cola de tareas con concurrencia, cancelación e idempotencia en queue.mjs y validation.mjs.

createQueue({concurrency}) exportada por queue.mjs exige un entero entre 1 y 8.
Exporta validateConcurrency desde validation.mjs: tipos no number lanzan TypeError;
números no enteros o fuera de rango lanzan RangeError. La cola expone submit(id,job),
cancel(id), idle(), stats(). submit exige id string no vacío y job función, con
TypeError síncrono en entradas inválidas. Cada job recibe su AbortSignal.
Los jobs empiezan en orden FIFO, hasta concurrency. Repetir un id válido devuelve
exactamente la misma Promise durante y después del trabajo, sin ejecutar el job nuevo.
Resolver conserva el valor; rechazar conserva el error. Un throw síncrono no rompe
la cola ni ocupa una plaza. Los trabajos finalizados no vuelven a ejecutarse.
cancel(id) devuelve true solo la primera vez que cancela una tarea pendiente/activa;
false para desconocidas o ya terminadas/canceladas. Cancelar una pendiente no ejecuta
su job y rechaza su Promise con error.name='AbortError'. Cancelar una activa aborta
su señal pero conserva su plaza hasta que su job realmente termina; entonces su
Promise rechaza AbortError incluso si el job resolvió. Sin cancelación implícita de
otras tareas. idle() resuelve cuando no queda trabajo pendiente ni activo.
stats() devuelve una copia {running,queued,completed,cancelled,failed}; completed y
failed cuentan resultados asentados, cancelled cuenta cancelaciones aceptadas una
sola vez. Una tarea cancelada no cuenta como completed/failed. No hay polling, red,
temporizadores ni dependencias externas. Solo se permite modificar los dos módulos.

Archivos modificables: queue.mjs, validation.mjs.
Pruebas públicas: `node --test contract.test.mjs`.
Modelo solicitado: GPT-6.1 Sol; razonamiento: high, igual para todos los papeles de ambos métodos.

Orden fijado: direct → office.
Papeles de oficina esperados: architect, developer, tester.
