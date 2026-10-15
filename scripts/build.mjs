import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
for(const name of ['index.html','styles.css','app.js','domain.js']) await copyFile(name,'dist/'+name);
console.log('Static site ready in dist/');
