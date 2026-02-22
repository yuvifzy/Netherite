const fs = require('fs');
let caps = JSON.parse(fs.readFileSync('src-tauri/capabilities/default.json', 'utf8'));

const required = [
  "core:window:allow-create",
  "core:window:allow-set-focus",
  "core:window:allow-outer-position"
];

for(const p of required) {
  if (!caps.permissions.includes(p)) caps.permissions.push(p);
}

fs.writeFileSync('src-tauri/capabilities/default.json', JSON.stringify(caps, null, 2));
