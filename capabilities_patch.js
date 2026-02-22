const fs = require('fs');
let cap = JSON.parse(fs.readFileSync('src-tauri/capabilities/default.json', 'utf8'));
if (!cap.permissions) cap.permissions = [];
if (!cap.permissions.includes("shell:allow-open")) {
    cap.permissions.push("shell:allow-open");
    fs.writeFileSync('src-tauri/capabilities/default.json', JSON.stringify(cap, null, 2));
}
