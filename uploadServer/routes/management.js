const express = require('express');
const path = require('path');
const fs =require('fs');
const { exec } = require('child_process');
const fileUtils = require('../lib/file-utils');
const { restartMagicMirror } = require('../lib/process-utils');
const { render } = require('../lib/view-renderer');

function createManagementRouter(uploadDir) {
    const router = express.Router();
    let isConversionRunning = false;

    // --- Folder Management ---

    router.post('/toggle-folder', (req, res) => {
        fileUtils.toggleFolderVisibility(uploadDir, req.body.folderName);
        restartMagicMirror(() => res.redirect('/'));
    });

    router.post('/show-all-folders', (req, res) => {
        fileUtils.renameAllDirectories(uploadDir, true);
        restartMagicMirror(() => res.redirect('/'));
    });

    router.post('/hide-all-folders', (req, res) => {
        fileUtils.renameAllDirectories(uploadDir, false);
        restartMagicMirror(() => res.redirect('/'));
    });

    router.post('/delete-folder', (req, res) => {
        const { folderName } = req.body;
        // Prevent deleting essential base folders
        const protectedFolders = [
            path.basename(uploadDir),
            'mobileUpload'
        ];
        const folderPath = path.join(uploadDir, folderName);
        if (protectedFolders.includes(path.basename(folderPath))) {
             console.warn(`Attempt to delete a protected folder was blocked: ${folderPath}`);
             return res.status(403).send('기본 폴더는 삭제할 수 없습니다. <a href="/">돌아가기</a>');
        }

        fileUtils.deleteFolder(uploadDir, folderName);
        restartMagicMirror(() => res.redirect('/'));
    });

    router.post('/create-subfolder', (req, res) => {
        const { parentFolder, subfolderName } = req.body;
        
        if (!parentFolder || !subfolderName || subfolderName.trim() === '') {
            return res.status(400).send('<h1>❌ 잘못된 요청</h1><p>상위 폴더와 하위 폴더 이름이 모두 필요합니다.</p><a href="/">돌아가기</a>');
        }
    
        const trimmedSubfolderName = subfolderName.trim();
    
        if (trimmedSubfolderName.includes('..') || trimmedSubfolderName.includes('/') || trimmedSubfolderName.includes('\\')) {
            return res.status(400).send('<h1>❌ 잘못된 폴더명</h1><p>하위 폴더 이름에 `..`, `/`, `\\` 문자를 사용할 수 없습니다.</p><a href="/">돌아가기</a>');
        }
        
        try {
            const newFolderPath = path.join(uploadDir, parentFolder, trimmedSubfolderName);
    
            if (!fs.existsSync(newFolderPath)) {
                fs.mkdirSync(newFolderPath, { recursive: true });
                console.log(`✅ Subfolder created: ${newFolderPath}`);
            } else {
                console.warn(`Subfolder "${newFolderPath}" already exists.`);
            }
            
            res.redirect(`/manage/photos?folderName=${encodeURIComponent(parentFolder)}`);
    
        } catch (error) {
            console.error('Error creating subfolder:', error);
            res.status(500).send('<h1>❌ 오류</h1><p>하위 폴더를 생성하는 중 오류가 발생했습니다.</p><a href="/">돌아가기</a>');
        }
    });

    // --- Photo Management (within a folder) ---

    router.get('/photos', async (req, res) => {
        const { folderName, sortBy = 'date_desc' } = req.query;
        console.log(`\n📋 /photos request`);
        console.log(`  folderName: ${folderName}`);
        console.log(`  sortBy: ${sortBy}`);
        
        if (!folderName) {
            console.warn(`  ❌ No folderName provided`);
            return res.redirect('/');
        }

        const folderPath = path.join(uploadDir, folderName);
        console.log(`  uploadDir: ${uploadDir}`);
        console.log(`  folderPath: ${folderPath}`);
        console.log(`  Exists: ${fs.existsSync(folderPath)}`);
        
        if (!fs.existsSync(folderPath)) {
            console.error(`  ❌ Folder does not exist`);
            return res.redirect('/');
        }

        const mediaFiles = fileUtils.getMediaFiles(folderPath, sortBy);
        const subdirectories = await fileUtils.getSubdirectories(folderPath);

        let subfolderListHtml = '';
        if (subdirectories.length > 0) {
            const items = subdirectories.map(sub => {
                const isHidden = sub.isHidden;
                const displayName = isHidden ? sub.name.substring(1) : sub.name;
                const subfolderRelativePath = path.join(folderName, sub.name).replace(/\\/g, '/');
                
                return `
                    <a href="/manage/photos?folderName=${encodeURIComponent(subfolderRelativePath)}" class="subfolder-link ${isHidden ? 'is-hidden' : ''}">
                        <div class="subfolder-icon">📁</div>
                        <div class="subfolder-name" title="${displayName}">${displayName}</div>
                    </a>
                `;
            }).join('');

            subfolderListHtml = `
                <div class="subfolder-list-container">
                    <h4>📂 하위 폴더</h4>
                    <div class="subfolder-grid">
                        ${items}
                    </div>
                </div>
            `;
        }

        const photoListHtml = mediaFiles.length > 0 ? mediaFiles.map(fileInfo => {
            const file = fileInfo.name;
            const isHidden = file.startsWith('!');
            const displayName = isHidden ? file.substring(1) : file;
            const encodedFolder = folderName.split(path.sep).map(p => encodeURIComponent(p)).join('/');
            const fileUrl = `/uploads/${encodedFolder}/${encodeURIComponent(file)}`;
            const ext = path.extname(file).toLowerCase();

            const preview = ['.mp4', '.webm', '.ogg', '.mov'].includes(ext)
                ? `<video class="photo-video" src="${fileUrl}" muted playsinline preload="metadata" loop><source src="${fileUrl}"></video>`
                : `<img src="${fileUrl}" loading="lazy" alt="${displayName}">`;

            return `
                <div class="photo-card ${isHidden ? 'is-hidden' : ''}">
                    <div class="photo-image-container" onclick="openFullscreen('${fileUrl}', '${ext}')">
                        ${preview}
                        ${isHidden ? `<div class="hidden-overlay"><span class="hidden-icon">🙈</span></div>` : ''}
                    </div>
                    <p class="photo-filename" title="${displayName}">${displayName}</p>
                    <div class="photo-actions">
                        <form action="/manage/toggle-photo" method="post" style="margin:0;">
                            <input type="hidden" name="folderName" value="${folderName}"><input type="hidden" name="fileName" value="${file}">
                            <button type="submit" class="action-btn toggle-btn ${isHidden ? 'show-btn' : 'hide-btn'}">${isHidden ? '보이기' : '숨기기'}</button>
                        </form>
                        <form action="/manage/delete-photo" method="post" onsubmit="return confirm('정말 이 파일을 삭제하시겠습니까?');" style="margin:0;">
                            <input type="hidden" name="folderName" value="${folderName}"><input type="hidden" name="fileName" value="${file}">
                            <button type="submit" class="action-btn delete-btn">삭제</button>
                        </form>
                    </div>
                </div>`;
        }).join('') : '<p class="no-photos-message">이 폴더에는 해당 미디어 파일이 없습니다.</p>';

        const sortLink = (key, text) => {
            const isActive = sortBy === key;
            const url = `?folderName=${encodeURIComponent(folderName)}&sortBy=${key}`;
            return `<a href="${url}" class="sort-link ${isActive ? 'active' : ''}">${text}</a>`;
        };
        const sortLinks = `${sortLink('date_desc', '최신순')} ${sortLink('date_asc', '오래된순')} ${sortLink('name_asc', '이름순')}`;
        
        const pageContent = render('manage-photos', {
            displayName: folderName.replace(/!/g, '').split(path.sep).join(' / '),
            folderName: folderName,
            sortLinks: sortLinks,
            subfolderListHtml: subfolderListHtml,
            photoListHtml: photoListHtml,
        });

        res.send(pageContent);
    });

    router.post('/toggle-photo', (req, res) => {
        const { folderName, fileName } = req.body;
        fileUtils.togglePhotoVisibility(uploadDir, folderName, fileName);
        restartMagicMirror(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
    });

    router.post('/delete-photo', (req, res) => {
        const { folderName, fileName } = req.body;
        fileUtils.deletePhoto(uploadDir, folderName, fileName);
        restartMagicMirror(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
    });

    router.post('/delete-all-photos', (req, res) => {
        const { folderName } = req.body;
        fileUtils.deleteAllPhotosInFolder(uploadDir, folderName);
        restartMagicMirror(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
    });

    router.post('/show-all-photos', (req, res) => {
        const { folderName } = req.body;
        if (folderName) {
            const folderPath = path.join(uploadDir, folderName);
            fileUtils.renameAllPhotosInFolder(folderPath, true);
        }
        restartMagicMirror(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
    });

    router.post('/hide-all-photos', (req, res) => {
        const { folderName } = req.body;
        if (folderName) {
            const folderPath = path.join(uploadDir, folderName);
            fileUtils.renameAllPhotosInFolder(folderPath, false);
        }
        restartMagicMirror(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
    });

    // --- System Management ---
    router.post('/convert-all-videos', (req, res) => {
        if (isConversionRunning) {
            console.warn('[MMM-ImagesPhotos] Video conversion is already in progress.');
            // Optionally, add a query param to inform the user
            return res.redirect('/?status=conversion_running');
        }

        console.log('[MMM-ImagesPhotos] Manual conversion of all videos requested.');
        isConversionRunning = true;

        const scriptPath = path.resolve(__dirname, '../../convert_videos.sh');
        const command = `/bin/bash "${scriptPath}"`;

        exec(command, (error, stdout, stderr) => {
            isConversionRunning = false; // Reset the flag
            if (error) {
                console.error(`[MMM-ImagesPhotos] Video conversion script failed: ${error.message}`);
                return;
            }
            if (stderr) {
                console.warn(`[MMM-ImagesPhotos] Video conversion script produced errors: ${stderr}`);
            }
            console.log(`[MMM-ImagesPhotos] Video conversion script finished successfully:\n${stdout}`);
        });

        // Redirect immediately, don't wait for the script to finish
        res.redirect('/?status=conversion_started');
    });

    router.post('/restart-mm', (req, res) => {
        console.log('[MMM-ImagesPhotos] Manual restart of MagicMirror requested via web interface.');
        restartMagicMirror((err) => {
            if (err) {
                console.error('[MMM-ImagesPhotos] Restart failed:', err.message);
                res.status(500).json({ success: false, message: 'Failed to restart MagicMirror.' });
            } else {
                res.json({ success: true, message: 'MagicMirror restart initiated.' });
            }
        });
    });

    return router;
}

module.exports = createManagementRouter;
