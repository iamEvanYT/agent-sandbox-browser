export const config = {
  cdpPort: 9222,
  vncPort: 5900,
  noVncPort: 6080,
  enableNoVnc: process.env.ENABLE_NOVNC !== "0",
  headless: process.env.HEADLESS === "1",
  display: ":1",
  home: "/home/agent",
};
