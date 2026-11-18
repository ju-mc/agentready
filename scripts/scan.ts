import { scan, toFree } from "../lib/scanner";
const [url, mode] = process.argv.slice(2);
if (!url) { console.error("usage: npm run scan -- <url> [full|free]"); process.exit(1); }
scan(url, { full: mode === "full" }).then((r) => console.log(JSON.stringify(mode === "full" ? r : toFree(r), null, 2)))
  .catch((e) => { console.error(e.message); process.exit(1); });
