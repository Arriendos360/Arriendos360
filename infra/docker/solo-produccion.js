// Deja el monorepo listo para `npm install --omit=dev` con SOLO los workspaces de una imagen.
// Lo usa la etapa `compilacion` de cada Dockerfile, sobre su copia del repo:
//
//   node infra/docker/solo-produccion.js services/ms-identidad packages/shared packages/contracts
//
// Por qué no basta `npm prune --omit=dev --workspace=...`: en npm 10 deja lo que el
// lockfile trae de los DEMAS workspaces —typescript, ts-node, jest, babel— y la imagen
// cargaba 96 MB de node_modules en vez de 30 (comprobado, ver `docs/adr/0022`). Con la raiz
// reducida a los workspaces de la imagen, npm sólo resuelve ese grafo.
//
// Quita también los `prepare`: compilan TypeScript, que ya no está, y `dist/` ya existe.
// `--ignore-scripts` no alcanza al `prepare` de un workspace en npm 10.

const fs = require('fs');
const path = require('path');

const workspaces = process.argv.slice(2);
if (workspaces.length === 0) {
  console.error('Uso: node infra/docker/solo-produccion.js <workspace>...');
  process.exit(1);
}

const reescribir = (archivo, cambiar) => {
  const manifiesto = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  cambiar(manifiesto);
  fs.writeFileSync(archivo, JSON.stringify(manifiesto, null, 2) + '\n');
};

reescribir('package.json', (raiz) => {
  raiz.workspaces = workspaces;
  delete raiz.devDependencies;
});

for (const workspace of workspaces) {
  reescribir(path.join(workspace, 'package.json'), (manifiesto) => {
    if (manifiesto.scripts) delete manifiesto.scripts.prepare;
  });
}
