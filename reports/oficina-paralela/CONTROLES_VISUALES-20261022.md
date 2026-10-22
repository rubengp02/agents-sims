# Controles visuales del equipo

## Entrega

Se conectan al panel existente las capacidades avanzadas que antes requerían
llamadas manuales a la API: activación experimental, encargo acotado,
reparto de dos partes, archivos propios y compartidos, aceptación, selección de
pruebas configuradas y cotas manuales de tareas e integración.

El panel muestra organización secuencial/paralela, motivo, identidades de
trabajadores, dependencias, carpetas, candidato integrado, huella y resultados.
Se separan tiempo de pared, suma de duraciones y consumo desconocido.
Un flujo recuperado en pausa no ofrece el botón genérico de continuación como
vía de reaceptación.

Se conserva un Programador por defecto, el máximo global existente de dos
ejecuciones y todos los controles del servidor. Preparar un encargo o guardar
cotas no ejecuta modelos ni amplía el presupuesto. Las estimaciones manuales
empiezan vacías y quedan vinculadas al perfil elegido. La habilitación de dos
escritores requiere una acción explícita y aislamiento comunicado por el servidor.

`TeamSnapshot.capabilities` comunica capacidades reales de los objetos locales.
El catálogo de pruebas contiene solo identificador y condición de aceptación;
no publica comandos, argumentos ni logs. Son campos opcionales compatibles con
clientes anteriores. La ausencia de capacidades no habilita controles avanzados.

## Evidencia local

- Servidor: 694/694 pruebas en 44 archivos; 111,53 segundos.
- Visor: 59/59 pruebas en 8 archivos; 5,08 segundos.
- Navegador: 8/8 casos de equipo y UI; 35,3 segundos. Se repitieron los dos casos
  de equipo con comprobaciones adicionales de límites, disponibilidad de AO y
  anchura móvil: 2/2 en 15,7 segundos.
- Empaquetado completo: correcto, incluida generación del protocolo, tipos,
  lint, compilación del servidor y compilación del visor. Solo queda la
  advertencia previa de dependencia `editor` en `App.tsx`.
- `git diff --check`: correcto.

El caso avanzado usa navegador real, HTTP local, repositorios y worktrees Git
temporales, registro de comprobaciones con procesos Node reales y proveedor
simulado. Desde la UI se rechaza un criterio ajeno al contrato sin crear tareas;
se preparan dos trabajadores sin inferencia; se revisan cotas sin cambiar los
límites globales; se integra el resultado en una tercera carpeta y se comprueba
el conjunto. El checkout original permanece intacto. Tras reiniciar, el candidato
se muestra en pausa, sin nuevas llamadas. Una cota superior al presupuesto no
se guarda. El modo sin aislamiento muestra la activación experimental bloqueada.

Se inspeccionaron las capturas de escritorio y móvil; la prueba móvil comprueba
también ausencia de desbordamiento horizontal del panel. Los archivos de imagen
y logs permanecen locales, fuera del informe público.

## Intentos fallidos y correcciones

- Dos intentos de empaquetado se detuvieron por orden de imports en archivos
  editados. Se corrigieron con el formateador y ESLint; el empaquetado final pasa.
- El primer recorrido nuevo de navegador falló al exigir que una casilla
  controlada por respuesta HTTP cambiase de estado sin esperar esa respuesta.
  Se corrigió el test para pulsar y comprobar tanto el estado confirmado del
  servidor como la casilla. No se ampliaron plazos, retiraron verificaciones ni
  alteraron los controles de autorización. Los recorridos posteriores pasan.

## Límites

No se ejecutaron modelos reales, no se verificó de nuevo una suscripción real
y los contadores del proveedor simulado no son medidas de consumo de cuota.
Esta entrega no demuestra ahorro ni rendimiento con IA real.

Se reutilizan componentes, colores y secciones desplegables del panel actual;
no se modifican oficina, personajes, recursos gráficos ni animaciones.
La elección del motor al arrancar y la definición de comandos del registro
de pruebas siguen siendo configuración local. No se añade cambio de motor en
caliente, edición de comandos desde HTTP, recuperación automática, merge ni push.
No se habilita Claude ni se conecta Antigravity. Los informes anteriores se conservan.

Instrucciones de uso en [EQUIPO_MULTIAGENTE.md](../../docs/EQUIPO_MULTIAGENTE.md).
