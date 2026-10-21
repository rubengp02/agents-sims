# GitHub Actions en Windows propio

El workflow **CI local Windows** usa el ejecutor oficial de GitHub instalado en
el ordenador del propietario. Solo admite lanzamiento manual desde `main`, por
el propietario y con el repositorio privado. No instala servicios de inicio ni
activa trabajos de PR en el ordenador. El token del job solo puede leer el
repositorio; checkout no conserva credenciales. Las acciones usadas están fijadas
por commit. No cambia facturacion ni activa tareas de IA.

El ejecutor esta fuera del proyecto, en la carpeta privada de usuario
`actions-runner-agents-sims`. Sus archivos internos de autenticacion pertenecen
al programa oficial y no deben copiarse al repositorio. La instalacion inicial
usa runner v2.338.0, archivo oficial Windows x64 comprobado por SHA-256:
`f48e0750a21812bca5f82de5f7f5aeae71abee647fab5a582f1742d07eba455f`.

El listener se inicia oculto para **un solo job**. Al terminar queda desconectado;
el registro del ejecutor permanece disponible para la siguiente sesion. No hace
falta mantener la oficina abierta. Si el ordenador se suspende, las pruebas
pueden interrumpirse. Los logs privados estan en la carpeta del ejecutor; GitHub
muestra los logs y pasos normales del workflow. No se suben artefactos o caches.

Para otra ejecucion:

1. Iniciar el helper privado `start-local.ps1` de esa carpeta, desde PowerShell.
2. En GitHub: Actions → CI local Windows → Run workflow → `main`.
3. Comprobar el resultado del job; encender el ordenador no lo ejecuta solo.

El workflow instala las dependencias del checkout, valida AsyncAPI, formato y
archivos generados, prepara la revision fijada de AO y ejecuta `parallel:verify`:
tipos, lint, empaquetado, aplicacion, politicas, recuperacion de procesos, AO nativo
con proveedor simulado, 72 combinaciones locales y navegador standalone. Añade
la comprobacion del paquete instalable. Audit y Knip mantienen su caracter
informativo del CI existente.

No equivale al CI multiplataforma: no valida macOS, Linux, Node 20 o el host de
extension de VS Code. Esas comprobaciones se conservan en el workflow original.
No se cambian checks obligatorios ni se presentan pruebas omitidas como verdes.

GitHub no cobra minutos de sus ejecutores propios; siguen existiendo los costes
del ordenador, electricidad y conexion. Un bloqueo general de cuenta podria
impedir incluso este lanzamiento: hay que comprobar que GitHub realmente inicia
el job, sin aumentar limites de gasto para resolverlo.
