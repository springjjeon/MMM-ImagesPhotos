const express = require("express");
const path = require("path");
const fs = require("fs");
const heicConvert = require("heic-convert");
const { getDirectories } = require("../lib/file-utils");
const { cleanFileNames, notifyMagicMirrorRefresh } = require("../lib/process-utils");
const videoQueue = require("../lib/video-queue");
const { render } = require("../lib/view-renderer");

function createMainRouter(uploadDir, upload) {
	const router = express.Router();

	router.get("/", async (req, res) => {
		try {
			const folders = await getDirectories(uploadDir);
			let folderListHtml = "";

			const baseMobileUploadDir = path.join(uploadDir, "mobileUpload");
			const hiddenMobileUploadDir = path.join(uploadDir, "!mobileUpload");
			const mobileUploadDirName =
				fs.existsSync(hiddenMobileUploadDir) && !fs.existsSync(baseMobileUploadDir)
					? "!mobileUpload"
					: "mobileUpload";

			const now = new Date();
			const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
			const defaultFolderName = `${mobileUploadDirName.replace(/\\/g, "/")}/${yearMonth}`;

			const visibleFolders = folders
				.map((f) => f.replace(/\\/g, "/"))
				.filter((f) => !path.basename(f).startsWith("!"))
				.sort();

			let folderOptions = "";
			const defaultFolderExists = visibleFolders.includes(defaultFolderName);
			const defaultDisplayName = `${defaultFolderName.split("/").join(" / ")} ${!defaultFolderExists ? "(새 폴더)" : ""}`;
			folderOptions += `<option value="${defaultFolderName}" selected>${defaultDisplayName}</option>`;

			visibleFolders.forEach((folder) => {
				if (folder === defaultFolderName) return;
				const displayName = folder.split("/").join(" / ");
				folderOptions += `<option value="${folder}">${displayName}</option>`;
			});

			folderOptions += `<option value="">-- 새 폴더 직접 입력 --</option>`;

			if (folders.length > 0) {
				const folderItems = folders
					.map((folder) => {
						const baseName = path.basename(folder);
						const isHidden = baseName.startsWith("!");
						const displayName = isHidden ? baseName.substring(1) : baseName;
						const depth = folder.split(path.sep).length - 1;
						const paddingLeft = depth * 25;
						const clientPath = folder.split(path.sep).join("/");
						const hasChildren = folders.some((f) => f !== folder && f.startsWith(folder + path.sep));
						const safeClientPath = clientPath.replace(/'/g, "\\'");

						return `
							<li class="folder-item ${isHidden ? "is-hidden" : ""}" data-path="${clientPath}" style="padding-left: ${paddingLeft}px;">
								<div class="folder-info">
									${hasChildren ? `<span class="toggle-icon" onclick="toggleFolder('${safeClientPath}', this)">▼</span>` : `<span class="toggle-icon"></span>`}
									<a class="folder-link" href="/manage/photos?folderName=${encodeURIComponent(folder)}">
										<span class="folder-icon">📁</span>
										<span class="folder-name">${displayName}</span>
									</a>
								</div>
								<div class="folder-actions">
									<form action="/manage/toggle-folder" method="post" style="margin: 0;">
										<input type="hidden" name="folderName" value="${folder}">
										<button type="submit" class="action-btn toggle-btn ${isHidden ? "show-btn" : "hide-btn"}">
											${isHidden ? "보이기" : "숨기기"}
										</button>
									</form>
								</div>
							</li>
						`;
					})
					.join("");

				folderListHtml = `
					<div class="container" style="margin-top: 20px;">
						<h2>📁 사진 폴더 관리</h2>
						<p style="color: #666; font-size: 14px;">폴더별로 매직미러에 표시할지 설정하세요. (재시작 없이 즉시 반영됩니다)</p>
						<div style="display: flex; gap: 10px; margin-bottom: 15px;">
							<form action="/manage/show-all-folders" method="post" style="margin: 0; flex: 1;">
								<button type="submit" class="toolbar-btn show-all-btn">전체 보이기</button>
							</form>
							<form action="/manage/hide-all-folders" method="post" style="margin: 0; flex: 1;">
								<button type="submit" class="toolbar-btn hide-all-btn">전체 숨기기</button>
							</form>
						</div>
						<ul class="folder-list">${folderItems}</ul>
					</div>
				`;
			}

			const pageContent = render("index", { folderListHtml, folderOptions, mobileUploadDirName });
			res.send(pageContent);
		} catch (error) {
			console.error("Error getting page:", error);
			res.status(500).send("<h1>Error loading page</h1><p>Check server logs for details.</p>");
		}
	});

	router.post("/upload", upload.array("photos", 50), async (req, res) => {
		console.log(`\n📤 Upload request received (${req.files ? req.files.length : 0} file(s))`);

		const customFolder = (req.body.customFolder || "").trim();
		const selectedFolder = (req.body.folderName || "").trim();

		if (!req.files || req.files.length === 0) {
			return res.status(400).send("<h1>❌ 파일이 업로드되지 않았습니다.</h1>");
		}

		let targetPath;
		let displayName;

		if (customFolder || selectedFolder) {
			const targetFolder = customFolder || selectedFolder;
			targetPath = path.resolve(uploadDir, targetFolder);
			if (!targetPath.startsWith(path.resolve(uploadDir))) {
				return res.status(400).send("<h1>❌ 잘못된 폴더 경로입니다.</h1>");
			}
			displayName = targetFolder;
		} else {
			const now = new Date();
			const yearMonthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
			const baseMobileUploadDir = path.join(uploadDir, "mobileUpload");
			const hiddenMobileUploadDir = path.join(uploadDir, "!mobileUpload");
			const basePath = fs.existsSync(baseMobileUploadDir) ? baseMobileUploadDir : hiddenMobileUploadDir;
			const normalPath = path.join(basePath, yearMonthFolder);
			const hiddenPath = path.join(basePath, "!" + yearMonthFolder);
			targetPath = fs.existsSync(hiddenPath) ? hiddenPath : normalPath;
			displayName = `mobileUpload/${yearMonthFolder}`;
		}

		try {
			if (!fs.existsSync(targetPath)) {
				fs.mkdirSync(targetPath, { recursive: true });
			}
		} catch (err) {
			return res.status(500).send("<h1>❌ 폴더 생성 실패</h1><p>" + err.message + "</p>");
		}

		let movedCount = 0;
		let failedCount = 0;
		let heicConvertedCount = 0;
		const queuedVideos = [];

		for (const file of req.files) {
			const oldPath = file.path;
			const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
			const baseName = path.basename(oldPath);
			const fileExt = path.extname(fileName).toLowerCase();

			try {
				if (!fs.existsSync(oldPath)) {
					failedCount++;
					continue;
				}

				if (fileExt === ".heic" || fileExt === ".heif") {
					const inputBuffer = fs.readFileSync(oldPath);
					const outputBuffer = await heicConvert({
						buffer: inputBuffer,
						format: "JPEG",
						quality: 0.92
					});
					const jpgBase = baseName.replace(/\.(heic|heif)$/i, ".jpg");
					const jpgPath = path.join(targetPath, jpgBase);
					fs.writeFileSync(jpgPath, outputBuffer);
					fs.unlinkSync(oldPath);
					movedCount++;
					heicConvertedCount++;
					console.log(`  ✅ HEIC -> JPG converted: ${jpgPath}`);
				} else {
					const destPath = path.join(targetPath, baseName);
					fs.renameSync(oldPath, destPath);
					movedCount++;

					if ([".mp4", ".mov"].includes(fileExt)) {
						videoQueue.enqueueVideo(destPath, fileName);
						queuedVideos.push(fileName);
					}
				}
			} catch (err) {
				console.error(`  ❌ Error processing ${fileName}: ${err.message}`);
				try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (_) {}
				failedCount++;
			}
		}

		console.log(`✅ Upload done: ${movedCount} ok (${heicConvertedCount} HEIC->JPG, ${queuedVideos.length} video queued), ${failedCount} failed`);

		if (selectedFolder) {
			res.redirect(`/manage/photos?folderName=${encodeURIComponent(selectedFolder)}`);
		} else {
			const notes = [];
			if (heicConvertedCount > 0) notes.push(`📷 아이폰 HEIC ${heicConvertedCount}장을 JPG로 자동 변환했습니다.`);
			if (queuedVideos.length > 0) notes.push(`🎬 동영상 ${queuedVideos.length}개는 백그라운드에서 최적화 변환 중입니다.`);

			const notesHtml = notes.length
				? `<div style="margin:20px auto; max-width:460px; padding:14px; border-radius:10px; background:#f4f7fb; text-align:left; font-size:14px;">${notes.map((n) => `<p style="margin:6px 0;">${n}</p>`).join("")}</div>`
				: "";

			res.send(`
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<div style="text-align:center; padding:40px 20px; font-family: sans-serif;">
					<h1 style="color: #4CAF50;">✅ 업로드 완료!</h1>
					<p>📁 저장 위치: <strong>${displayName}</strong></p>
					<p>성공: ${movedCount}개 파일 ${failedCount > 0 ? `/ 실패: ${failedCount}개` : ""}</p>
					${notesHtml}
					<p style="margin-top: 20px; color: #555;">매직미러 사진 목록에 재시작 없이 자동 반영됩니다 ✨</p>
					<br>
					<a href="/" style="padding: 15px 30px; background: #333; color: white; text-decoration: none; border-radius: 10px; display: inline-block;">돌아가기</a>
				</div>
			`);
		}

		setImmediate(() => {
			cleanFileNames(() => {
				notifyMagicMirrorRefresh();
			});
		});
	});

	return router;
}

module.exports = createMainRouter;
