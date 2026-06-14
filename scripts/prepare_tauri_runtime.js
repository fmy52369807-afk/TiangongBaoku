const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const runtimeDir = path.join(root, 'runtime', 'node');
const targetNode = path.join(runtimeDir, 'node.exe');

function findNode() {
  const candidates = [
    process.execPath,
    process.env.TIANGONG_NODE,
    'D:\\node-v18.20.5-win-x64\\node.exe',
    'D:\\HTML\\node.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && path.basename(candidate).toLowerCase() === 'node.exe') {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Could not find node.exe. Set TIANGONG_NODE to a Node.js executable path.');
}

fs.mkdirSync(runtimeDir, { recursive: true });

const sourceNode = findNode();
fs.copyFileSync(sourceNode, targetNode);

const sizeMB = (fs.statSync(targetNode).size / 1024 / 1024).toFixed(1);
console.log(`Prepared bundled Node runtime: ${targetNode} (${sizeMB} MB)`);
