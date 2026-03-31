const { Database } = require("bun:sqlite");
const db = new Database("/home/bun/.config/sharkord/db.sqlite", { readonly: true });

// List all tables
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("TABLES:", JSON.stringify(tables));

// For each table, show schema
for (const t of tables) {
  const info = db.query(`PRAGMA table_info('${t.name}')`).all();
  console.log(`\nSCHEMA ${t.name}:`, JSON.stringify(info));
}

db.close();
