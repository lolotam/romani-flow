import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Production incident 2026-11-18: the browser filled the saved site login password into
// the SMTP app password field, the save stored it, and Gmail answered smtp_auth_failed.
function inputAttributes(path, id) {
  const source = fs.readFileSync(new URL('../src/components/settings/' + path, import.meta.url), 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const attributes = Object.fromEntries(node.attributes.properties
        .filter(ts.isJsxAttribute)
        .map(attribute => [attribute.name.getText(file), attribute.initializer?.getText(file)]));
      if (attributes.id === `"${id}"`) found = attributes;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(found, `${id} input exists in ${path}`);
  return found;
}

for (const [path, passwordId, usernameId] of [
  ['SmtpConfigCard.tsx', 'smtp_pass', 'smtp_user'],
  ['MemberSmtpCard.tsx', 'member_smtp_pass', 'member_smtp_user'],
]) {
  test(`${path} keeps the browser from autofilling the site login into the SMTP credentials`, () => {
    assert.equal(inputAttributes(path, passwordId).autoComplete, '"new-password"');
    assert.equal(inputAttributes(path, usernameId).autoComplete, '"off"');
  });
}
