import { cp, mkdir, writeFile } from 'node:fs/promises';
const target = 'release/饭价电脑端';
await mkdir(target, {recursive:true});
await cp('node_modules/electron/dist', target, {recursive:true});
await mkdir(`${target}/resources/app`, {recursive:true});
await cp('out', `${target}/resources/app/out`, {recursive:true});
await cp('package.json', `${target}/resources/app/package.json`);
for (const name of ['playwright','playwright-core','ws']) {
  await cp(`node_modules/${name}`, `${target}/resources/app/node_modules/${name}`, {recursive:true});
}
await writeFile(`${target}/启动饭价.cmd`, '@echo off\r\ncd /d "%~dp0"\r\nstart "" electron.exe\r\n', 'utf8');
console.log('Portable desktop: '+target+' (uses installed Microsoft Edge)');
