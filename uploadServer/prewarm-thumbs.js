const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const UPLOAD_DIR = path.resolve(__dirname, "../uploads");
const THUMB_DIR = path.resolve(__dirname, "../.cache/thumbs");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

const jobs = [];
function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full);
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (!IMAGE_EXTS.has(ext)) continue;
			const relPath = path.relative(UPLOAD_DIR, full).split(path.sep).join("/");
			const stat = fs.statSync(full);
			const hash = crypto.createHash("sha1").update(`${relPath}|${stat.mtimeMs}|${stat.size}`).digest("hex");
			const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);
			if (!fs.existsSync(thumbPath)) {
				jobs.push({ src: full, dst: thumbPath });
			}
		}
	}
}

walk(UPLOAD_DIR);
console.log(`Missing thumbnails to generate: ${jobs.length}`);
if (jobs.length === 0) process.exit(0);

const pyCode = `
import concurrent.futures, json, os, sys
from PIL import Image, ImageOps

try:
    os.nice(15)
except Exception:
    pass

jobs = json.load(sys.stdin)
ok = 0
fail = 0

def make_one(job):
    src, dst = job["src"], job["dst"]
    tmp = dst + ".tmp"
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.thumbnail((360, 360), Image.Resampling.LANCZOS)
            im.save(tmp, "JPEG", quality=80, optimize=True)
        os.replace(tmp, dst)
        return True
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass
        return False

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
    for idx, res in enumerate(ex.map(make_one, jobs), 1):
        if res:
            ok += 1
        else:
            fail += 1
        if idx % 200 == 0 or idx == len(jobs):
            print(f"[{idx}/{len(jobs)}] ok={ok} fail={fail}", flush=True)
`;

const child = spawn("python3", ["-c", pyCode], { stdio: ["pipe", "inherit", "inherit"] });
child.stdin.write(JSON.stringify(jobs));
child.stdin.end();
child.on("close", (code) => {
	process.exit(code || 0);
});
