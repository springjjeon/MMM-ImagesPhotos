
const express = require('express');
const path = require('path');
const fs = require('fs');
const fileUtils = require('../lib/file-utils');
const { restartMagicMirror } = require('../lib/process-utils');
const { render } = require('../lib/view-renderer');

function createManagementRouter(uploadDir) {
    const router = express.Router();

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

    // --- Photo Management (within a folder) ---

    router.get('/photos', (req, res) => {
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
        console.log(`  📁 Found ${mediaFiles.length} files`);
        
        if (mediaFiles.length > 0) {
            mediaFiles.slice(0, 3).forEach(f => console.log(`    - ${f.name}`));
            if (mediaFiles.length > 3) console.log(`    ... and ${mediaFiles.length - 3} more`);
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

    return router;
}

module.exports = createManagementRouter;
