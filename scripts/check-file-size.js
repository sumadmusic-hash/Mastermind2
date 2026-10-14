#!/usr/bin/env node
/**
 * File Size Checker
 * Ensures no source file exceeds 1000 lines.
 * Run: node scripts/check-file-size.js
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

const MAX_LINES = 1000;
const SRC_DIR = new URL('../src', import.meta.url).pathname;
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

let hasViolation = false;
let checkedFiles = 0;
let violations = [];

async function checkDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await checkDir(fullPath);
    } else if (EXTENSIONS.includes(extname(entry.name))) {
      checkedFiles++;
      const content = await readFile(fullPath, 'utf-8');
      const lineCount = content.split('\n').length;
      if (lineCount > MAX_LINES) {
        hasViolation = true;
        violations.push({ file: fullPath.replace(SRC_DIR, 'src'), lines: lineCount });
      }
    }
  }
}

await checkDir(SRC_DIR);

console.log(`\n📏 File Size Check (max ${MAX_LINES} lines)`);
console.log(`   Checked: ${checkedFiles} files`);

if (hasViolation) {
  console.log(`\n❌ VIOLATIONS:`);
  for (const v of violations) {
    console.log(`   ${v.file}: ${v.lines} lines`);
  }
  process.exit(1);
} else {
  console.log(`✅ All files within limit\n`);
}
