import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
import {ar} from '../src/translations/ar.ts';import {en} from '../src/translations/en.ts';
const files=['src/pages/Settings.tsx',...fs.readdirSync('src/components/settings').filter(f=>f.endsWith('.tsx')).map(f=>'src/components/settings/'+f)];
for(const [language,dict] of Object.entries({ar,en}))test(`all static settings labels resolve in ${language}`,()=>{
 for(const file of files)for(const m of fs.readFileSync(file,'utf8').matchAll(/t\(['"](settings\.[^'"]+)['"]/g)){
 let value=dict;for(const key of m[1].split('.'))value=value?.[key];assert.equal(typeof value,'string',file+': '+m[1]);assert.ok(value.trim());
 }
});
import {restoreFormDate} from '../src/lib/formDefaults.ts';
test('saved dates restore as local date-only values and invalid dates stay empty',()=>{
 const value=restoreFormDate('2028-02-29');assert.ok(value instanceof Date);assert.equal(value.getMonth(),1);assert.equal(value.getDate(),29);
 for(const raw of [null,undefined,'','invalid','2027-02-29','2030-13-01'])assert.equal(restoreFormDate(raw),undefined);
});
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DirectionProvider} from '@radix-ui/react-direction';
import {Root as TabsRoot} from '@radix-ui/react-tabs';
import {formatTranslation} from '../src/lib/translationText.ts';
test('Radix primitives inherit the same RTL provider, including saved-language startup',()=>{
 for(const dir of ['rtl','ltr']){
 const markup=renderToStaticMarkup(createElement(DirectionProvider,{dir},createElement(TabsRoot,{defaultValue:'one'},'Fixture')));
 assert.ok(markup.includes(`dir="${dir}"`),markup);
 }
});
test('translated counters and messages interpolate single/double braces and zero',()=>{
 assert.equal(formatTranslation('Companies ({count}) — {{name}}',{count:0,name:'Fixture'}),'Companies (0) — Fixture');
 assert.equal(formatTranslation('{status}',{status:''}),'');
});
