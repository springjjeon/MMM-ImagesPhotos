const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getDirectories } = require('../lib/file-utils');
const { cleanFileNames, restartMagicMirror } = require('../lib/process-utils');
const { render } = require('../lib/view-renderer');

function createMainRouter(uploadDir, upload, tempUploadDir) {
    const router = express.Router();

    // Main page to upload and manage folders
    router.get('/', async (req, res) => {
        try {
            const folders = await getDirectories(uploadDir);
            let folderListHtml = '';

            // 'mobileUpload' 또는 '!mobileUpload' 중 사용 중인 폴더명 확인
            const baseMobileUploadDir = path.join(uploadDir, 'mobileUpload');
            const hiddenMobileUploadDir = path.join(uploadDir, '!mobileUpload');
            const mobileUploadDirName = fs.existsSync(hiddenMobileUploadDir) && !fs.existsSync(baseMobileUploadDir)
                ? '!mobileUpload'
                : 'mobileUpload';

            // 기본 업로드 폴더 (YYYY-MM) 경로 생성
            const now = new Date();
            const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const defaultFolderName = `${mobileUploadDirName.replace(/\\/g, '/')}/${yearMonth}`;

            const visibleFolders = folders
                .map(f => f.replace(/\\/g, '/')) // 경로 구분자 통일
                .filter(f => !path.basename(f).startsWith('!'))
                .sort();
            
            let folderOptions = '';
            const defaultFolderExists = visibleFolders.includes(defaultFolderName);

            // 1. 기본 폴더 옵션
            const defaultDisplayName = `${defaultFolderName.split('/').join(' / ')} ${!defaultFolderExists ? '(새 폴더)' : ''}`;
            folderOptions += `<option value="${defaultFolderName}" selected>${defaultDisplayName}</option>`;
            
            // 2. 다른 폴더 목록
            visibleFolders.forEach(folder => {
                if (folder === defaultFolderName) return; // Skip default, it's already added
                const displayName = folder.split('/').join(' / ');
                folderOptions += `<option value="${folder}">${displayName}</option>`;
            });
            
            // 3. 직접 입력 옵션
            folderOptions += `<option value="">-- 새 폴더 직접 입력 --</option>`;

            if (folders.length > 0) {
                const folderItems = folders.map(folder => {
                    const absolutePath = path.join(uploadDir, folder);
                    const baseName = path.basename(folder);
                    const isHidden = baseName.startsWith('!');
                    const displayName = isHidden ? baseName.substring(1) : baseName;
                    const depth = folder.split(path.sep).length - 1;
                    const paddingLeft = depth * 25;
                    const clientPath = folder.split(path.sep).join('/');
                    const hasChildren = folders.some(f => f !== folder && f.startsWith(folder + path.sep));
                    const safeClientPath = clientPath.replace(/'/g, "\\'");

                    return `
                        <li class="folder-item ${isHidden ? 'is-hidden' : ''}" data-path="${clientPath}" style="padding-left: ${paddingLeft}px;">
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
                                    <button type="submit" class="action-btn toggle-btn ${isHidden ? 'show-btn' : 'hide-btn'}">
                                        ${isHidden ? '보이기' : '숨기기'}
                                    </button>
                                </form>
                            </div>
                        </li>
                    `;
                }).join('');
                
                folderListHtml = `
                    <div class="container" style="margin-top: 20px;">
                        <h2>📁 사진 폴더 관리</h2>
                        <p style="color: #666; font-size: 14px;">폴더별로 매직미러에 표시할지 설정하세요.</p>
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

            const pageContent = render('index', { folderListHtml, folderOptions, mobileUploadDirName });
            res.send(pageContent);
        } catch (error) {
            console.error('Error getting page:', error);
            res.status(500).send('<h1>Error loading page</h1><p>Check server logs for details.</p>');
        }
    });

    // Handle file upload
    router.post('/upload', upload.array('photos', 50), (req, res) => {
        console.log(`\n📤 Upload request received`);
        console.log(`Files: ${req.files ? req.files.length : 0}`);
        console.log(`Body:`, req.body);

        const customFolder = (req.body.customFolder || '').trim();
        const selectedFolder = (req.body.folderName || '').trim();

        if (!req.files || req.files.length === 0) {
            console.error('❌ No files received');
            return res.status(400).send('<h1>❌ 파일이 업로드되지 않았습니다.</h1>');
        }

        let targetPath;
        let displayName;

        // Determine target path for upload
        if (customFolder || selectedFolder) {
            const targetFolder = customFolder || selectedFolder;
            targetPath = path.join(uploadDir, targetFolder);
            displayName = targetFolder;
        } else {
            const now = new Date();
            const yearMonthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const baseMobileUploadDir = path.join(uploadDir, 'mobileUpload');
            const hiddenMobileUploadDir = path.join(uploadDir, '!mobileUpload');
            const basePath = fs.existsSync(baseMobileUploadDir) ? baseMobileUploadDir : hiddenMobileUploadDir;
            const normalPath = path.join(basePath, yearMonthFolder);
            const hiddenPath = path.join(basePath, '!' + yearMonthFolder);
            targetPath = fs.existsSync(hiddenPath) ? hiddenPath : normalPath;
            displayName = `mobileUpload/${yearMonthFolder}`;
        }
        
        console.log(`📁 Target folder: ${targetPath}`);

        // Create target directory if it doesn't exist
        try {
            if (!fs.existsSync(targetPath)) {
                fs.mkdirSync(targetPath, { recursive: true });
                console.log(`✅ Created folder: ${targetPath}`);
            }
        } catch (err) {
            console.error(`❌ Failed to create folder: ${targetPath}`, err);
            return res.status(500).send('<h1>❌ 폴더 생성 실패</h1><p>' + err.message + '</p>');
        }

        let movedCount = 0;
        let failedCount = 0;
        const conversionResults = [];

        // Process each file: move and then convert if it's a video
        req.files.forEach((file, index) => {
            const oldPath = file.path;
            const fileName = file.originalname;
            // The final path for the file after potential conversion
            const baseName = path.basename(oldPath);
            const finalName = fileName.toLowerCase().endsWith('.mov')
                ? baseName.replace(/\.[^/.]+$/, "") + ".mp4"
                : baseName;
            const newPath = path.join(targetPath, finalName);
            const originalNewPath = path.join(targetPath, baseName);

            console.log(`  [${index + 1}/${req.files.length}] Processing ${fileName}`);
            
            try {
                if (!fs.existsSync(oldPath)) {
                    console.error(`    ❌ Source file not found: ${oldPath}`);
                    failedCount++;
                    return;
                }
                
                // Move file from temp to target directory
                fs.renameSync(oldPath, originalNewPath);
                movedCount++;
                console.log(`    ✅ Moved to: ${originalNewPath}`);

                // If it's a video, run the conversion script
                const videoExtensions = ['.mp4', '.mov'];
                const fileExt = path.extname(fileName).toLowerCase();

                if (videoExtensions.includes(fileExt)) {
                    const scriptPath = path.resolve(__dirname, '../../convert_videos.sh');
                    // We pass the path of the *moved* file to the script
                    const command = `/bin/bash "${scriptPath}" "${originalNewPath}"`;
                    
                    console.log(`    🚀 Triggering synchronous video conversion...`);
                    try {
                        const output = execSync(command, { encoding: 'utf8' });
                        const finalOutput = output.trim().split('\n').pop(); // Get the last line of output
                        conversionResults.push({
                            fileName,
                            output: finalOutput,
                            isError: false,
                        });
                        console.log(`    📝 Conversion result: ${finalOutput}`);
                    } catch (error) {
                        const errorMessage = `❌ Conversion failed: ${error.stderr || error.message}`;
                        conversionResults.push({
                            fileName,
                            output: errorMessage,
                            isError: true,
                        });
                        console.error(`    🔥 Conversion error for ${fileName}:`, error);
                    }
                }
            } catch (err) {
                console.error(`    ❌ Error processing ${fileName}: ${err.message}`);
                failedCount++;
            }
        });

        console.log(`\n✅ Upload processing finished: ${movedCount} success, ${failedCount} failed`);

        // If upload happened from a specific folder management page, redirect back
        if (selectedFolder) {
            console.log(`Redirecting to /manage/photos?folderName=${encodeURIComponent(selectedFolder)}`);
            res.redirect(`/manage/photos?folderName=${encodeURIComponent(selectedFolder)}`);
        } else {
            // Otherwise, show the success page with conversion results
            let conversionHtml = '';
            if (conversionResults.length > 0) {
                conversionHtml = `
                    <div style="margin-top: 30px; padding: 20px; border-radius: 8px; background-color: #f7f7f7; text-align: left;">
                        <h3 style="margin-top: 0; margin-bottom: 15px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">📹 동영상 변환 결과</h3>
                        <ul style="list-style-type: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto;">
                `;
                conversionResults.forEach(result => {
                    const icon = result.output.includes('통과') ? '⚡' : (result.output.includes('완료') ? '✅' : '❌');
                    conversionHtml += `
                        <li style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px;">
                            <strong style="color: ${result.isError ? '#d9534f' : '#333'};">${result.fileName}</strong>:
                            <span style="margin-left: 5px;">${icon} ${result.output}</span>
                        </li>`;
                });
                conversionHtml += '</ul></div>';
            }

            const successHtml = `
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <div style="text-align:center; padding:40px 20px; font-family: sans-serif;">
                    <h1 style="color: #4CAF50;">✅ 업로드 완료!</h1>
                    <p>📁 저장 위치: <strong>${displayName}</strong></p>
                    <p>성공: ${movedCount}개 파일 ${failedCount > 0 ? `/ 실패: ${failedCount}개` : ''}</p>
                    ${conversionHtml}
                    <p style="margin-top: 30px;">매직미러를 재시작하고 있습니다... 🔄</p>
                    <br>
                    <a href="/" style="padding: 15px 30px; background: #333; color: white; text-decoration: none; border-radius: 10px; display: inline-block;">새로 올리기</a>
                </div>
            `;
            res.send(successHtml);
        }

        // Asynchronously clean file names and restart the mirror
        setImmediate(() => {
            cleanFileNames(() => {
                restartMagicMirror(() => {
                    console.log('Background restart process completed');
                });
            });
        });
    });

    return router;
}

module.exports = createMainRouter;
