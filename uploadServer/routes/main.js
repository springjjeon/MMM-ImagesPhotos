
const express = require('express');
const path = require('path');
const fs = require('fs');
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
            
            // 드롭다운용 폴더 옵션 생성 (숨겨진 폴더 제외)
            let folderOptions = folders
                .filter(folder => !path.basename(folder).startsWith('!'))
                .sort()
                .map(folder => {
                    const displayName = folder.split(path.sep).join(' / ');
                    return `<option value="${folder}">${displayName}</option>`;
                }).join('');

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

            // 'mobileUpload' 또는 '!mobileUpload' 중 사용 중인 폴더명 확인
            const baseMobileUploadDir = path.join(uploadDir, 'mobileUpload');
            const hiddenMobileUploadDir = path.join(uploadDir, '!mobileUpload');
            const mobileUploadDirName = fs.existsSync(hiddenMobileUploadDir) && !fs.existsSync(baseMobileUploadDir)
                ? '!mobileUpload'
                : 'mobileUpload';


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
        let tempDir = null;
        
        // 사용자가 폴더를 선택하거나 새 폴더명을 입력한 경우
        if (customFolder || selectedFolder) {
            const targetFolder = customFolder || selectedFolder;
            targetPath = path.join(uploadDir, targetFolder);
            displayName = targetFolder;
            
            console.log(`📁 Target folder (custom): ${targetPath}`);
            
            // 대상 폴더 생성 (필요시)
            try {
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                    console.log(`✅ Created folder: ${targetPath}`);
                }
            } catch (err) {
                console.error(`❌ Failed to create folder: ${targetPath}`, err);
                return res.status(500).send('<h1>❌ 폴더 생성 실패</h1><p>' + err.message + '</p>');
            }
        } else {
            // 선택하지 않은 경우: 기본값 mobileUpload의 YYYY-MM 날짜 폴더에 저장
            const now = new Date();
            const yearMonthFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            
            const baseMobileUploadDir = path.join(uploadDir, 'mobileUpload');
            const hiddenMobileUploadDir = path.join(uploadDir, '!mobileUpload');
            
            const basePath = fs.existsSync(baseMobileUploadDir) ? baseMobileUploadDir : hiddenMobileUploadDir;
            const normalPath = path.join(basePath, yearMonthFolder);
            const hiddenPath = path.join(basePath, '!' + yearMonthFolder);
            
            targetPath = fs.existsSync(hiddenPath) ? hiddenPath : normalPath;
            displayName = `mobileUpload/${yearMonthFolder}`;
            
            console.log(`📁 Target folder (default): ${targetPath}`);
            
            // 날짜 폴더 생성
            try {
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                    console.log(`✅ Created date folder: ${targetPath}`);
                }
            } catch (err) {
                console.error(`❌ Failed to create date folder: ${targetPath}`, err);
                return res.status(500).send('<h1>❌ 폴더 생성 실패</h1><p>' + err.message + '</p>');
            }
        }
        
        // 임시 위치에서 대상 폴더로 파일 이동
        console.log(`📋 Processing ${req.files.length} files...`);
        console.log(`Temp folder: ${tempUploadDir}`);
        let movedCount = 0;
        let failedCount = 0;
        
        req.files.forEach((file, index) => {
            const oldPath = file.path;
            const fileName = file.originalname;
            const newPath = path.join(targetPath, path.basename(oldPath));
            
            console.log(`  [${index + 1}/${req.files.length}] ${fileName}`);
            console.log(`    From: ${oldPath}`);
            console.log(`    To:   ${newPath}`);
            
            try {
                // 파일 존재 확인
                if (!fs.existsSync(oldPath)) {
                    console.error(`    ❌ Source file not found`);
                    failedCount++;
                    return;
                }
                
                // 파일 통계 확인
                let fileSize = 'unknown';
                try {
                    const stats = fs.statSync(oldPath);
                    fileSize = stats.size + ' bytes';
                } catch (statErr) {
                    console.warn(`    ⚠️  Could not read file stats: ${statErr.message}`);
                }
                console.log(`    File size: ${fileSize}`);
                
                // 파일 이동
                fs.renameSync(oldPath, newPath);
                
                // 이동 확인 (약간의 지연 후 확인)
                setImmediate(() => {
                    if (fs.existsSync(newPath)) {
                        console.log(`    ✅ Success`);
                    } else {
                        console.error(`    ⚠️  File move verification: file exists check inconclusive`);
                    }
                });
                
                movedCount++;
            } catch (err) {
                console.error(`    ❌ Error: ${err.message}`);
                failedCount++;
                
                // 임시 파일 삭제 시도
                try {
                    if (fs.existsSync(oldPath)) {
                        fs.unlinkSync(oldPath);
                        console.log(`    🗑️  Cleaned up temp file`);
                    }
                } catch (e) {
                    console.error(`    ⚠️  Failed to clean up: ${e.message}`);
                }
            }
        });
        
        console.log(`\n✅ Upload completed: ${movedCount} success, ${failedCount} failed\n`);
        
        // 임시 폴더 정리 (재귀적 방식 사용 및 안전한 처리)
        const cleanupTempFolder = () => {
            try {
                if (!fs.existsSync(tempUploadDir)) {
                    return; // 폴더가 이미 없으면 무시
                }
                
                const remainingFiles = fs.readdirSync(tempUploadDir).filter(f => !f.startsWith('.'));
                
                // 남은 파일이 있으면 삭제 시도
                if (remainingFiles.length > 0) {
                    remainingFiles.forEach(file => {
                        try {
                            const filePath = path.join(tempUploadDir, file);
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                                console.log(`🗑️  Removed leftover file: ${file}`);
                            }
                        } catch (err) {
                            console.error(`⚠️  Failed to remove file: ${file}`, err.message);
                        }
                    });
                }
                
                // 빈 폴더 삭제
                if (fs.existsSync(tempUploadDir)) {
                    const filesAfterCleanup = fs.readdirSync(tempUploadDir).filter(f => !f.startsWith('.'));
                    if (filesAfterCleanup.length === 0) {
                        fs.rmdirSync(tempUploadDir);
                        console.log(`🗑️  Cleaned up temp folder`);
                    }
                }
            } catch (e) {
                console.warn(`⚠️  Failed to clean temp folder: ${e.message}`);
                // 폴더 정리 실패는 무시 (다음 시작 시 재생성됨)
            }
        };
        
        // 파일 이동 완료 후 약간의 지연을 두고 정리 (안전성 강화)
        setTimeout(cleanupTempFolder, 500);

        // 업로드 후 리디렉션 또는 메시지 표시
        if (selectedFolder) {
            // 특정 폴더에서 업로드한 경우, 해당 폴더 관리 페이지로 리디렉션
            console.log(`Redirecting to /manage/photos?folderName=${encodeURIComponent(selectedFolder)}`);
            res.redirect(`/manage/photos?folderName=${encodeURIComponent(selectedFolder)}`);
        } else {
            // 메인 페이지에서 업로드한 경우, 기존 성공 메시지 표시
            const successHtml = `
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <div style="text-align:center; padding:50px; font-family: sans-serif;">
                    <h1 style="color: #4CAF50;">✅ 업로드 완료!</h1>
                    <p>📁 저장 위치: <strong>${displayName}</strong></p>
                    <p>성공: ${movedCount}개 파일 ${failedCount > 0 ? '/ 실패: ' + failedCount + '개' : ''}</p>
                    <p style="margin-top: 20px;">매직미러를 재시작하고 있습니다... 🔄</p>
                    <br>
                    <a href="/" style="padding: 15px 30px; background: #333; color: white; text-decoration: none; border-radius: 10px; display: inline-block;">새로 올리기</a>
                </div>
            `;
            res.send(successHtml);
        }

        // 백그라운드에서 파일명 정리 및 재시작 (비동기)
        // 응답 전송 후에 진행하므로 사용자는 블로킹되지 않음
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
