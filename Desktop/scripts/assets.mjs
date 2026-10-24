import { cp, mkdir } from 'node:fs/promises';
await mkdir('out/resources', {recursive:true});
await cp('../MealCompare/Resources', 'out/resources', {recursive:true});
await cp('ui', 'out/ui', {recursive:true});
await cp('ui/preload.cjs', 'out/preload.cjs');
await cp('../MealCompare/Assets.xcassets/AppIcon.appiconset/AppIcon.png', 'out/ui/icon.png');
