const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const THUMB_DIR = path.join(__dirname, "..", "..", ".cache", "thumbs");
const MAX_CONCURRENT = 4;
const THUMB_SIZE = 360;

const inFlight = new Map();
const queue = [];
let activeWorkers = 0;

const PY_THUMB_SCRIPT = `
import sys
from PIL import Image, ImageOps
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
with Image.open(src) as im:
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.thumbnail((size, size), Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.ANTIALIAS)
    im.save(dst, "JPEG", quality=80, optimize=True)
`;

function drainQueue() {
	while (activeWorkers < MAX_CONCURRENT && queue.length > 0) {
		const job = queue.shift();
		activeWorkers++;
		execFile("python3", ["-c", PY_THUMB_SCRIPT, job.srcPath, job.tmpPath, String(THUMB_SIZE)], { timeout: 15000 }, (err) => {
			activeWorkers--;
			if (!err && fs.existsSync(job.tmpPath)) {
				try {
					fs.renameSync(job.tmpPath, job.thumbPath);
					job.resolve(job.thumbPath);
				} catch (renameErr) {
					job.reject(renameErr);
				}
			} else {
				try { fs.unlinkSync(job.tmpPath); } catch (_) {}
				job.reject(err || new Error("Thumbnail generation failed"));
			}
			inFlight.delete(job.key);
			drainQueue();
		});
	}
}

function getOrCreateThumbnail(uploadDir, relPath) {
	return new Promise((resolve, reject) => {
		const fullPath = path.resolve(uploadDir, relPath);
		const normalizedRoot = path.resolve(uploadDir) + path.sep;
		if (!fullPath.startsWith(normalizedRoot) || !fs.existsSync(fullPath)) {
			return reject(new Error("File not found"));
		}

		let stat;
		try {
			stat = fs.statSync(fullPath);
			if (!stat.isFile()) return reject(new Error("Not a file"));
		} catch (e) {
			return reject(e);
		}

		const hash = crypto
			.createHash("sha1")
			.update(`${relPath}|${stat.mtimeMs}|${stat.size}`)
			.digest("hex");

		if (!fs.existsSync(THUMB_DIR)) {
			fs.mkdirSync(THUMB_DIR, { recursive: true });
		}

		const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);
		if (fs.existsSync(thumbPath)) {
			return resolve(thumbPath);
		}

		if (inFlight.has(hash)) {
			return inFlight.get(hash).then(resolve, reject);
		}

		const promise = new Promise((res, rej) => {
			queue.push({
				key: hash,
				srcPath: fullPath,
				tmpPath: `${thumbPath}.${process.pid}.tmp`,
				thumbPath,
				resolve: res,
				reject: rej
			});
			drainQueue();
		});

		inFlight.set(hash, promise);
		promise.then(resolve, reject);
	});
}

module.exports = { getOrCreateThumbnail };
