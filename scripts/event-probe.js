// Temporary debug: log ALL events the plugin receives
const { onLoad: originalOnLoad, onUnload } = require("/home/bun/.config/sharkord/plugins/sharkord-hero-introducer/server.js");

// We just need to check what event names are available
// Run: docker exec hero-introducer-dev bun /tmp/list-events.js
console.log("Checking Sharkord event system...");

// Inspect the ctx.events.on to see if there's an eventNames() method
// This is a diagnostic script
console.log("Script loaded - use docker exec to run event probe");
