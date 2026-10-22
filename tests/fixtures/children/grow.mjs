const held = [];

setInterval(() => {
  // Fill the buffer so the pages count as resident memory on macOS.
  held.push(Buffer.alloc(16 * 1024 * 1024, 1));
}, 20);

process.on("message", () => {
  // Keep the buffers for the life of the process.
});
